/**
 * Pure array-reorder helpers for the Route order draft screens (src/app/route/*). No database,
 * no React: screens keep the draft in useState and call these to produce the next array.
 */

/** Swaps `index` with its neighbour `delta` steps away (-1 = up, +1 = down); no-op at the edges. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function moveToTop<T>(list: readonly T[], index: number): T[] {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.unshift(item!);
  return next;
}

export function moveToBottom<T>(list: readonly T[], index: number): T[] {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.push(item!);
  return next;
}

/** `position` is 1-based and clamped to the list's range. */
export function moveToPosition<T>(list: readonly T[], index: number, position: number): T[] {
  const next = [...list];
  const [item] = next.splice(index, 1);
  const target = Math.max(0, Math.min(next.length, position - 1));
  next.splice(target, 0, item!);
  return next;
}

export function reverseList<T>(list: readonly T[]): T[] {
  return [...list].reverse();
}
