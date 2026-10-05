/**
 * Backup / restore rules. Pure: no database, no files, no React; `now` / `today` are
 * parameters. File and SQLite work lives in src/services/backup.ts and src/db/backup.ts.
 *
 * Backup file = a consistent SQLite snapshot of the live database (SQLite backup API, so rows
 * still in the -wal file are included) plus two extra tables:
 *   _backup_meta      one row: app_id, backup_format, app_version, schema_user_version,
 *                     created_at (local "YYYY-MM-DD HH:MM"), row counts
 *   _backup_settings  key/value: ONLY the whitelisted kv-store keys below
 * Device-only keys (App Lock, onboarding flag, backup status, restore marker) are never in it.
 */

export const BACKUP_APP_ID = 'perahiram';
export const BACKUP_FORMAT = 1;

/** kv-store keys that travel with a backup (confirmed by the owner in Phase 11, Step 0). */
export const BACKUP_SETTING_KEYS = [
  'app.businessProfile',
  'flags.flagAfterDays',
  'flags.criticalAfterDays',
] as const;

export const SAFETY_BACKUPS_TO_KEEP = 3;

/** Reminder choices in days; 0 = Off. */
export const REMINDER_DAY_OPTIONS = [0, 3, 7, 14, 30] as const;
export const DEFAULT_REMINDER_DAYS = 7;
export const REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface BackupCounts {
  borrowers: number;
  loans: number;
  installments: number;
  payments: number;
  cashEntries: number;
}

export const EMPTY_COUNTS: BackupCounts = {
  borrowers: 0,
  loans: 0,
  installments: 0,
  payments: 0,
  cashEntries: 0,
};

// ───────────────────────── Names & timestamps (local time) ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD HH:MM" (never UTC). */
export function localStamp(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** "PeraHiram-backup-2026-10-04-2130.db" from LOCAL date parts. */
export function backupFileName(now: Date, kind: 'backup' | 'safety' = 'backup'): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const suffix = kind === 'safety' ? `-${pad(now.getSeconds())}` : '';
  return `PeraHiram-${kind}-${date}-${time}${suffix}.db`;
}

/** "PeraHiram-payments-2026-10-04-2130.csv". */
export function csvFileName(dataset: string, now: Date): string {
  return backupFileName(now).replace('backup', dataset).replace(/\.db$/, '.csv');
}

/** ISO timestamp (stored created_at) → local "YYYY-MM-DD HH:MM"; '' for null/invalid. */
export function isoToLocalStamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localStamp(d);
}

// ───────────────────────── Validation ─────────────────────────

/** Tables every backup of a given schema version must contain. */
export function requiredTablesFor(schemaVersion: number): string[] {
  const tables = ['borrowers'];
  if (schemaVersion >= 2) tables.push('loans', 'installments');
  if (schemaVersion >= 3) tables.push('payments', 'payment_allocations');
  if (schemaVersion >= 6) tables.push('cash_entries');
  return tables;
}

export interface BackupMeta {
  appId: string;
  backupFormat: number;
  appVersion: string;
  schemaUserVersion: number;
  createdAt: string;
  counts: BackupCounts;
}

/** What the validator read from a candidate file (src/db/backup.ts readBackupInfo). */
export interface BackupInspection {
  isSqlite: boolean;
  integrityOk: boolean;
  foreignKeysOk: boolean;
  meta: BackupMeta | null;
  /** user_version of the file itself. */
  userVersion: number;
  tables: string[];
}

export type BackupProblem =
  | 'notSqlite'
  | 'corrupt'
  | 'foreignKeys'
  | 'notPeraHiram'
  | 'unsupportedFormat'
  | 'newerVersion'
  | 'missingTables';

/** null = OK to restore. Older schema versions are fine (migrated after the restore). */
export function validateInspection(info: BackupInspection, latestVersion: number): BackupProblem | null {
  if (!info.isSqlite) return 'notSqlite';
  if (!info.integrityOk) return 'corrupt';
  if (!info.meta || info.meta.appId !== BACKUP_APP_ID) return 'notPeraHiram';
  if (info.meta.backupFormat > BACKUP_FORMAT) return 'unsupportedFormat';
  const version = Math.max(info.meta.schemaUserVersion, info.userVersion);
  if (version > latestVersion) return 'newerVersion';
  if (!info.foreignKeysOk) return 'foreignKeys';
  if (requiredTablesFor(version).some((t) => !info.tables.includes(t))) return 'missingTables';
  return null;
}

/** First 16 bytes of every SQLite 3 file: "SQLite format 3\0". */
export function hasSqliteHeader(bytes: Uint8Array): boolean {
  const magic = 'SQLite format 3\u0000';
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) return false;
  return true;
}

/** True when there is anything worth protecting (typed confirmation, reminder card). */
export function hasData(counts: BackupCounts): boolean {
  return counts.borrowers > 0 || counts.loans > 0 || counts.payments > 0 || counts.cashEntries > 0;
}

export const RESTORE_CONFIRM_WORD = 'RESTORE';

export function isRestoreConfirmed(typed: string): boolean {
  return typed.trim() === RESTORE_CONFIRM_WORD;
}

// ───────────────────────── Safety backups ─────────────────────────

/** Names to delete so only the newest `keep` remain (names sort by their local timestamp). */
export function safetyBackupsToDelete(names: string[], keep = SAFETY_BACKUPS_TO_KEEP): string[] {
  const safety = names.filter((n) => n.startsWith('PeraHiram-safety-') && n.endsWith('.db'));
  return [...safety].sort().reverse().slice(keep);
}

// ───────────────────────── Reminder ─────────────────────────

/** Whole days since a timestamp (ms), by local calendar day; null if never. */
export function daysSince(timestampMs: number | null, now: Date): number | null {
  if (timestampMs === null) return null;
  const then = new Date(timestampMs);
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Older than the interval (or never backed up) — used by the Home card and Reset warning. */
export function isBackupStale(lastBackupAt: number | null, reminderDays: number, now: Date): boolean {
  if (lastBackupAt === null) return true;
  const days = reminderDays > 0 ? reminderDays : DEFAULT_REMINDER_DAYS;
  return now.getTime() - lastBackupAt >= days * 86_400_000;
}

/**
 * Home "Back up your data" card. Shown only when reminders are on, there is data, the last
 * backup is missing or older than the interval, and it wasn't dismissed in the last 24 hours.
 * Examples (interval 7 days): never backed up + 1 borrower → show; backed up 3 days ago →
 * hide; 8 days ago → show; dismissed 2 hours ago → hide; empty database → hide; Off → hide.
 */
export function shouldShowBackupReminder({
  now,
  hasAnyData,
  reminderDays,
  lastBackupAt,
  dismissedUntil,
}: {
  now: Date;
  hasAnyData: boolean;
  reminderDays: number;
  lastBackupAt: number | null;
  dismissedUntil: number | null;
}): boolean {
  if (reminderDays <= 0 || !hasAnyData) return false;
  if (dismissedUntil !== null && now.getTime() < dismissedUntil) return false;
  return isBackupStale(lastBackupAt, reminderDays, now);
}
