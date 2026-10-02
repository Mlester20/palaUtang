import type { SQLiteDatabase } from 'expo-sqlite';

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
export async function resetDatabase(db: SQLiteDatabase) {
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
