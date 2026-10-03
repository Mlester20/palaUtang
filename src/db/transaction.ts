import type { SQLiteDatabase } from 'expo-sqlite';

// expo-sqlite's withTransactionAsync can't nest: a second BEGIN while one is open fails with
// "cannot start a transaction within a transaction". Background work (reconcile on foreground)
// can overlap with user saves, so every write transaction goes through this one queue.
let queue: Promise<unknown> = Promise.resolve();

/** Runs `task` after all previously queued tasks, one at a time. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** One write transaction on the main connection (foreign keys ON), queued behind any other. */
export function writeTransaction<T>(db: SQLiteDatabase, task: () => Promise<T>): Promise<T> {
  return serialize(async () => {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task();
    });
    return result;
  });
}

/** Queues work that manages its own transactions (e.g. Reset app), so nothing interleaves. */
export function exclusiveWork<T>(task: () => Promise<T>): Promise<T> {
  return serialize(task);
}
