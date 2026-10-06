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
