import type { SQLiteDatabase } from 'expo-sqlite';

import { normalizeArea, validateArea } from '@/lib/areas';

import { writeTransaction } from './transaction';

/**
 * Case-insensitive match against what's already on other borrowers: typing "palengke" when
 * "Palengke" exists reuses "Palengke" (the already-saved casing wins). Returns `normalized`
 * unchanged when nothing matches (it becomes the new canonical spelling).
 */
export async function resolveAreaSpelling(
  db: SQLiteDatabase,
  normalized: string,
): Promise<string> {
  const row = await db.getFirstAsync<{ area: string }>(
    "SELECT area FROM borrowers WHERE area IS NOT NULL AND lower(area) = lower(?) LIMIT 1",
    [normalized],
  );
  return row?.area ?? normalized;
}

/** Normalises free text into what to store: null, or an existing spelling, or the typed one. */
export async function resolveArea(
  db: SQLiteDatabase,
  text: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeArea(text ?? '');
  if (normalized === null) return null;
  if (validateArea(text ?? '') !== null) throw new Error(`Area must be ${40} characters or fewer.`);
  return resolveAreaSpelling(db, normalized);
}

export interface AreaSummary {
  area: string;
  /** All borrowers with this area, active and archived (renaming/removing affects everyone). */
  borrowerCount: number;
}

/** Every area in use, A–Z, with how many borrowers have it. */
export async function getAreas(db: SQLiteDatabase): Promise<AreaSummary[]> {
  const rows = await db.getAllAsync<{ area: string; borrower_count: number }>(
    `SELECT area, COUNT(*) AS borrower_count
     FROM borrowers
     WHERE area IS NOT NULL
     GROUP BY area
     ORDER BY area COLLATE NOCASE`,
  );
  return rows.map((r) => ({ area: r.area, borrowerCount: r.borrower_count }));
}

/** The most-used areas, for suggestion chips on the borrower form. */
export async function getMostUsedAreas(db: SQLiteDatabase, limit = 8): Promise<string[]> {
  const rows = await db.getAllAsync<{ area: string }>(
    `SELECT area, COUNT(*) AS n
     FROM borrowers
     WHERE area IS NOT NULL
     GROUP BY area
     ORDER BY n DESC, area COLLATE NOCASE
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.area);
}

export class AreaError extends Error {
  readonly reason: 'tooLong' | 'notFound';
  constructor(reason: 'tooLong' | 'notFound') {
    super(`Area rejected: ${reason}`);
    this.name = 'AreaError';
    this.reason = reason;
  }
}

/**
 * Renames an area on every borrower who has it, in ONE transaction. Renaming to a spelling
 * that (case-insensitively) already exists MERGES the two: every borrower ends up on the
 * single existing spelling, since area is just a text column, not a separate table.
 */
export async function renameArea(db: SQLiteDatabase, from: string, to: string) {
  const normalized = normalizeArea(to);
  if (normalized === null || validateArea(to) !== null) throw new AreaError('tooLong');
  return writeTransaction(db, async () => {
    const canonical = await resolveAreaSpelling(db, normalized);
    const now = new Date().toISOString();
    const result = await db.runAsync(
      `UPDATE borrowers SET area = ?, updated_at = ?
       WHERE area IS NOT NULL AND lower(area) = lower(?)`,
      [canonical, now, from],
    );
    if (result.changes === 0) throw new AreaError('notFound');
  });
}

/** Clears an area from every borrower who has it (they keep no area). */
export async function removeArea(db: SQLiteDatabase, area: string) {
  await db.runAsync(
    `UPDATE borrowers SET area = NULL, updated_at = ?
     WHERE area IS NOT NULL AND lower(area) = lower(?)`,
    [new Date().toISOString(), area],
  );
}
