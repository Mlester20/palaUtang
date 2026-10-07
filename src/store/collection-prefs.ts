import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Collection tab UI preferences. A device/UI setting, NOT whitelisted in src/lib/backup.ts
 * (BACKUP_SETTING_KEYS), so it never travels with a backup and is never restored.
 */

export type CollectionGroupBy = 'status' | 'area';
/** Order of rows within an Area section: the saved route, or Phase 12's most-overdue-first. */
export type WithinAreaSort = 'route' | 'overdue';

const KEY = 'collection.groupBy';
const WITHIN_AREA_KEY = 'collection.withinAreaSort';

function read(): CollectionGroupBy {
  return Storage.getItemSync(KEY) === 'area' ? 'area' : 'status';
}

function readWithinAreaSort(): WithinAreaSort {
  return Storage.getItemSync(WITHIN_AREA_KEY) === 'overdue' ? 'overdue' : 'route';
}

let groupBy: CollectionGroupBy = read();
let withinAreaSort: WithinAreaSort = readWithinAreaSort();
const listeners = new Set<() => void>();
const withinAreaListeners = new Set<() => void>();

export function getCollectionGroupBy(): CollectionGroupBy {
  return groupBy;
}

export function useCollectionGroupBy(): CollectionGroupBy {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => groupBy,
  );
}

export function setCollectionGroupBy(next: CollectionGroupBy) {
  Storage.setItemSync(KEY, next);
  groupBy = next;
  listeners.forEach((l) => l());
}

export function getWithinAreaSort(): WithinAreaSort {
  return withinAreaSort;
}

export function useWithinAreaSort(): WithinAreaSort {
  return useSyncExternalStore(
    (listener) => {
      withinAreaListeners.add(listener);
      return () => withinAreaListeners.delete(listener);
    },
    () => withinAreaSort,
  );
}

export function setWithinAreaSort(next: WithinAreaSort) {
  Storage.setItemSync(WITHIN_AREA_KEY, next);
  withinAreaSort = next;
  withinAreaListeners.forEach((l) => l());
}

/** Settings → Reset app: back to the defaults (Status, Route order). */
export function clearCollectionPrefs() {
  Storage.removeItemSync(KEY);
  Storage.removeItemSync(WITHIN_AREA_KEY);
  groupBy = 'status';
  withinAreaSort = 'route';
  listeners.forEach((l) => l());
  withinAreaListeners.forEach((l) => l());
}
