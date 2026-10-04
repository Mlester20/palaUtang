import type { SQLiteDatabase } from 'expo-sqlite';

import {
  addEntryToParts,
  buildLedger,
  cashCountDifference,
  categoriesFor,
  computeCashOnHand,
  computeLoanRelease,
  EMPTY_PARTS,
  resolveDirection,
  validateAmount,
  validateCashEntry,
  validateEntryDate,
  type CashDirection,
  type CashEntry,
  type CashEntryError,
  type CashEntryInput,
  type CashEntryStatus,
  type CashKind,
  type CashParts,
  type LedgerDay,
  type LoanRelease,
} from '@/lib/cash';
import { addDays } from '@/lib/loan';

import { getCashCollectedByDay, getCashCollectedTotal } from './cash-collected';
import { writeTransaction } from './transaction';

export type CashErrorCode =
  | 'invalid'
  | 'notSetUp'
  | 'alreadySetUp'
  | 'notFound'
  | 'alreadyVoided'
  | 'useAdjustOpening'
  | 'reasonRequired'
  | 'noteRequired'
  | 'entriesBeforeStart'
  | 'stale';

/** Why a cash change was refused (codes are translated in the UI). */
export class CashError extends Error {
  readonly code: CashErrorCode;
  readonly errors: CashEntryError[];
  readonly count: number;
  constructor(code: CashErrorCode, details: { errors?: CashEntryError[]; count?: number } = {}) {
    super(`Cash change rejected: ${code}`);
    this.name = 'CashError';
    this.code = code;
    this.errors = details.errors ?? [];
    this.count = details.count ?? 0;
  }
}

const now = () => new Date().toISOString(); // timestamps only, never dates
const clean = (text: string | null | undefined) => text?.trim() || null;

// ───────────────────────── Setup ─────────────────────────

export interface CashSetup {
  isSetUp: boolean;
  /** Entry date of the active opening row (null before setup). */
  ledgerStartDate: string | null;
  openingAmount: number;
  openingNote: string | null;
}

export async function getCashSetup(db: SQLiteDatabase): Promise<CashSetup> {
  const row = await db.getFirstAsync<{ amount: number; entry_date: string; note: string | null }>(
    "SELECT amount, entry_date, note FROM cash_entries WHERE kind = 'opening' AND status = 'active'",
  );
  return row
    ? { isSetUp: true, ledgerStartDate: row.entry_date, openingAmount: row.amount, openingNote: row.note }
    : { isSetUp: false, ledgerStartDate: null, openingAmount: 0, openingNote: null };
}

function validateOpening(amount: number, startDate: string, today: string) {
  const errors = [...validateAmount(amount, true), ...validateEntryDate(startDate, startDate, today)];
  if (errors.length > 0) throw new CashError('invalid', { errors });
}

async function insertOpening(db: SQLiteDatabase, amount: number, startDate: string, note: string | null) {
  await db.runAsync(
    `INSERT INTO cash_entries (kind, direction, category, amount, entry_date, note, status, created_at)
     VALUES ('opening', 'in', NULL, ?, ?, ?, 'active', ?)`,
    [amount, startDate, clean(note), now()],
  );
}

/** Starts cash tracking: the opening row (amount may be ₱0; start date ≤ today). */
export function setupCash(
  db: SQLiteDatabase,
  openingAmount: number,
  startDate: string,
  note: string | null,
  today: string,
) {
  validateOpening(openingAmount, startDate, today);
  return writeTransaction(db, async () => {
    if ((await getCashSetup(db)).isSetUp) throw new CashError('alreadySetUp');
    await insertOpening(db, openingAmount, startDate, note);
  });
}

/**
 * Replaces the opening balance / start date in ONE transaction (old row voided with the
 * reason). Refused while active entries are dated before the new start date, so moving the
 * start later never silently drops entries.
 */
