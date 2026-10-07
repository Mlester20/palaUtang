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
 *
 * Plain rename (to a brand-new spelling): route positions are left untouched. Merge (to an
 * existing area): the moving borrowers are appended after the target area's current route, in
 * their own existing relative order — so a route someone already set stays correct for the
 * borrowers that already lived there, and the newly merged-in ones just continue after it.
 */
export async function renameArea(db: SQLiteDatabase, from: string, to: string) {
  const normalized = normalizeArea(to);
  if (normalized === null || validateArea(to) !== null) throw new AreaError('tooLong');
  return writeTransaction(db, async () => {
    const canonical = await resolveAreaSpelling(db, normalized);
    const now = new Date().toISOString();
    const isMerge = canonical.toLowerCase() !== from.toLowerCase();
    if (!isMerge) {
      const result = await db.runAsync(
        `UPDATE borrowers SET area = ?, updated_at = ?
         WHERE area IS NOT NULL AND lower(area) = lower(?)`,
        [canonical, now, from],
      );
      if (result.changes === 0) throw new AreaError('notFound');
      return;
    }
    const moving = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM borrowers WHERE area IS NOT NULL AND lower(area) = lower(?)
       ORDER BY (route_position IS NULL), route_position, full_name COLLATE NOCASE`,
      [from],
    );
    if (moving.length === 0) throw new AreaError('notFound');
    const base = await db.getFirstAsync<{ m: number | null }>(
      'SELECT MAX(route_position) AS m FROM borrowers WHERE area = ?',
      [canonical],
    );
    let position = (base?.m ?? 0) + 1;
    for (const { id } of moving) {
      await db.runAsync('UPDATE borrowers SET area = ?, route_position = ?, updated_at = ? WHERE id = ?', [
        canonical,
        position,
        now,
        id,
      ]);
      position++;
    }
  });
}

/** Clears an area (and its route position) from every borrower who has it (they keep no area). */
export async function removeArea(db: SQLiteDatabase, area: string) {
  await db.runAsync(
    `UPDATE borrowers SET area = NULL, route_position = NULL, updated_at = ?
     WHERE area IS NOT NULL AND lower(area) = lower(?)`,
    [new Date().toISOString(), area],
  );
}
