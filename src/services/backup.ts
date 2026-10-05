import Constants from 'expo-constants';
import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { backupDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  countRows,
  dropBackupTables,
  finalizeSnapshot,
  inspectBackup,
  isDatabaseHealthy,
  readBackupSettings,
} from '@/db/backup';
import { LATEST_VERSION, migrateDbIfNeeded } from '@/db/migrations';
import { reconcileAllActiveLoans } from '@/db/payments';
import { exclusiveWork } from '@/db/transaction';
import {
  backupFileName,
  hasSqliteHeader,
  localStamp,
  safetyBackupsToDelete,
  validateInspection,
  type BackupCounts,
  type BackupMeta,
  type BackupProblem,
} from '@/lib/backup';
import { todayYmd } from '@/lib/loan';
import { completeOnboarding, getAppStateSnapshot, reloadAppState } from '@/store/app-state';
import {
  applyWhitelistedSettings,
  bumpDataGeneration,
  clearRestoreMarker,
  markBackupExported,
  readRestoreMarker,
  readWhitelistedSettings,
  writeRestoreMarker,
} from '@/store/backup-state';
import { reloadFlagThresholds } from '@/store/flag-settings';

/**
 * Backup, restore and rollback (SDK 57 APIs):
 *  - expo-sqlite backupDatabaseAsync: page-level SQLite backup API through the live connection,
 *    so rows still in the -wal file are included (the raw .db file is never copied);
 *  - expo-file-system File / Directory / Paths (+ Directory.pickDirectoryAsync on Android);
 *  - expo-sharing shareAsync; expo-document-picker getDocumentAsync (copied to cache).
 * Temp files live in cache/perahiram-tmp and are deleted after every operation and on start.
 * Safety backups live in documents/safety-backups (newest 3 kept).
 */

const DB_MIME = 'application/x-sqlite3';
const CANDIDATE_NAME = 'restore-candidate.db';

export const tempDirectory = () => new Directory(Paths.cache, 'perahiram-tmp');
export const safetyDirectory = () => new Directory(Paths.document, 'safety-backups');

function ensureDirectory(dir: Directory) {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

/** Deletes a database file and its -wal / -shm / -journal companions. */
function deleteDatabaseFiles(dir: Directory, name: string) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = new File(dir, name + suffix);
    if (file.exists) file.delete();
  }
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

/** Never throws: leftovers from a crash or a cancelled share are removed on the next start. */
export function cleanupTempFiles() {
  try {
    const dir = tempDirectory();
    if (dir.exists) dir.delete();
  } catch (error) {
    console.warn('[Backup] Could not clean temp files', error);
  }
}

// ───────────────────────── Snapshot ─────────────────────────

/**
 * Consistent copy of the live database + _backup_meta + whitelisted _backup_settings, written
 * as `dir/name`. Callers run it inside exclusiveWork so no write lands mid-copy.
 */
async function snapshotUnqueued(live: SQLiteDatabase, dir: Directory, name: string, now: Date) {
  ensureDirectory(dir);
  deleteDatabaseFiles(dir, name);
  {
    const dest = await openDatabaseAsync(name, { useNewConnection: true }, dir.uri);
    try {
      await backupDatabaseAsync({ sourceDatabase: live, destDatabase: dest });
      const meta = await finalizeSnapshot(
        dest,
        { appVersion: appVersion(), createdAt: localStamp(now) },
        readWhitelistedSettings(),
      );
      return { file: new File(dir, name), meta };
    } finally {
      await dest.closeAsync();
      // journal_mode = DELETE leaves no companions, but be sure.
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const extra = new File(dir, name + suffix);
        if (extra.exists) extra.delete();
      }
    }
  }
}

export type BackupTarget = 'share' | 'folder';

/** Saving into a user-picked folder needs Android's folder picker (SAF). */
export const canSaveToFolder = Platform.OS === 'android';

/**
 * Makes a backup file and shares it (or saves it into a picked folder). The temp file is
 * always deleted. Returns 'done' or 'cancelled' (folder picker closed); throws on errors.
 * The live data is only read, so a failure can't change it.
 */