export function adjustOpening(
  db: SQLiteDatabase,
  newAmount: number,
  newStartDate: string,
  reason: string,
  today: string,
) {
  validateOpening(newAmount, newStartDate, today);
  if (!reason.trim()) throw new CashError('reasonRequired');
  return writeTransaction(db, async () => {
    const old = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM cash_entries WHERE kind = 'opening' AND status = 'active'",
    );
    if (!old) throw new CashError('notSetUp');
    const before = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cash_entries
       WHERE status = 'active' AND kind != 'opening' AND entry_date < ?`,
      [newStartDate],
    );
    if ((before?.n ?? 0) > 0) throw new CashError('entriesBeforeStart', { count: before!.n });
    await db.runAsync(
      "UPDATE cash_entries SET status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?",
      [now(), reason.trim(), old.id],
    );
    await insertOpening(db, newAmount, newStartDate, reason);
  });
}

// ───────────────────────── Parts / summary ─────────────────────────

type ReleaseRow = {
  loan_id: number;
  borrower_name: string;
  start_date: string;
  principal: number;
  status: string;
  netted_amount: number | null;
};

/**
 * Loans whose cash left in fromDate…toDate (by start_date; cancelled excluded). For a renewal,
 * joins the OLD loan's active netted settlement (at most one: unique partial index).
 */
export async function getLoanReleases(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string,
): Promise<LoanRelease[]> {
  const rows = await db.getAllAsync<ReleaseRow>(
    `SELECT l.id AS loan_id, b.full_name AS borrower_name, l.start_date, l.principal, l.status,
            s.amount AS netted_amount
     FROM loans l
     JOIN borrowers b ON b.id = l.borrower_id
     LEFT JOIN payments s ON s.loan_id = l.renewed_from_loan_id
                         AND s.type = 'settlement' AND +s.status = 'active' AND +s.is_netted = 1
     WHERE l.status != 'cancelled' AND l.start_date BETWEEN $from AND $to
     ORDER BY l.start_date, l.id`,
    { $from: fromDate, $to: toDate },
  );
  return rows.map((r) => ({
    loanId: r.loan_id,
    borrowerName: r.borrower_name,
    startDate: r.start_date,
    principal: r.principal,
    nettedAmount: r.netted_amount,
    amount: computeLoanRelease(r, r.netted_amount),
  }));
}

/** Parts for fromDate…toDate: 3 aggregate queries. Also the withdrawals/expenses ON `toDate`. */
async function loadParts(db: SQLiteDatabase, fromDate: string, toDate: string) {
  if (fromDate > toDate) return { parts: { ...EMPTY_PARTS }, withdrawalsOnDay: 0, expensesOnDay: 0 };
  const [entryRows, collected, releases] = await Promise.all([
    db.getAllAsync<{ kind: CashKind; direction: CashDirection; total: number; on_day: number }>(
      `SELECT kind, direction, SUM(amount) AS total,
              SUM(CASE WHEN entry_date = $to THEN amount ELSE 0 END) AS on_day
       FROM cash_entries
       WHERE status = 'active' AND entry_date BETWEEN $from AND $to
       GROUP BY kind, direction`,
      { $from: fromDate, $to: toDate },
    ),
    getCashCollectedTotal(db, fromDate, toDate),
    getLoanReleases(db, fromDate, toDate),
  ]);
  let parts: CashParts = { ...EMPTY_PARTS, collected };
  let withdrawalsOnDay = 0;
  let expensesOnDay = 0;
  for (const r of entryRows) {
    parts = addEntryToParts(parts, { kind: r.kind, direction: r.direction, amount: r.total });
    if (r.kind === 'withdrawal') withdrawalsOnDay += r.on_day;
    if (r.kind === 'expense') expensesOnDay += r.on_day;
  }
  parts.released = releases.reduce((sum, r) => sum + r.amount, 0);
  return { parts, withdrawalsOnDay, expensesOnDay };
}

export interface CashSummary {
  setup: CashSetup;
  asOfDate: string;
  /** null before setup: no cash number is ever shown then. */
  cashOnHand: number | null;
  parts: CashParts;
  /** Withdrawals / expenses dated asOfDate (the Home and Collection "today" figures). */
  withdrawalsToday: number;
  expensesToday: number;
}

/** Cash on hand as of a date + its parts: 4 queries (setup, entries, collected, releases). */
export async function getCashSummary(db: SQLiteDatabase, asOfDate: string): Promise<CashSummary> {
  const setup = await getCashSetup(db);
  if (!setup.isSetUp || setup.ledgerStartDate === null) {
    return { setup, asOfDate, cashOnHand: null, parts: { ...EMPTY_PARTS }, withdrawalsToday: 0, expensesToday: 0 };
  }
  const { parts, withdrawalsOnDay, expensesOnDay } = await loadParts(
    db,
    setup.ledgerStartDate,
    asOfDate,
  );
  return {
    setup,
    asOfDate,
    cashOnHand: computeCashOnHand(parts),
    parts,
    withdrawalsToday: withdrawalsOnDay,
    expensesToday: expensesOnDay,
  };
}

// ───────────────────────── Ledger ─────────────────────────

type EntryRow = {
  id: number;
  kind: CashKind;
  direction: CashDirection;
  category: string | null;
  amount: number;
  entry_date: string;
  note: string | null;
  status: CashEntryStatus;
  void_reason: string | null;
  created_at: string;
};

const toEntry = (r: EntryRow): CashEntry => ({
  id: r.id,
  kind: r.kind,
  direction: r.direction,
  category: r.category,
  amount: r.amount,
  entryDate: r.entry_date,
  note: r.note,
  status: r.status,
  voidReason: r.void_reason,
  createdAt: r.created_at,
});

export interface CashLedger {
  setup: CashSetup;
  /** The range actually shown: clamped to ledger start … today. */
  fromDate: string;
  toDate: string;
  /** Cash on hand at the end of the day before fromDate. */
  balanceBefore: number;
  /** Newest day first, with the running balance after each day. */
  days: LedgerDay[];
}

/**
 * Timeline for fromDate…toDate (clamped to the ledger start and today): one row per day of
 * collections, one per loan release (read-only), every manual entry (voided ones too).
 * 7 queries: setup, 3 for the balance before the range, collections, releases, entries.
 */
export async function getCashLedger(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string,
  today: string,
): Promise<CashLedger> {
  const setup = await getCashSetup(db);
  const start = setup.ledgerStartDate;
  const from = start && fromDate < start ? start : fromDate;
  const to = toDate > today ? today : toDate;
  if (!start || from > to) return { setup, fromDate: from, toDate: to, balanceBefore: 0, days: [] };

  const [before, collections, releases, entryRows] = await Promise.all([
    loadParts(db, start, addDays(from, -1)),
    getCashCollectedByDay(db, from, to),
    getLoanReleases(db, from, to),
    db.getAllAsync<EntryRow>(
      `SELECT id, kind, direction, category, amount, entry_date, note, status, void_reason, created_at
       FROM cash_entries
       WHERE entry_date BETWEEN $from AND $to
       ORDER BY entry_date, id`,
      { $from: from, $to: to },
    ),
  ]);
  const balanceBefore = computeCashOnHand(before.parts);
  return {
    setup,
    fromDate: from,
    toDate: to,
    balanceBefore,
    days: buildLedger({ balanceBefore, collections, releases, entries: entryRows.map(toEntry) }),
  };
}

// ───────────────────────── Writes ─────────────────────────

/** Withdrawal / expense / capital in / adjustment. Validated again inside the transaction. */
export function addCashEntry(db: SQLiteDatabase, input: CashEntryInput, today: string) {
  return writeTransaction(db, async () => {
    const setup = await getCashSetup(db);
    if (!setup.isSetUp) throw new CashError('notSetUp');
    const errors = validateCashEntry(input, setup.ledgerStartDate, today);
    if (errors.length > 0) throw new CashError('invalid', { errors });
    const result = await db.runAsync(
      `INSERT INTO cash_entries (kind, direction, category, amount, entry_date, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        input.kind,
        resolveDirection(input),
        categoriesFor(input.kind).length > 0 ? input.category ?? null : null,
        input.amount,
        input.entryDate,
        clean(input.note),
        now(),
      ],
    );
    return result.lastInsertRowId;
  });
}

