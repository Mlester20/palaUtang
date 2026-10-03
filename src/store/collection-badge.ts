import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { getCollectionList } from '@/db/collection';
import { summarizeCollection } from '@/lib/collection';
import { todayYmd } from '@/lib/loan';

/** Number of loans still to collect today, shown on the Collection tab icon. */
let count = 0;
const listeners = new Set<() => void>();

export function setCollectionBadge(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((listener) => listener());
}

export function useCollectionBadge(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => count,
  );
}

/** Re-counts from the database (one query). Errors are logged, never thrown. */
export async function refreshCollectionBadge(db: SQLiteDatabase) {
  try {
    setCollectionBadge(summarizeCollection(await getCollectionList(db, todayYmd())).toCollectCount);
  } catch (error) {
    console.warn('[Collection badge] refresh failed', error);
  }
}
