/**
 * Pure collection-day logic: no database, no React. Money = integer centavos, dates = local
 * 'YYYY-MM-DD'. Rows come from getCollectionList (src/db/collection.ts), which reads the
 * installment cache kept by recomputeLoan; amounts use REGULAR installments only (make-up rows
 * are extra collection days for money already counted as overdue, so they'd double count).
 *
 * Definitions:
 *  - due today   = outstanding on regular installments with due_date = today
 *  - overdue     = outstanding on regular installments with due_date < today
 *  - to collect  = due today + overdue (per loan)
 *  - collected   = active payments with paid_on = today (incl. overdue recovery and advance)
 *  - remaining   = sum of "to collect" over active loans
 *  - progress    = collected ÷ (collected + remaining); null when both are 0 (empty state)
 *
 * Worked examples (₱150/day loans; today = T):
 *  A. Three loans with ₱150 due on T, nothing paid → 3 'due_today' rows; remaining ₱450,
 *     collected ₱0, progress 0%.
 *  B. Collect ₱150 on one → its row is 'paid_today' (Paid section); collected ₱150,
 *     remaining ₱300, progress 150 ÷ 450 = 33%. Undo voids it → back to A.
 *  C. Two balda days + today → 'overdue', to collect ₱450 ("₱150 today + ₱300 overdue (2 days)");
 *     collecting ₱450 fills the two missed days first, then today (oldest-first in Phase 6).
 *  D. Today's installment was paid yesterday (advance) → due today ₱0 outstanding and the
 *     covering payment is dated before T → 'paid_in_advance' (Paid section, not To Collect).
 *  E. Lump sum due on T → 'due_today'; another lump sum past due → 'overdue' with days overdue
 *     from its due date (no make-up rows exist for lump sums).
 *  F. Sunday + skip_sundays: the schedule has no regular row on Sunday, so nothing is due
 *     today; any overdue amount still makes it an 'overdue' row.
 *  G. A payment that completes a loan → the loan is 'completed', has nothing to collect, but
 *     its payment today keeps it in the Paid section (and in the Collected list).
 */

import { compareByAreaOrder } from './areas';
import { daysBetween, type PaymentType } from './loan';

import type { LoanStatus } from '@/types/loan';

/** One loan's collection numbers for a given day (from getCollectionList). */
export interface CollectionRow {
  loanId: number;
  borrowerId: number;
  borrowerName: string;
  nickname: string | null;
  phone: string | null;
  area: string | null;
  /** 1-based rank within `area`'s route; null = no area, or not yet placed on one. */
  routePosition: number | null;
  paymentType: PaymentType;
  loanStatus: LoanStatus;
  /** Regular installment amount (daily hulog, or the lump sum). */
  installmentAmount: number;
  /** Full amount of today's regular installment(s), paid or not. */
  dueTodayAmount: number;
  dueTodayOutstanding: number;
  overdueOutstanding: number;
  /** Daily: fully missed past-due days. */
  baldaDays: number;
  /** Oldest past-due date with money still owed (null if nothing overdue). */
  oldestOverdueDate: string | null;
  /** Active payments on this loan dated today. */
  collectedToday: number;
  /** Latest paid_on among active payments covering today's installment (null if none). */
  todayCoveredLastPaidOn: string | null;
}

export type CollectionStatus =
  'overdue' | 'due_today' | 'partial' | 'paid_today' | 'paid_in_advance';

export interface ClassifiedRow extends CollectionRow {
  status: CollectionStatus;
  toCollect: number;
  /** Lump sum: days since the oldest unpaid due date (0 if not overdue). */
  daysOverdue: number;
}

export function classifyRow(row: CollectionRow, today: string): ClassifiedRow {
  const toCollect =
    row.loanStatus === 'active' ? row.dueTodayOutstanding + row.overdueOutstanding : 0;
  const daysOverdue = row.oldestOverdueDate ? daysBetween(row.oldestOverdueDate, today) : 0;

  let status: CollectionStatus;
  if (toCollect > 0 && row.overdueOutstanding > 0) status = 'overdue';
  else if (toCollect > 0)
    status = row.dueTodayOutstanding < row.dueTodayAmount ? 'partial' : 'due_today';
  else if (
    row.dueTodayAmount > 0 &&
    row.todayCoveredLastPaidOn !== null &&
    row.todayCoveredLastPaidOn < today &&
    row.collectedToday === 0
  )
    status = 'paid_in_advance';
  else status = 'paid_today';

  return { ...row, status, toCollect, daysOverdue };
}

