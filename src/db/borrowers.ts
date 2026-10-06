import type { SQLiteDatabase } from 'expo-sqlite';

import { normalizePhPhone } from '@/lib/phone';
import type { Borrower, BorrowerInput, GetBorrowersOptions } from '@/types/borrower';

import { resolveArea } from './areas';

type BorrowerRow = {
  id: number;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  area: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  'id, full_name, nickname, phone, address, notes, area, archived_at, created_at, updated_at';

function toBorrower(row: BorrowerRow): Borrower {
  return {
    id: row.id,
    fullName: row.full_name,
    nickname: row.nickname,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    area: row.area,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Trims text; empty optional fields become NULL. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function toParams(input: BorrowerInput) {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error('Full name is required.');
  const phone = clean(input.phone);
  return {
    fullName,
    nickname: clean(input.nickname),
    phone: phone ? normalizePhPhone(phone) : null,
    address: clean(input.address),
    notes: clean(input.notes),
  };
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Active borrowers (optionally archived too), A–Z. Search matches name, nickname, phone or
 * area. `area` filters to that exact area (case-insensitive); pass '' for "No area".
 */
export async function getBorrowers(
  db: SQLiteDatabase,
  { search = '', includeArchived = false, area }: GetBorrowersOptions = {},
): Promise<Borrower[]> {
  const term = search.trim();
  // Phone numbers are stored without spaces/dashes, so search them the same way.
  const phoneTerm = normalizePhPhone(term);
  const rows = await db.getAllAsync<BorrowerRow>(
    `SELECT ${COLUMNS} FROM borrowers
     WHERE ($includeArchived = 1 OR archived_at IS NULL)
       AND ($term = ''
         OR full_name LIKE $namePattern ESCAPE '\\'
         OR nickname LIKE $namePattern ESCAPE '\\'
         OR phone LIKE $phonePattern ESCAPE '\\'
         OR area LIKE $namePattern ESCAPE '\\')
       AND ($area IS NULL OR ($area = '' AND area IS NULL) OR lower(area) = lower($area))
     ORDER BY full_name COLLATE NOCASE ASC, id ASC`,
    {
      $includeArchived: includeArchived ? 1 : 0,
      $term: term,
      $namePattern: likePattern(term),
      $phonePattern: likePattern(phoneTerm || term),
      $area: area ?? null,
    },
  );
  return rows.map(toBorrower);
}

export async function getBorrowerById(db: SQLiteDatabase, id: number): Promise<Borrower | null> {
  const row = await db.getFirstAsync<BorrowerRow>(`SELECT ${COLUMNS} FROM borrowers WHERE id = ?`, [
    id,
  ]);
  return row ? toBorrower(row) : null;
}

/** Other borrowers (active or archived) with the same full name, ignoring case and spacing. */
export async function findBorrowersWithSameName(
  db: SQLiteDatabase,
  fullName: string,
  excludeId?: number,
): Promise<Borrower[]> {
  const rows = await db.getAllAsync<BorrowerRow>(
    `SELECT ${COLUMNS} FROM borrowers
     WHERE lower(trim(full_name)) = lower(trim(?)) AND id != ?`,
    [fullName, excludeId ?? -1],
  );
  return rows.map(toBorrower);
}

/** Returns the new borrower's id. */
export async function createBorrower(db: SQLiteDatabase, input: BorrowerInput): Promise<number> {
  const p = toParams(input);
  const area = await resolveArea(db, input.area);
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO borrowers (full_name, nickname, phone, address, notes, area, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.fullName, p.nickname, p.phone, p.address, p.notes, area, now, now],
  );
  return result.lastInsertRowId;
}

export async function updateBorrower(db: SQLiteDatabase, id: number, input: BorrowerInput) {
  const p = toParams(input);
  const area = await resolveArea(db, input.area);
  const result = await db.runAsync(
    `UPDATE borrowers
     SET full_name = ?, nickname = ?, phone = ?, address = ?, notes = ?, area = ?, updated_at = ?
     WHERE id = ?`,
    [p.fullName, p.nickname, p.phone, p.address, p.notes, area, new Date().toISOString(), id],
  );
  if (result.changes === 0) throw new Error('Borrower not found.');
}

export class BorrowerHasActiveLoansError extends Error {
  constructor() {
    super('This borrower still has an active loan.');
    this.name = 'BorrowerHasActiveLoansError';
  }
}

/**
 * Soft delete: hides the borrower but keeps the row (their loans stay intact).
 * Refused while the borrower has an active loan.
 */
export async function archiveBorrower(db: SQLiteDatabase, id: number) {
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE borrowers SET archived_at = ?, updated_at = ?
     WHERE id = ? AND archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM loans WHERE borrower_id = ? AND status = 'active')`,
    [now, now, id, id],
  );
  if (result.changes === 0) {
    const active = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status = 'active'",
      [id],
    );
    if ((active?.n ?? 0) > 0) throw new BorrowerHasActiveLoansError();
  }
}

export async function restoreBorrower(db: SQLiteDatabase, id: number) {
  await db.runAsync('UPDATE borrowers SET archived_at = NULL, updated_at = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
}
