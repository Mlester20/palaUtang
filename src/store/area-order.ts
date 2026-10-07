import Storage from 'expo-sqlite/kv-store';

/**
 * The order of AREAS themselves (not the borrowers inside one) — a JSON array of area names.
 * Whitelisted in src/lib/backup.ts (BACKUP_SETTING_KEYS: 'areas.order'), so it travels with a
 * backup and is restored like the other whitelisted settings; missing = [] (alphabetical).
 */

const KEY = 'areas.order';

export function getAreaOrder(): string[] {
  try {
    const raw = Storage.getItemSync(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setAreaOrder(order: string[]): void {
  Storage.setItemSync(KEY, JSON.stringify(order));
}

/** Area renamed to a brand-new spelling (not a merge): keep its slot in the order. */
export function renameInAreaOrder(from: string, to: string): void {
  const order = getAreaOrder();
  const index = order.findIndex((a) => a.toLowerCase() === from.toLowerCase());
  if (index !== -1) {
    const next = [...order];
    next[index] = to;
    setAreaOrder(next);
  }
}

/** Area merged into an existing one, or removed entirely: drop its slot. */
export function removeFromAreaOrder(name: string): void {
  const order = getAreaOrder();
  const next = order.filter((a) => a.toLowerCase() !== name.toLowerCase());
  if (next.length !== order.length) setAreaOrder(next);
}

/** Settings → Reset app. */
export function clearAreaOrder(): void {
  Storage.removeItemSync(KEY);
}
