import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Collection tab UI preferences. A device/UI setting, NOT whitelisted in src/lib/backup.ts
 * (BACKUP_SETTING_KEYS), so it never travels with a backup and is never restored.
 */

export type CollectionGroupBy = 'status' | 'area';

const KEY = 'collection.groupBy';

function read(): CollectionGroupBy {
  return Storage.getItemSync(KEY) === 'area' ? 'area' : 'status';
}

let groupBy: CollectionGroupBy = read();
const listeners = new Set<() => void>();

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

/** Settings → Reset app: back to the default (Status). */
export function clearCollectionPrefs() {
  Storage.removeItemSync(KEY);
  groupBy = 'status';
  listeners.forEach((l) => l());
}