export async function createAndExportBackup(
  live: SQLiteDatabase,
  target: BackupTarget,
  now = new Date(),
): Promise<{ result: 'done' | 'cancelled'; meta?: BackupMeta }> {
  const dir = tempDirectory();
  const name = backupFileName(now);
  try {
    const { file, meta } = await exclusiveWork(() => snapshotUnqueued(live, dir, name, now));
    if (target === 'folder') {
      let folder: Directory;
      try {
        folder = await Directory.pickDirectoryAsync();
      } catch {
        return { result: 'cancelled' };
      }
      const out = folder.createFile(name, DB_MIME);
      out.write(await file.bytes());
    } else {
      await Sharing.shareAsync(file.uri, { mimeType: DB_MIME, dialogTitle: name, UTI: 'public.database' });
    }
    // Honest wording in the UI: "exported" — the app can't see whether it was really saved.
    markBackupExported(now.getTime(), meta.counts);
    return { result: 'done', meta };
  } finally {
    deleteDatabaseFiles(dir, name);
  }
}

// ───────────────────────── Restore: pick + validate ─────────────────────────

export interface RestoreCandidate {
  file: File;
  meta: BackupMeta;
  settings: Map<string, string>;
  /** Counts on this phone right now (for the preview). */
  currentCounts: BackupCounts;
}

export class RestoreError extends Error {
  constructor(
    readonly reason: BackupProblem | 'rolledBack' | 'rollbackFailed',
    readonly detail?: unknown,
  ) {
    super(`Restore failed: ${reason}`);
    this.name = 'RestoreError';
  }
}

/** Opens the file picker; null when cancelled. The pick is copied into the temp folder. */
export async function pickBackupFile(): Promise<File | null> {
  const picked = await getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const source = new File(picked.assets[0].uri);
  const dir = tempDirectory();
  ensureDirectory(dir);
  deleteDatabaseFiles(dir, CANDIDATE_NAME);
  const candidate = new File(dir, CANDIDATE_NAME);
  source.copySync(candidate);
  try {
    source.delete(); // the picker's own cache copy
  } catch {
    // not ours to delete on some providers; the cache is cleaned by the OS
  }
  return candidate;
}

function readHeader(file: File): Uint8Array {
  const handle = file.open();
  try {
    return handle.readBytes(16);
  } finally {
    handle.close();
  }
}

/**
 * Validates a picked file WITHOUT touching live data: SQLite header, integrity, foreign keys,
 * _backup_meta app id, schema version (newer → rejected), expected tables.
 * Throws RestoreError(problem) when it can't be restored.
 */
export async function inspectCandidate(live: SQLiteDatabase, file: File): Promise<RestoreCandidate> {
  if (!file.exists || file.size < 16 || !hasSqliteHeader(readHeader(file))) {
    throw new RestoreError('notSqlite');
  }
  let db: SQLiteDatabase | null = null;
  try {
    db = await openDatabaseAsync(file.name, { useNewConnection: true }, file.parentDirectory.uri);
    const inspection = await inspectBackup(db);
    const problem = validateInspection(inspection, LATEST_VERSION);
    if (problem) throw new RestoreError(problem);
    const settings = await readBackupSettings(db);
    return { file, meta: inspection.meta!, settings, currentCounts: await countRows(live) };
  } catch (error) {
    if (error instanceof RestoreError) throw error;
    throw new RestoreError('corrupt', error);
  } finally {
    await db?.closeAsync();
  }
}

/** Cancel at the preview: delete the candidate, nothing else happened. */
export function discardCandidate() {
  deleteDatabaseFiles(tempDirectory(), CANDIDATE_NAME);
}

// ───────────────────────── Restore: apply ─────────────────────────

/** Replaces the live data with `source` (a backup or safety file) and brings it to the latest schema. */
async function replaceLiveData(live: SQLiteDatabase, source: File, settings: ReadonlyMap<string, string>) {
  const src = await openDatabaseAsync(source.name, { useNewConnection: true }, source.parentDirectory.uri);
  try {
    await backupDatabaseAsync({ sourceDatabase: src, destDatabase: live });
  } finally {
    await src.closeAsync();
  }
  await dropBackupTables(live);
  applyWhitelistedSettings(settings);
  await migrateDbIfNeeded(live);
  if (!(await isDatabaseHealthy(live, LATEST_VERSION))) {
    throw new Error('The restored data failed the health check.');
  }
}

/** Safety copy of the current data before anything is replaced; keeps the newest 3. */
async function createSafetyBackup(live: SQLiteDatabase, now: Date): Promise<File> {
  const dir = safetyDirectory();
  const { file } = await snapshotUnqueued(live, dir, backupFileName(now, 'safety'), now);
  for (const old of safetyBackupsToDelete(dir.list().map((f) => f.name))) {
    deleteDatabaseFiles(dir, old);
  }
  return file;
}

