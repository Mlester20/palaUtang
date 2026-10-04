import type { SQLiteDatabase } from 'expo-sqlite';

import { exclusiveWork } from './transaction';

export const DATABASE_NAME = 'perahiram.db';

/**
 * A migration is plain SQL, or `{ sql, foreignKeysOff: true }` for one that rebuilds a PARENT
 * table (DROP of a table other tables reference). Those run with foreign keys disabled BEFORE
 * the transaction starts (the PRAGMA is ignored inside one), so ON DELETE CASCADE can't wipe
 * child rows, and `PRAGMA foreign_key_check` must come back empty before commit.
 */
type Migration = string | { sql: string; foreignKeysOff: true };

/**
 * Ordered schema migrations. Entry N upgrades the database from user_version N to N + 1.
 * Never edit a migration that has shipped; append a new one instead.
 */
const MIGRATIONS: Migration[] = [
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

  // v4: early payoff (settlement) + renewal.
  //  - loans: status gains 'closed_early' (CHECK → table rebuild) + closed_at, closed_reason,
  //    discount_amount, settlement_mode, renewed_from_loan_id.
  //  - installments: status gains 'settled' (CHECK → rebuild) + waived_amount.
  //  - payments: type ('regular' | 'settlement') and is_netted (plain ADD COLUMN).
  // loans is the parent of installments (ON DELETE CASCADE) and payments, so this MUST run with
  // foreign keys off, or dropping the old loans table would delete every installment.
  {
    foreignKeysOff: true,
    sql: `
  CREATE TABLE loans_v4 (
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
                             CHECK (status IN ('active', 'completed', 'cancelled', 'closed_early')),
    notes                  TEXT,
    closed_at              TEXT,
    closed_reason          TEXT,
    discount_amount        INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    settlement_mode        TEXT CHECK (settlement_mode IS NULL
                                       OR settlement_mode IN ('full', 'prorata', 'discount')),
    renewed_from_loan_id   INTEGER REFERENCES loans (id) ON DELETE RESTRICT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    CHECK (payment_type = 'daily' OR (number_of_installments = 1 AND skip_sundays = 0)),
    CHECK (end_date >= start_date),
    CHECK ((status = 'closed_early') = (closed_at IS NOT NULL)),
    CHECK (discount_amount <= total_payable)
  );
  INSERT INTO loans_v4 (id, borrower_id, principal, interest_rate, interest_amount, total_payable,
                        payment_type, number_of_installments, installment_amount, start_date,
                        end_date, skip_sundays, status, notes, created_at, updated_at)
    SELECT id, borrower_id, principal, interest_rate, interest_amount, total_payable,
           payment_type, number_of_installments, installment_amount, start_date,
           end_date, skip_sundays, status, notes, created_at, updated_at
    FROM loans;
  DROP TABLE loans;
  ALTER TABLE loans_v4 RENAME TO loans;
  CREATE INDEX idx_loans_borrower_id ON loans (borrower_id);
  CREATE INDEX idx_loans_status ON loans (status);
  CREATE INDEX idx_loans_renewed_from_loan_id ON loans (renewed_from_loan_id);

  CREATE TABLE installments_v4 (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id                   INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
    installment_number        INTEGER NOT NULL CHECK (installment_number >= 1),
    due_date                  TEXT NOT NULL,
    original_due_date         TEXT NOT NULL,
    amount_due                INTEGER NOT NULL CHECK (amount_due >= 0),
    amount_paid               INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    waived_amount             INTEGER NOT NULL DEFAULT 0 CHECK (waived_amount >= 0),
    status                    TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'paid', 'partial', 'missed',
                                                  'skipped', 'settled')),
    is_makeup                 INTEGER NOT NULL DEFAULT 0 CHECK (is_makeup IN (0, 1)),
    makeup_for_installment_id INTEGER REFERENCES installments (id) ON DELETE CASCADE,
    created_at                TEXT NOT NULL,
    UNIQUE (loan_id, installment_number),
    CHECK ((is_makeup = 1) = (makeup_for_installment_id IS NOT NULL)),
    CHECK (amount_paid + waived_amount <= amount_due)
  );
  INSERT INTO installments_v4 (id, loan_id, installment_number, due_date, original_due_date,
                               amount_due, amount_paid, status, is_makeup,
                               makeup_for_installment_id, created_at)
    SELECT id, loan_id, installment_number, due_date, original_due_date,
           amount_due, amount_paid, status, is_makeup, makeup_for_installment_id, created_at
    FROM installments;
  DROP TABLE installments;
  ALTER TABLE installments_v4 RENAME TO installments;
  CREATE INDEX idx_installments_loan_id ON installments (loan_id);
  CREATE INDEX idx_installments_due_date ON installments (due_date);
  CREATE INDEX idx_installments_makeup_for ON installments (makeup_for_installment_id);

  ALTER TABLE payments ADD COLUMN type TEXT NOT NULL DEFAULT 'regular'
    CHECK (type IN ('regular', 'settlement'));
  ALTER TABLE payments ADD COLUMN is_netted INTEGER NOT NULL DEFAULT 0
    CHECK (is_netted IN (0, 1));
  CREATE INDEX idx_payments_type ON payments (type);
  -- At most ONE active settlement per loan (also stops a double-tapped Settle).
  CREATE UNIQUE INDEX idx_payments_one_active_settlement
    ON payments (loan_id) WHERE type = 'settlement' AND status = 'active';
  `,
  },

  // v5: indexes only, for the dashboard and reports (payments by date; installments.due_date
  // is already indexed since v2).
  `
  CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON payments (paid_on);
  `,

  // v6: cash ledger. Only MANUAL movements are stored (opening, capital in, withdrawals,
  // expenses, count adjustments); collections and loan releases are derived from payments and
  // loans. kind / direction / category are validated in code (src/lib/cash.ts), not by CHECK,
  // so categories can grow. Rows are never deleted: mistakes are voided with a reason.
  // amount >= 0 because the opening balance may be ₱0 (other kinds must be > 0, in code).
  // The active 'opening' row is the setup marker: its entry_date is the ledger start date.
  `
  CREATE TABLE cash_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    direction   TEXT NOT NULL,
    category    TEXT,
    amount      INTEGER NOT NULL CHECK (amount >= 0),
    entry_date  TEXT NOT NULL,
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
    voided_at   TEXT,
    void_reason TEXT,
    created_at  TEXT NOT NULL,
    CHECK ((status = 'voided') = (voided_at IS NOT NULL))
  );
  CREATE INDEX idx_cash_entries_entry_date ON cash_entries (entry_date);
  CREATE INDEX idx_cash_entries_kind ON cash_entries (kind);
  CREATE INDEX idx_cash_entries_status ON cash_entries (status);
  CREATE UNIQUE INDEX idx_cash_entries_one_active_opening
    ON cash_entries (kind) WHERE kind = 'opening' AND status = 'active';
  -- Loan releases are read by start date.
  CREATE INDEX idx_loans_start_date ON loans (start_date);
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
    const migration = MIGRATIONS[version]!;
    if (typeof migration === 'string') {
      // Each step is atomic: the schema change and the version bump commit together.
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.execAsync(migration);
        await txn.execAsync(`PRAGMA user_version = ${version + 1}`);
      });
    } else {
      await runWithForeignKeysOff(db, migration.sql, version + 1);
    }
  }
}

/**
 * Table-rebuild migration (SQLite's 12-step ALTER): foreign keys OFF before the transaction,
 * rebuild + foreign_key_check + version bump inside it, foreign keys back ON afterwards.
 * Runs on the main connection, because the PRAGMA is per connection.
 */
async function runWithForeignKeysOff(db: SQLiteDatabase, sql: string, nextVersion: number) {
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      const problems = await db.getAllAsync('PRAGMA foreign_key_check');
      if (problems.length > 0) {
        throw new Error(`Migration v${nextVersion} broke ${problems.length} foreign key(s).`);
      }
      await db.execAsync(`PRAGMA user_version = ${nextVersion}`);
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
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