/** Voids a manual entry (never deletes). The opening row changes via adjustOpening. */
export function voidCashEntry(db: SQLiteDatabase, id: number, reason: string) {
  if (!reason.trim()) throw new CashError('reasonRequired');
  return writeTransaction(db, async () => {
    const row = await db.getFirstAsync<{ kind: CashKind; status: CashEntryStatus }>(
      'SELECT kind, status FROM cash_entries WHERE id = ?',
      [id],
    );
    if (!row) throw new CashError('notFound');
    if (row.kind === 'opening') throw new CashError('useAdjustOpening');
    if (row.status === 'voided') throw new CashError('alreadyVoided');
    await db.runAsync(
      "UPDATE cash_entries SET status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?",
      [now(), reason.trim(), id],
    );
  });
}

export interface CashCountResult {
  expected: number;
  counted: number;
  difference: number;
  /** null when counted = expected (nothing saved). */
  entryId: number | null;
}

/**
 * Cash count on `date`: expected = cash on hand as of that date (computed in the transaction).
 * A difference becomes an 'adjustment' (in if more cash, out if less), which needs a note.
 * `expectedSeen` (what the screen showed) guards against a stale screen: mismatch → 'stale'.
 */
export function recordCashCount(
  db: SQLiteDatabase,
  { counted, date, note, expectedSeen }: { counted: number; date: string; note: string | null; expectedSeen?: number },
  today: string,
): Promise<CashCountResult> {
  return writeTransaction(db, async () => {
    const setup = await getCashSetup(db);
    if (!setup.isSetUp || !setup.ledgerStartDate) throw new CashError('notSetUp');
    const errors = [
      ...validateAmount(counted, true),
      ...validateEntryDate(date, setup.ledgerStartDate, today),
    ];
    if (errors.length > 0) throw new CashError('invalid', { errors });
    const expected = computeCashOnHand((await loadParts(db, setup.ledgerStartDate, date)).parts);
    if (expectedSeen !== undefined && expectedSeen !== expected) throw new CashError('stale');
    const diff = cashCountDifference(expected, counted);
    if (diff.amount === 0) return { expected, counted, difference: 0, entryId: null };
    if (!note?.trim()) throw new CashError('noteRequired');
    const result = await db.runAsync(
      `INSERT INTO cash_entries (kind, direction, category, amount, entry_date, note, status, created_at)
       VALUES ('adjustment', ?, NULL, ?, ?, ?, 'active', ?)`,
      [diff.direction, diff.amount, date, note.trim(), now()],
    );
    return { expected, counted, difference: diff.difference, entryId: result.lastInsertRowId };
  });
}

