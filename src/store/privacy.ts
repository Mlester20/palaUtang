import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Privacy mode settings. Device-level UI preference — deliberately NOT in the Phase 11 backup
 * whitelist (src/lib/backup.ts), so it never travels with a backup and Restore never changes it.
 */

export type PrivacyStart = 'remember' | 'always';

const KEYS = {
  enabled: 'privacy.enabled',
  hideBorrowerAmounts: 'privacy.hideBorrowerAmounts',
  start: 'privacy.start',
} as const;

export interface PrivacySettings {
  enabled: boolean;
  hideBorrowerAmounts: boolean;
  start: PrivacyStart;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = Storage.getItemSync(key);
  return raw === null ? fallback : raw === 'true';
}

function readStart(): PrivacyStart {
  return Storage.getItemSync(KEYS.start) === 'always' ? 'always' : 'remember';
}

function readSettings(): PrivacySettings {
  return {
    enabled: readBool(KEYS.enabled, false),
    hideBorrowerAmounts: readBool(KEYS.hideBorrowerAmounts, false),
    start: readStart(),
  };
}

let settings = readSettings();
// "Always start hidden": forced (and persisted) on every cold start, BEFORE anything reads
// `settings` for its first render — so the very first frame is already masked, not just the
// next one. Read once per app process (this module only loads once).
if (settings.start === 'always' && !settings.enabled) {
  Storage.setItemSync(KEYS.enabled, 'true');
  settings = { ...settings, enabled: true };
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getPrivacySettings(): PrivacySettings {
  return settings;
}

export function usePrivacySettings(): PrivacySettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

export function setPrivacyEnabled(enabled: boolean) {
  Storage.setItemSync(KEYS.enabled, String(enabled));
  settings = { ...settings, enabled };
  notify();
}

export function setHideBorrowerAmounts(value: boolean) {
  Storage.setItemSync(KEYS.hideBorrowerAmounts, String(value));
  settings = { ...settings, hideBorrowerAmounts: value };
  notify();
}

export function setPrivacyStart(start: PrivacyStart) {
  Storage.setItemSync(KEYS.start, start);
  settings = { ...settings, start };
  notify();
}

/** Settings → Reset app. */
export function clearPrivacySettings() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  settings = readSettings();
  notify();
}