async function rollbackFromSafety(live: SQLiteDatabase, safety: File) {
  const src = await openDatabaseAsync(safety.name, { useNewConnection: true }, safety.parentDirectory.uri);
  let settings: Map<string, string>;
  try {
    settings = await readBackupSettings(src);
  } finally {
    await src.closeAsync();
  }
  await replaceLiveData(live, safety, settings);
}

/** After any restore or rollback: fresh in-memory stores and a remounted SQLiteProvider. */
function refreshEverything() {
  reloadAppState();
  reloadFlagThresholds();
  // A restored business profile means this phone doesn't need onboarding/setup again.
  if (getAppStateSnapshot().profile) completeOnboarding();
  bumpDataGeneration();
}

/**
 * The full restore. Steps: safety backup → marker → swap (SQLite backup API) → drop backup
 * tables → whitelisted settings → migrations → health check → reconcile → clear marker.
 * ANY failure rolls back from the safety backup (RestoreError 'rolledBack'); if even that
 * fails, the marker stays so the next start tries again ('rollbackFailed').
 */
export async function applyRestore(live: SQLiteDatabase, candidate: RestoreCandidate, now = new Date()) {
  let safety: File | null = null;
  try {
    // ONE queue slot from the safety copy to the end of the swap: no write can slip between.
    await exclusiveWork(async () => {
      safety = await createSafetyBackup(live, now);
      writeRestoreMarker({ stage: 'swapping', safetyBackupUri: safety.uri, startedAt: now.getTime() });
      await replaceLiveData(live, candidate.file, candidate.settings);
    });
    clearRestoreMarker();
  } catch (error) {
    if (!safety) {
      // Nothing was touched yet (the safety copy itself failed).
      throw new RestoreError('rolledBack', error);
    }
    try {
      await exclusiveWork(() => rollbackFromSafety(live, safety!));
      clearRestoreMarker();
    } catch (rollbackError) {
      console.error('[Restore] Rollback failed', rollbackError);
      throw new RestoreError('rollbackFailed', error);
    }
    refreshEverything();
    throw new RestoreError('rolledBack', error);
  } finally {
    discardCandidate();
  }
  try {
    await reconcileAllActiveLoans(live, todayYmd());
  } catch (error) {
    console.error('[Restore] Reconcile failed (screens recompute on open)', error);
  }
  refreshEverything();
}

/**
 * App start (SQLiteProvider onInit, before migrations): a marker means a restore didn't finish
 * (app killed / crashed). Live data that may have been replaced is rolled back from the safety
 * backup unless it is complete and healthy. Returns what happened.
 */
export async function recoverInterruptedRestore(live: SQLiteDatabase): Promise<'none' | 'rolledBack' | 'kept'> {
  cleanupTempFiles();
  const marker = readRestoreMarker();
  if (!marker) return 'none';
  // Healthy = integrity ok, no leftover backup tables, latest schema: the swap fully finished.
  if (await isDatabaseHealthy(live, LATEST_VERSION)) {
    clearRestoreMarker();
    return 'kept';
  }
  const safety = new File(marker.safetyBackupUri);
  if (!safety.exists) {
    console.error('[Restore] Safety backup missing; cannot roll back');
    clearRestoreMarker();
    return 'kept';
  }
  await rollbackFromSafety(live, safety);
  clearRestoreMarker();
  return 'rolledBack';
}

// ───────────────────────── Safety backups (Settings) ─────────────────────────

export interface SafetyBackupInfo {
  name: string;
  uri: string;
  size: number;
  modifiedAt: number | null;
}

export function listSafetyBackups(): SafetyBackupInfo[] {
  const dir = safetyDirectory();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((f): f is File => f instanceof File && f.name.endsWith('.db'))
    .map((f) => ({ name: f.name, uri: f.uri, size: f.size, modifiedAt: f.modificationTime }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function shareSafetyBackup(uri: string) {
  const file = new File(uri);
  await Sharing.shareAsync(file.uri, { mimeType: DB_MIME, dialogTitle: file.name, UTI: 'public.database' });
}

export function deleteSafetyBackup(name: string) {
  deleteDatabaseFiles(safetyDirectory(), name);
}

/** Reset app: safety backups and temp files go too. */
export function wipeBackupFiles() {
  for (const dir of [safetyDirectory(), tempDirectory()]) {
    try {
      if (dir.exists) dir.delete();
    } catch (error) {
      console.warn('[Backup] Could not delete', dir.uri, error);
    }
  }
}