export type CollectionFilter = 'all' | 'overdue' | 'daily' | 'lump_sum';

/** 'all' = every borrower, 'none' = "No area", anything else = that exact area (case-insensitive). */
export type CollectionAreaFilter = 'all' | 'none' | string;

export function matchesAreaFilter(row: Pick<ClassifiedRow, 'area'>, filter: CollectionAreaFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return row.area === null;
  return row.area !== null && row.area.toLowerCase() === filter.toLowerCase();
}

export function matchesFilter(row: ClassifiedRow, filter: CollectionFilter): boolean {
  switch (filter) {
    case 'overdue':
      return row.status === 'overdue';
    case 'daily':
      return row.paymentType === 'daily';
    case 'lump_sum':
      return row.paymentType === 'lump_sum';
    default:
      return true;
  }
}

/** Case-insensitive match on name, nickname, or phone (digits only for phone). */
export function matchesSearch(row: CollectionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return (
    row.borrowerName.toLowerCase().includes(q) ||
    (row.nickname?.toLowerCase().includes(q) ?? false) ||
    (digits.length > 0 && (row.phone?.replace(/\D/g, '').includes(digits) ?? false))
  );
}

export interface CollectionSections {
  /** Most overdue first. */
  overdue: ClassifiedRow[];
  /** Due today + partial, A–Z. */
  dueToday: ClassifiedRow[];
  /** Paid today or in advance, A–Z. */
  paid: ClassifiedRow[];
}

const byName = (a: ClassifiedRow, b: ClassifiedRow) =>
  a.borrowerName.localeCompare(b.borrowerName) || a.loanId - b.loanId;

/** Most overdue first (oldest shortfall), then biggest amount, then name — shared by both groupings. */
const byMostOverdue = (a: ClassifiedRow, b: ClassifiedRow) =>
  (a.oldestOverdueDate ?? '').localeCompare(b.oldestOverdueDate ?? '') ||
  b.overdueOutstanding - a.overdueOutstanding ||
  byName(a, b);

export function groupCollection(
  rows: ClassifiedRow[],
  filter: CollectionFilter = 'all',
  search = '',
  areaFilter: CollectionAreaFilter = 'all',
): CollectionSections {
  const visible = rows.filter(
    (r) => matchesFilter(r, filter) && matchesSearch(r, search) && matchesAreaFilter(r, areaFilter),
  );
  return {
    overdue: visible.filter((r) => r.status === 'overdue').sort(byMostOverdue),
    dueToday: visible
      .filter((r) => r.status === 'due_today' || r.status === 'partial')
      .sort(byName),
    paid: visible
      .filter((r) => r.status === 'paid_today' || r.status === 'paid_in_advance')
      .sort(byName),
  };
}

export interface AreaGroupSection {
  /** null = "No area" (always sorts last). */
  area: string | null;
  toCollectCount: number;
  toCollectAmount: number;
  /** Overdue first (most overdue first), then due today / partial. */
  rows: ClassifiedRow[];
  /** Paid today / in advance, A–Z; shown only when "Show paid" is on. */
  paidRows: ClassifiedRow[];
}

/**
 * Collection grouped by area instead of status: one section per area, following `order` (areas
 * not listed sort A–Z after the listed ones; "No area" always last — see compareByAreaOrder).
 * Inside each section: overdue first (most overdue first), then due today ("Most overdue first"
 * within-area preference — see groupByAreaRouteOrder for "Route order").
 */
export function groupByArea(
  rows: ClassifiedRow[],
  filter: CollectionFilter = 'all',
  search = '',
  areaFilter: CollectionAreaFilter = 'all',
  order: readonly string[] = [],
): AreaGroupSection[] {
  const visible = rows.filter(
    (r) => matchesFilter(r, filter) && matchesSearch(r, search) && matchesAreaFilter(r, areaFilter),
  );
  const byArea = new Map<string | null, ClassifiedRow[]>();
  for (const r of visible) {
    const key = r.area;
    const list = byArea.get(key);
    if (list) list.push(r);
    else byArea.set(key, [r]);
  }
  const sections: AreaGroupSection[] = [];
  for (const [area, list] of byArea) {
    const toCollectRows = [
      ...list.filter((r) => r.status === 'overdue').sort(byMostOverdue),
      ...list.filter((r) => r.status === 'due_today' || r.status === 'partial').sort(byName),
    ];
    sections.push({
      area,
      toCollectCount: toCollectRows.length,
      toCollectAmount: toCollectRows.reduce((sum, r) => sum + r.toCollect, 0),
      rows: toCollectRows,
      paidRows: list
        .filter((r) => r.status === 'paid_today' || r.status === 'paid_in_advance')
        .sort(byName),
    });
  }
  return sections.sort((a, b) => compareByAreaOrder(a, b, order));
}

