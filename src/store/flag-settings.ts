import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { DEFAULT_FLAG_THRESHOLDS, validateThresholds, type FlagThresholds } from '@/lib/flags';

const KEYS = {
  flagAfter: 'flags.flagAfterDays',
  criticalAfter: 'flags.criticalAfterDays',
} as const;

/** Saved thresholds, or the defaults when missing (older installs) or invalid. */
function readThresholds(): FlagThresholds {
  const saved = {
    flagAfter: Number(Storage.getItemSync(KEYS.flagAfter) ?? NaN),
    criticalAfter: Number(Storage.getItemSync(KEYS.criticalAfter) ?? NaN),
  };
  return validateThresholds(saved) === null ? saved : { ...DEFAULT_FLAG_THRESHOLDS };
}

let thresholds: FlagThresholds = readThresholds();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(next: FlagThresholds) {
  thresholds = next;
  listeners.forEach((listener) => listener());
}

export function getFlagThresholds(): FlagThresholds {
  return thresholds;
}

/** Re-renders when Settings changes the thresholds. */
export function useFlagThresholds(): FlagThresholds {
  return useSyncExternalStore(subscribe, () => thresholds);
}

/** Saves only a valid pair (1 ≤ flag < critical ≤ 60); returns false otherwise. */
export function setFlagThresholds(next: FlagThresholds): boolean {
  if (validateThresholds(next) !== null) return false;
  Storage.setItemSync(KEYS.flagAfter, String(next.flagAfter));
  Storage.setItemSync(KEYS.criticalAfter, String(next.criticalAfter));
  update({ ...next });
  return true;
}

/** Re-reads the thresholds from kv-store (e.g. after a restore). */
export function reloadFlagThresholds() {
  update(readThresholds());
}

/** Settings → Reset app: back to the defaults. */
export function clearFlagSettings() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  update({ ...DEFAULT_FLAG_THRESHOLDS });
}
