import type { SQLiteDatabase } from 'expo-sqlite';

import { exclusiveWork } from './transaction';

export const DATABASE_NAME = 'perahiram.db';

/**
 * Ordered schema migrations. Entry N upgrades the database from user_version N to N + 1.
 * Never edit a migration that has shipped; append a new one instead.
 */
const MIGRATIONS: string[] = [
  // v1: borrowers. Later phases add loans/schedules/payments that reference borrowers(id).
  `
  CREATE TABLE borrowers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name   TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
    nickname    TEXT,
    phone       TEXT,
    address     TEXT,
    notes       TEXT,
    archived_at TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX idx_borrowers_full_name ON borrowers (full_name COLLATE NOCASE);
  CREATE INDEX idx_borrowers_archived_at ON borrowers (archived_at);
  `,

  // v2: loans + their installment schedule. Money = INTEGER centavos, dates = 'YYYY-MM-DD'.
  `
  CREATE TABLE loans (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id            INTEGER NOT NULL REFERENCES borrowers (id) ON DELETE RESTRICT,
    principal              INTEGER NOT NULL CHECK (principal > 0),
    interest_rate          REAL CHECK (interest_rate IS NULL OR interest_rate >= 0),
    interest_amount        INTEGER NOT NULL CHECK (interest_amount >= 0),
    total_payable          INTEGER NOT NULL CHECK (total_payable = principal + interest_amount),
    payment_type           TEXT NOT NULL CHECK (payment_type IN ('daily', 'lump_sum')),
    number_of_installments INTEGER NOT NULL CHECK (number_of_installments >= 1),
    installment_amount     INTEGER NOT NULL CHECK (installment_amount >= 0),
    start_date             TEXT NOT NULL,
    end_date               TEXT NOT NULL,
    skip_sundays           INTEGER NOT NULL DEFAULT 0 CHECK (skip_sundays IN (0, 1)),
    status                 TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'completed', 'cancelled')),
    notes                  TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    CHECK (payment_type = 'daily' OR (number_of_installments = 1 AND skip_sundays = 0)),
    CHECK (end_date >= start_date)
  );
  CREATE INDEX idx_loans_borrower_id ON loans (borrower_id);
  CREATE INDEX idx_loans_status ON loans (status);

  CREATE TABLE installments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id            INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL CHECK (installment_number >= 1),
    due_date           TEXT NOT NULL,
    original_due_date  TEXT NOT NULL,
    amount_due         INTEGER NOT NULL CHECK (amount_due >= 0),
    amount_paid        INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    status             TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'paid', 'partial', 'missed')),
    created_at         TEXT NOT NULL,
    UNIQUE (loan_id, installment_number)
  );
  CREATE INDEX idx_installments_loan_id ON installments (loan_id);
  CREATE INDEX idx_installments_due_date ON installments (due_date);
  `,

  // v3: payments + allocations, and installments gain 'skipped' status and make-up columns.
  // SQLite can't change a CHECK constraint, so installments is rebuilt (create, copy, drop,
  // rename). Nothing references installments yet, so dropping the old table is safe.
  `
  CREATE TABLE installments_v3 (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id                   INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
    installment_number        INTEGER NOT NULL CHECK (installment_number >= 1),
    due_date                  TEXT NOT NULL,
    original_due_date         TEXT NOT NULL,
    amount_due                INTEGER NOT NULL CHECK (amount_due >= 0),
    amount_paid               INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    status                    TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'paid', 'partial', 'missed', 'skipped')),
    is_makeup                 INTEGER NOT NULL DEFAULT 0 CHECK (is_makeup IN (0, 1)),
    makeup_for_installment_id INTEGER REFERENCES installments (id) ON DELETE CASCADE,
    created_at                TEXT NOT NULL,
    UNIQUE (loan_id, installment_number),
    CHECK ((is_makeup = 1) = (makeup_for_installment_id IS NOT NULL))
  );
  INSERT INTO installments_v3 (id, loan_id, installment_number, due_date, original_due_date,
                               amount_due, amount_paid, status, created_at)
    SELECT id, loan_id, installment_number, due_date, original_due_date,
           amount_due, amount_paid, status, created_at
    FROM installments;
  DROP TABLE installments;
  ALTER TABLE installments_v3 RENAME TO installments;
  CREATE INDEX idx_installments_loan_id ON installments (loan_id);
  CREATE INDEX idx_installments_due_date ON installments (due_date);
  CREATE INDEX idx_installments_makeup_for ON installments (makeup_for_installment_id);

  -- Payments are never deleted: mistakes are voided (status + reason).
  CREATE TABLE payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id     INTEGER NOT NULL REFERENCES loans (id) ON DELETE RESTRICT,
    amount      INTEGER NOT NULL CHECK (amount > 0),
    paid_on     TEXT NOT NULL,
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
    voided_at   TEXT,
    void_reason TEXT,
    created_at  TEXT NOT NULL,
    CHECK ((status = 'voided') = (voided_at IS NOT NULL))
  );
  CREATE INDEX idx_payments_loan_id ON payments (loan_id);
  CREATE INDEX idx_payments_status ON payments (status);

  -- Which installments each active payment covers. Derived: rebuilt by recomputeLoan.
  CREATE TABLE payment_allocations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id     INTEGER NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
    installment_id INTEGER NOT NULL REFERENCES installments (id) ON DELETE RESTRICT,
    amount         INTEGER NOT NULL CHECK (amount > 0),
    UNIQUE (payment_id, installment_id)
  );
  CREATE INDEX idx_payment_allocations_payment_id ON payment_allocations (payment_id);
  CREATE INDEX idx_payment_allocations_installment_id ON payment_allocations (installment_id);
  `,
];

export const LATEST_VERSION = MIGRATIONS.length;

/** Runs in SQLiteProvider's onInit, before any screen can query the database. */
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  // Connection settings: must run outside a transaction, on every app start.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < LATEST_VERSION; version++) {
    // Each step is atomic: the schema change and the version bump commit together.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(MIGRATIONS[version]!);
      await txn.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/**
 * Deletes every app table and recreates an empty schema (used by Settings → Reset app).
 * Drops all user tables, not just borrowers, so it keeps working as later phases add tables.
 */
export function resetDatabase(db: SQLiteDatabase) {
  // Queued so it can't interleave with a background reconcile or a save.
  return exclusiveWork(() => dropAllAndMigrate(db));
}

async function dropAllAndMigrate(db: SQLiteDatabase) {
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );

  // Foreign keys off so tables can be dropped in any order (e.g. loans before borrowers).
  // The PRAGMA is per-connection and ignored inside a transaction, so it is set here and the
  // drops run on this same connection (not withExclusiveTransactionAsync, which opens another).
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      for (const { name } of tables) {
        await db.execAsync(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
      }
      await db.execAsync('PRAGMA user_version = 0');
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }

  // Recreate the empty schema right away; the provider's onInit only runs once per app start.
  await migrateDbIfNeeded(db);
}
