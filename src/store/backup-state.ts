import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import {
  BACKUP_SETTING_KEYS,
  DEFAULT_REMINDER_DAYS,
  REMINDER_DAY_OPTIONS,
  type BackupCounts,
} from '@/lib/backup';

/** Device-only keys: NEVER written into a backup, never restored. */
const KEYS = {
  lastBackupAt: 'backup.lastBackupAt',
  lastBackupCounts: 'backup.lastBackupCounts',
  reminderDays: 'backup.reminderDays',
  reminderDismissedUntil: 'backup.reminderDismissedUntil',
  restoreInProgress: 'backup.restoreInProgress',
} as const;

// ───────────────────────── Status (last backup, reminder) ─────────────────────────

export interface BackupStatus {
  /** ms timestamp of the last successful export (null = never). */
  lastBackupAt: number | null;
  lastBackupCounts: BackupCounts | null;
  /** 0 = Off. */
  reminderDays: number;
  reminderDismissedUntil: number | null;
}

function readNumber(key: string): number | null {
  const raw = Storage.getItemSync(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readStatus(): BackupStatus {
  let counts: BackupCounts | null = null;
  try {
    const raw = Storage.getItemSync(KEYS.lastBackupCounts);
    counts = raw ? (JSON.parse(raw) as BackupCounts) : null;
  } catch {
    counts = null;
  }
  const days = readNumber(KEYS.reminderDays);
  return {
    lastBackupAt: readNumber(KEYS.lastBackupAt),
    lastBackupCounts: counts,
    reminderDays:
      days !== null && (REMINDER_DAY_OPTIONS as readonly number[]).includes(days)
        ? days
        : DEFAULT_REMINDER_DAYS,
    reminderDismissedUntil: readNumber(KEYS.reminderDismissedUntil),
  };
}

let status = readStatus();
const statusListeners = new Set<() => void>();

function setStatus(next: BackupStatus) {
  status = next;
  statusListeners.forEach((l) => l());
}

export function getBackupStatus(): BackupStatus {
  return status;
}

export function useBackupStatus(): BackupStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );
}

/** "Last backup exported": the file was shared/saved without an error. */
export function markBackupExported(at: number, counts: BackupCounts) {
  Storage.setItemSync(KEYS.lastBackupAt, String(at));
  Storage.setItemSync(KEYS.lastBackupCounts, JSON.stringify(counts));
  Storage.removeItemSync(KEYS.reminderDismissedUntil);
  setStatus({ ...status, lastBackupAt: at, lastBackupCounts: counts, reminderDismissedUntil: null });
}

export function setReminderDays(days: number) {
  Storage.setItemSync(KEYS.reminderDays, String(days));
  setStatus({ ...status, reminderDays: days });
}

export function dismissReminderUntil(until: number) {
  Storage.setItemSync(KEYS.reminderDismissedUntil, String(until));
  setStatus({ ...status, reminderDismissedUntil: until });
}

/** Reset app: last-backup info, reminder settings and any restore marker. */
export function clearBackupState() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  setStatus(readStatus());
}

// ───────────────────────── Restore marker ─────────────────────────

export interface RestoreMarker {
  /** Written right after the safety backup: from here on the live data may be replaced. */
  stage: 'swapping';
  safetyBackupUri: string;
  startedAt: number;
}

export function readRestoreMarker(): RestoreMarker | null {
  const raw = Storage.getItemSync(KEYS.restoreInProgress);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RestoreMarker;
  } catch {
    return null;
  }
}

export function writeRestoreMarker(marker: RestoreMarker) {
  Storage.setItemSync(KEYS.restoreInProgress, JSON.stringify(marker));
}

export function clearRestoreMarker() {
  Storage.removeItemSync(KEYS.restoreInProgress);
}

// ───────────────────────── Whitelisted settings ─────────────────────────

/** The whitelisted kv values to put in a backup (missing keys are skipped). */
export function readWhitelistedSettings(): [string, string][] {
  const pairs: [string, string][] = [];
  for (const key of BACKUP_SETTING_KEYS) {
    const value = Storage.getItemSync(key);
    if (value !== null) pairs.push([key, value]);
  }
  return pairs;
}

/**
 * Restore REPLACES the whitelisted settings: keys in the backup are written, whitelisted keys
 * missing from it are removed (back to defaults). Anything else in the backup is ignored, and
 * App Lock / onboarding / backup keys are never touched.
 */
export function applyWhitelistedSettings(settings: ReadonlyMap<string, string>) {
  for (const key of BACKUP_SETTING_KEYS) {
    const value = settings.get(key);
    if (value === undefined) Storage.removeItemSync(key);
    else Storage.setItemSync(key, value);
  }
}

// ───────────────────────── Operation lock + overlay + remount ─────────────────────────

export type DataOperation = 'backup' | 'restore' | 'export';

let busy: DataOperation | null = null;
/** Bumped after a restore: the root layout keys SQLiteProvider on it to remount everything. */
let generation = 0;
const opListeners = new Set<() => void>();
const notifyOps = () => opListeners.forEach((l) => l());
const subscribeOps = (l: () => void) => {
  opListeners.add(l);
  return () => opListeners.delete(l);
};

export class OperationBusyError extends Error {
  constructor(readonly running: DataOperation) {
    super(`Another data operation is running: ${running}`);
    this.name = 'OperationBusyError';
  }
}

/** One backup / restore / export at a time (also stops double taps). */
export async function runDataOperation<T>(kind: DataOperation, task: () => Promise<T>): Promise<T> {
  if (busy !== null) throw new OperationBusyError(busy);
  busy = kind;
  notifyOps();
  try {
    return await task();
  } finally {
    busy = null;
    notifyOps();
  }
}

export function useDataOperation(): DataOperation | null {
  return useSyncExternalStore(subscribeOps, () => busy);
}

export function useDataGeneration(): number {
  return useSyncExternalStore(subscribeOps, () => generation);
}

export function bumpDataGeneration() {
  generation += 1;
  notifyOps();
}
