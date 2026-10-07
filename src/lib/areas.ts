/**
 * Collection areas (routes) for borrowers. Pure text rules only; the case-insensitive "reuse
 * an existing spelling" lookup is a database concern (src/db/areas.ts), since it needs to see
 * what other borrowers already typed.
 *
 * Examples: "  palengke  " -> "palengke"; "Purok   3" -> "Purok 3"; "" -> null.
 */

export const MAX_AREA_LENGTH = 40;

/** Trims and collapses internal whitespace; an empty result becomes null (no area). */
export function normalizeArea(text: string): string | null {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  return collapsed === '' ? null : collapsed;
}

export type AreaError = 'tooLong';

/** Only length is checked here; the existing-spelling reuse happens in the data layer. */
export function validateArea(text: string): AreaError | null {
  const normalized = normalizeArea(text);
  return normalized && normalized.length > MAX_AREA_LENGTH ? 'tooLong' : null;
}

// ───────────────────────── Area order (Phase 16: route order) ─────────────────────────

/** Index of `area` in the saved order (case-insensitive), or Infinity if it isn't listed. */
export function areaRank(area: string, order: readonly string[]): number {
  const i = order.findIndex((o) => o.toLowerCase() === area.toLowerCase());
  return i === -1 ? Infinity : i;
}

/**
 * Comparator for anything shaped `{ area: string | null }`: areas in `order` come first (in that
 * order), then any other named area A–Z, and "No area" (null) always last. Shared by the
 * Collection area grouping/chips and the Route order screens so they agree on one ordering.
 */
export function compareByAreaOrder(
  a: { area: string | null },
  b: { area: string | null },
  order: readonly string[],
): number {
  if (a.area === null) return b.area === null ? 0 : 1;
  if (b.area === null) return -1;
  return areaRank(a.area, order) - areaRank(b.area, order) || a.area.localeCompare(b.area);
}
