import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BACKUP_APP_ID,
  BACKUP_FORMAT,
  EMPTY_COUNTS,
  type BackupCounts,
  type BackupInspection,
  type BackupMeta,
} from '@/lib/backup';

/**
 * SQL for backup files. The snapshot itself is made with the SQLite backup API in
 * src/services/backup.ts; these functions work on any open handle (live, temp or safety copy).
 */

const COUNT_TABLES: [keyof BackupCounts, string][] = [
  ['borrowers', 'borrowers'],
  ['loans', 'loans'],
  ['installments', 'installments'],
  ['payments', 'payments'],
  ['cashEntries', 'cash_entries'],
];

export async function listTables(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return rows.map((r) => r.name);
}

/** Row counts in ONE query (tables missing in older schemas count as 0). */
export async function countRows(db: SQLiteDatabase): Promise<BackupCounts> {
  const tables = new Set(await listTables(db));
  // Table names come from the fixed list above, never from input.
  const parts = COUNT_TABLES.map(([key, table]) =>
    tables.has(table) ? `(SELECT COUNT(*) FROM ${table}) AS ${key}` : `0 AS ${key}`,
  );
  const row = await db.getFirstAsync<BackupCounts>(`SELECT ${parts.join(', ')}`);
  return row ?? { ...EMPTY_COUNTS };
}

export async function getUserVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Turns a fresh snapshot copy into a self-contained backup file: rollback journal (no -wal
 * file), the meta row, the whitelisted settings, an integrity check, then VACUUM.
 */
export async function finalizeSnapshot(
  db: SQLiteDatabase,
  meta: Omit<BackupMeta, 'appId' | 'backupFormat' | 'counts' | 'schemaUserVersion'>,
  settings: [string, string][],
): Promise<BackupMeta> {
  await db.execAsync('PRAGMA journal_mode = DELETE;');
  const counts = await countRows(db);
  const schemaUserVersion = await getUserVersion(db);
  await db.execAsync(`
    DROP TABLE IF EXISTS _backup_meta;
    DROP TABLE IF EXISTS _backup_settings;
    CREATE TABLE _backup_meta (
      app_id TEXT NOT NULL, backup_format INTEGER NOT NULL, app_version TEXT NOT NULL,
      schema_user_version INTEGER NOT NULL, created_at TEXT NOT NULL,
      borrowers INTEGER NOT NULL, loans INTEGER NOT NULL, installments INTEGER NOT NULL,
      payments INTEGER NOT NULL, cash_entries INTEGER NOT NULL
    );
    CREATE TABLE _backup_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
  await db.runAsync(
    `INSERT INTO _backup_meta VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      BACKUP_APP_ID,
      BACKUP_FORMAT,
      meta.appVersion,
      schemaUserVersion,
      meta.createdAt,
      counts.borrowers,
      counts.loans,
      counts.installments,
      counts.payments,
      counts.cashEntries,
    ],
  );
  for (const [key, value] of settings) {
    await db.runAsync('INSERT INTO _backup_settings (key, value) VALUES (?, ?)', [key, value]);
  }
  const check = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (check?.integrity_check !== 'ok') throw new Error('The backup copy failed its integrity check.');
  await db.execAsync('VACUUM;');
  return { appId: BACKUP_APP_ID, backupFormat: BACKUP_FORMAT, schemaUserVersion, counts, ...meta };
}

/** Read-only checks on a candidate file (it is a temp copy, never the live database). */
export async function inspectBackup(db: SQLiteDatabase): Promise<BackupInspection> {
  const inspection: BackupInspection = {
    isSqlite: true,
    integrityOk: false,
    foreignKeysOk: false,
    meta: null,
    userVersion: 0,
    tables: [],
  };
  try {
    const integrity = await db.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    inspection.integrityOk = integrity.length === 1 && integrity[0]!.integrity_check === 'ok';
  } catch {
    // "file is not a database" / "database disk image is malformed" → corrupt
    inspection.integrityOk = false;
  }
  if (!inspection.integrityOk) return inspection;
  inspection.tables = await listTables(db);
  inspection.userVersion = await getUserVersion(db);
  inspection.foreignKeysOk = (await db.getAllAsync('PRAGMA foreign_key_check')).length === 0;
  if (inspection.tables.includes('_backup_meta')) {
    const m = await db.getFirstAsync<{
      app_id: string;
      backup_format: number;
      app_version: string;
      schema_user_version: number;
      created_at: string;
      borrowers: number;
      loans: number;
      installments: number;
      payments: number;
      cash_entries: number;
    }>('SELECT * FROM _backup_meta LIMIT 1');
    if (m) {
      inspection.meta = {
        appId: m.app_id,
        backupFormat: m.backup_format,
        appVersion: m.app_version,
        schemaUserVersion: m.schema_user_version,
        createdAt: m.created_at,
        counts: {
          borrowers: m.borrowers,
          loans: m.loans,
          installments: m.installments,
          payments: m.payments,
          cashEntries: m.cash_entries,
        },
      };
    }
  }
  return inspection;
}

/** The whitelisted settings stored in a backup (empty if the table is missing). */
export async function readBackupSettings(db: SQLiteDatabase): Promise<Map<string, string>> {
  if (!(await listTables(db)).includes('_backup_settings')) return new Map();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM _backup_settings',
  );
  return new Map(rows.map((r) => [r.key, r.value]));
}

/** After a restore the live database must not keep the backup-only tables. */
export async function dropBackupTables(db: SQLiteDatabase) {
  await db.execAsync('DROP TABLE IF EXISTS _backup_meta; DROP TABLE IF EXISTS _backup_settings;');
}

/** Live database health check (used after a restore and when recovering from a crash). */
export async function isDatabaseHealthy(db: SQLiteDatabase, latestVersion: number): Promise<boolean> {
  try {
    const integrity = await db.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') return false;
    if ((await db.getAllAsync('PRAGMA foreign_key_check')).length > 0) return false;
    const tables = await listTables(db);
    if (tables.includes('_backup_meta')) return false;
    return (await getUserVersion(db)) === latestVersion && tables.includes('borrowers');
  } catch {
    return false;
  }
}
