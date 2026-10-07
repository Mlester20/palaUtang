import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { addDays } from '@/lib/loan';

/**
 * End of Day report preferences and counted-cash values. Device-level UI state, NOT whitelisted
 * in src/lib/backup.ts, so none of this travels with a backup.
 */

const KEYS = {
  includeCash: 'eod.includeCash',
  includeProfit: 'eod.includeProfit',
  includeBorrowerLists: 'eod.includeBorrowerLists',
  counts: 'eod.counts',
} as const;

const PRUNE_AFTER_DAYS = 60;

export interface EodOptions {
  includeCash: boolean;
  includeProfit: boolean;
  includeBorrowerLists: boolean;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = Storage.getItemSync(key);
  return raw === null ? fallback : raw === 'true';
}

function readOptions(): EodOptions {
  return {
    includeCash: readBool(KEYS.includeCash, true),
    includeProfit: readBool(KEYS.includeProfit, false),
    includeBorrowerLists: readBool(KEYS.includeBorrowerLists, false),
  };
}

let options = readOptions();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getEodOptions(): EodOptions {
  return options;
}

export function useEodOptions(): EodOptions {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => options,
  );
}

export function setEodOption<K extends keyof EodOptions>(key: K, value: EodOptions[K]) {
  Storage.setItemSync(KEYS[key], String(value));
  options = { ...options, [key]: value };
  notify();
}

// ───────────────────────── Counted cash per date ─────────────────────────

function readCounts(): Record<string, number> {
  try {
    const raw = Storage.getItemSync(KEYS.counts);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Drops entries older than PRUNE_AFTER_DAYS relative to `today`. */
function pruned(counts: Record<string, number>, today: string): Record<string, number> {
  const cutoff = addDays(today, -PRUNE_AFTER_DAYS);
  const next: Record<string, number> = {};
  for (const [date, amount] of Object.entries(counts)) {
    if (date >= cutoff) next[date] = amount;
  }
  return next;
}

/** The counted cash remembered for `date` (centavos), or null if never entered. */
export function getEodCount(date: string): number | null {
  const amount = readCounts()[date];
  return typeof amount === 'number' ? amount : null;
}

export function setEodCount(date: string, amount: number, today: string) {
  const counts = pruned(readCounts(), today);
  counts[date] = amount;
  Storage.setItemSync(KEYS.counts, JSON.stringify(counts));
}

/** Settings → Reset app: options back to defaults, every remembered count cleared. */
export function clearEodPrefs() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  options = readOptions();
  notify();
}