// ───────────────────────── Reports ─────────────────────────

export interface CategoryTotal {
  category: string;
  amount: number;
}

export interface OutflowTotals {
  /** Business costs, by category (biggest first). */
  expenses: CategoryTotal[];
  expensesTotal: number;
  /** Owner withdrawals (NOT a business cost), by category. */
  withdrawals: CategoryTotal[];
  withdrawalsTotal: number;
}

/** Active expenses and withdrawals in the range (from the ledger start): ONE grouped query. */
export async function getExpensesAndWithdrawals(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string,
): Promise<OutflowTotals> {
  const rows = await db.getAllAsync<{ kind: CashKind; category: string | null; amount: number }>(
    `SELECT kind, category, SUM(amount) AS amount
     FROM cash_entries
     WHERE status = 'active' AND kind IN ('withdrawal', 'expense')
       AND entry_date BETWEEN $from AND $to
       AND entry_date >= (SELECT entry_date FROM cash_entries
                          WHERE kind = 'opening' AND status = 'active')
     GROUP BY kind, category
     ORDER BY amount DESC`,
    { $from: fromDate, $to: toDate },
  );
  const result: OutflowTotals = { expenses: [], expensesTotal: 0, withdrawals: [], withdrawalsTotal: 0 };
  for (const r of rows) {
    const line = { category: r.category ?? 'other', amount: r.amount };
    if (r.kind === 'expense') {
      result.expenses.push(line);
      result.expensesTotal += r.amount;
    } else {
      result.withdrawals.push(line);
      result.withdrawalsTotal += r.amount;
    }
  }
  return result;
}