export interface AreaRouteSection {
  area: string | null;
  toCollectCount: number;
  toCollectAmount: number;
  /**
   * Every row in route order (route_position, NULLs last, then name) — to-collect AND paid rows
   * interleaved, since in Route order mode a row's status never changes its place in the route.
   */
  orderedRows: { row: ClassifiedRow; paid: boolean }[];
}

const byRoutePosition = (a: ClassifiedRow, b: ClassifiedRow) =>
  (a.routePosition ?? Infinity) - (b.routePosition ?? Infinity) || byName(a, b);

/**
 * Collection grouped by area, "Route order" within-area preference: every row (to-collect or
 * already paid) keeps its place on the saved route; nothing re-sorts by status. The screen hides
 * paid rows by default and shows them dimmed, in place, when "Show paid" is on.
 */
export function groupByAreaRouteOrder(
  rows: ClassifiedRow[],
  filter: CollectionFilter = 'all',
  search = '',
  areaFilter: CollectionAreaFilter = 'all',
  order: readonly string[] = [],
): AreaRouteSection[] {
  const visible = rows.filter(
    (r) => matchesFilter(r, filter) && matchesSearch(r, search) && matchesAreaFilter(r, areaFilter),
  );
  const byArea = new Map<string | null, ClassifiedRow[]>();
  for (const r of visible) {
    const list = byArea.get(r.area);
    if (list) list.push(r);
    else byArea.set(r.area, [r]);
  }
  const sections: AreaRouteSection[] = [];
  for (const [area, list] of byArea) {
    const ordered = [...list].sort(byRoutePosition);
    const toCollectRows = ordered.filter((r) => r.toCollect > 0);
    sections.push({
      area,
      toCollectCount: toCollectRows.length,
      toCollectAmount: toCollectRows.reduce((sum, r) => sum + r.toCollect, 0),
      orderedRows: ordered.map((row) => ({ row, paid: row.toCollect <= 0 })),
    });
  }
  return sections.sort((a, b) => compareByAreaOrder(a, b, order));
}

export interface AreaFilterOption {
  /** null = "No area". */
  area: string | null;
  /** Loans still to collect in this area (for the chip's count). */
  toCollectCount: number;
}

/** Areas present among loans with something to collect, following `order` — for the filter chips. */
export function areaFilterOptions(
  rows: ClassifiedRow[],
  order: readonly string[] = [],
): AreaFilterOption[] {
  const counts = new Map<string | null, number>();
  for (const r of rows) {
    if (r.toCollect <= 0) continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  const options = [...counts.entries()].map(([area, toCollectCount]) => ({ area, toCollectCount }));
  return options.sort((a, b) => compareByAreaOrder(a, b, order));
}

export interface CollectionSummary {
  /** Regular installments due today on active loans (full amounts). */
  expectedToday: number;
  collectedToday: number;
  remaining: number;
  /** 0–1, or null when there is nothing collected and nothing remaining. */
  progress: number | null;
  /** Loans still to collect today (also the tab badge). */
  toCollectCount: number;
  paidCount: number;
  /** toCollectCount + paidCount */
  totalCount: number;
}

export function summarizeCollection(rows: ClassifiedRow[]): CollectionSummary {
  let expectedToday = 0;
  let collectedToday = 0;
  let remaining = 0;
  let toCollectCount = 0;
  let paidCount = 0;
  for (const r of rows) {
    if (r.loanStatus === 'active') expectedToday += r.dueTodayAmount;
    collectedToday += r.collectedToday;
    remaining += r.toCollect;
    if (r.toCollect > 0) toCollectCount++;
    else paidCount++;
  }
  const denominator = collectedToday + remaining;
  return {
    expectedToday,
    collectedToday,
    remaining,
    progress: denominator > 0 ? collectedToday / denominator : null,
    toCollectCount,
    paidCount,
    totalCount: toCollectCount + paidCount,
  };
}

/** Progress as a whole percent (0–100), or null for the empty state. Shared by Home and Collection. */
export function progressPercent(summary: Pick<CollectionSummary, 'progress'>): number | null {
  return summary.progress === null ? null : Math.round(summary.progress * 100);
}
