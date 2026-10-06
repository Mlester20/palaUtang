/**
 * Pure loan-calendar logic: no database, no React. Money = integer centavos, dates = local
 * 'YYYY-MM-DD'. `today` is always a parameter. Every date is built from the existing local
 * date helpers (parseYmd/toYmd/addDays, new Date(y, m-1, d)) — never toISOString() or
 * `new Date('YYYY-MM-DD')` (which parses as UTC and shifts the day in UTC+8).
 *
 * Placement vs lateness: a REGULAR installment's due_date never differs from its
 * original_due_date in the current recompute logic (computeLoanState only ever copies it
 * through unchanged after creation). A MAKE-UP installment's due_date DOES shift — it is
 * recomputed to the next free collection day every time the missed-day count changes — while
 * its original_due_date stays frozen at whenever it was first created. So every installment is
 * PLACED on due_date (today's real collection day for it), and original_due_date is only used
 * for lateness (which only ever matters for regular installments — make-ups never go 'missed',
 * see src/lib/payments.ts's header comment).
 *
 * Completion date: same algorithm as the reliability SQL (src/db/reliability.ts), just run in JS
 * over the allocations the data layer already fetched — per installment, the paid_on of the
 * active allocation whose cumulative running total (oldest paid_on/id first) first reaches
 * amount_due. paid before due_date = advance, same day = paid, after = recovered.
 *
 * Worked examples (loan ₱6,000 total, 40 daily × ₱150, Sundays skipped):
 *  A. Days 1-4 paid on time, day 5 unpaid, today = day 6: day 5 is 'missed' (red), make-up #41 is
 *     'makeup_pending' (dashed) placed on the next free collection day, day 6 is 'pending' + isToday.
 *  B. ₱300 paid on day 6 fills day 5 (₱150) then day 6 (₱150): day 5's completion date is day 6
 *     (after its due date) → 'recovered'; day 6's completion date equals its own due date →
 *     'paid'; receivedToday for day 6 = 300 = 2×150 → doubleMultiple 2; make-up #41 is no longer
 *     needed → status 'skipped' → 'makeup_not_needed'.
 *  C. ₱450 paid on day 6 with nothing overdue fills day 6 (paid) and day 7 (completion date =
 *     day 6, BEFORE day 7's due date) → day 7 is 'advance'.
 *  F. Early payoff on day 25: every unpaid/partial regular installment becomes 'settled' (its
 *     waived_amount > 0 or it was never touched); the settlement payment's own date gets
 *     isSettlementDay = true regardless of whether an installment also falls on it.
 */

import { addDays, daysBetween, isSunday, parseYmd, toYmd, type PaymentType } from './loan';
import { datesInRange, monthRange } from './ranges';

import type {
  InstallmentStatus,
  LoanStatus,
  PaymentKind,
  PaymentStatus,
} from '@/types/loan';

/** Monday-first weeks, matching the dashboard (src/lib/ranges.ts). ONE constant, used everywhere. */
export const WEEK_STARTS_ON = 1 as const;

export type CalendarDayState =
  | 'paid'
  | 'recovered'
  | 'advance'
  | 'partial'
  | 'pending'
  | 'missed'
  | 'makeup_pending'
  | 'makeup_not_needed'
  | 'settled'
  | 'no_collection'
  | 'outside';

export const CALENDAR_DAY_STATES: CalendarDayState[] = [
  'paid',
  'recovered',
  'advance',
  'partial',
  'pending',
  'missed',
  'makeup_pending',
  'makeup_not_needed',
  'settled',
  'no_collection',
  'outside',
];

export interface CalendarDayInstallment {
  id: number;
  installmentNumber: number;
  isMakeup: boolean;
  makeupForInstallmentId: number | null;
  amountDue: number;
  amountPaid: number;
  waivedAmount: number;
  originalDueDate: string;
  /** The completion date derived here (null = not fully paid yet). For the day sheet. */
  completionDate: string | null;
}

export interface CalendarDayPayment {
  id: number;
  amount: number;
  type: PaymentKind;
  isNetted: boolean;
  note: string | null;
  status: PaymentStatus;
  voidReason: string | null;
}

export interface CalendarDay {
  date: string;
  state: CalendarDayState;
  installment: CalendarDayInstallment | null;
  /** Sum of ACTIVE payments paid_on this date, for this loan. */
  receivedToday: number;
  /** N when receivedToday >= N × the regular installment amount and N >= 2, else null. */
  doubleMultiple: number | null;
  /** A dot marker: money came in this date but the state alone wouldn't show it. */
  hasPaymentMarker: boolean;
  /** The loan's settlement payment landed on this date. */
  isSettlementDay: boolean;
  isToday: boolean;
  isFuture: boolean;
  isSundayNoCollection: boolean;
  /** Lump sum only: this day falls after an overdue due date, up to today (a tint, not a state). */
  isOverdueSpan: boolean;
  /** All payments (active AND voided) dated this day, for the day sheet. */
  payments: CalendarDayPayment[];
}

export interface MonthKey {
  year: number;
  month: number; // 1-12
}

export interface LoanCalendarResult {
  days: Map<string, CalendarDay>;
  counts: Record<CalendarDayState, number>;
  firstMonth: MonthKey;
  lastMonth: MonthKey;
  openingMonth: MonthKey;
}

// ───────────────────────── Inputs ─────────────────────────

export interface LoanCalendarLoanInput {
  paymentType: PaymentType;
  skipSundays: boolean;
  status: LoanStatus;
  startDate: string;
  endDate: string;
  closedAt: string | null;
  installmentAmount: number;
}

export interface LoanCalendarInstallmentInput {
  id: number;
  installmentNumber: number;
  dueDate: string;
  originalDueDate: string;
  amountDue: number;
  amountPaid: number;
  waivedAmount: number;
  status: InstallmentStatus;
  isMakeup: boolean;
  makeupForInstallmentId: number | null;
}

/** One row of payment_allocations, joined to its payment's paid_on (active allocations only). */
export interface LoanCalendarAllocationInput {
  installmentId: number;
  paymentId: number;
  amount: number;
  paidOn: string;
}

export interface LoanCalendarPaymentInput {
  id: number;
  amount: number;
  paidOn: string;
  status: PaymentStatus;
  type: PaymentKind;
  isNetted: boolean;
  note: string | null;
  voidReason: string | null;
}

function monthOf(ymd: string): MonthKey {
  const d = parseYmd(ymd);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthKeyCompare(a: MonthKey, b: MonthKey): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function maxMonth(a: MonthKey, b: MonthKey): MonthKey {
  return monthKeyCompare(a, b) >= 0 ? a : b;
}

/** Per-installment completion date: paid_on of the allocation whose cumulative total first
 *  reaches amount_due, oldest (paid_on, then id) first — the same fill order recomputeLoan uses. */
function completionDates(
  installments: LoanCalendarInstallmentInput[],
  allocations: LoanCalendarAllocationInput[],
): Map<number, string | null> {
  const byInstallment = new Map<number, LoanCalendarAllocationInput[]>();
  for (const a of allocations) {
    const list = byInstallment.get(a.installmentId) ?? [];
    list.push(a);
    byInstallment.set(a.installmentId, list);
  }
  const result = new Map<number, string | null>();
  for (const inst of installments) {
    const list = (byInstallment.get(inst.id) ?? []).slice().sort((a, b) =>
      a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : a.paymentId - b.paymentId,
    );
    let running = 0;
    let completion: string | null = null;
    for (const a of list) {
      running += a.amount;
      if (completion === null && running >= inst.amountDue && inst.amountDue > 0) {
        completion = a.paidOn;
      }
    }
    result.set(inst.id, completion);
  }
  return result;
}

/** The cached status an installment SHOULD have if the derived state is right (dev-mode check). */
function expectedCachedStatus(state: CalendarDayState): InstallmentStatus | null {
  switch (state) {
    case 'paid':
    case 'recovered':
    case 'advance':
      return 'paid';
    case 'partial':
      return 'partial';
    case 'missed':
      return 'missed';
    case 'pending':
    case 'makeup_pending':
      return 'pending';
    default:
      return null; // settled / makeup_not_needed are already status-driven, nothing to cross-check
  }
}

/** Mirrors installmentStatus() in src/lib/payments.ts exactly (lump sum = 'missed' even if
 *  partly paid, once past due — shown as "Overdue" in the UI, never 'partial'). */
function regularState(
  inst: LoanCalendarInstallmentInput,
  completionDate: string | null,
  today: string,
  paymentType: PaymentType,
): CalendarDayState {
  if (inst.amountPaid >= inst.amountDue && inst.amountDue > 0) {
    const done = completionDate ?? inst.dueDate;
    return done < inst.dueDate ? 'advance' : done > inst.dueDate ? 'recovered' : 'paid';
  }
  if (inst.dueDate < today) {
    if (paymentType === 'lump_sum') return 'missed';
    return inst.amountPaid === 0 ? 'missed' : 'partial';
  }
  return inst.amountPaid > 0 ? 'partial' : 'pending';
}

/**
 * A make-up never goes 'missed': computeLoanState always keeps an unpaid make-up 'pending'
 * (see lib/payments.ts's header comment), regardless of how far past its own due date it is —
 * so unlike regularState, this never needs `today`.
 */
function makeupState(inst: LoanCalendarInstallmentInput, completionDate: string | null): CalendarDayState {
  if (inst.status === 'skipped') return 'makeup_not_needed';
  if (inst.amountPaid >= inst.amountDue && inst.amountDue > 0) {
    const done = completionDate ?? inst.dueDate;
    return done < inst.dueDate ? 'advance' : done > inst.dueDate ? 'recovered' : 'paid';
  }
  return 'makeup_pending';
}

export function buildLoanCalendar(params: {
  loan: LoanCalendarLoanInput;
  installments: LoanCalendarInstallmentInput[];
  allocations: LoanCalendarAllocationInput[];
  payments: LoanCalendarPaymentInput[];
  today: string;
}): LoanCalendarResult {
  const { loan, installments, allocations, payments, today } = params;
  const completion = completionDates(installments, allocations);
  const byDueDate = new Map<string, LoanCalendarInstallmentInput>();
  for (const inst of installments) byDueDate.set(inst.dueDate, inst);

  const paymentsByDate = new Map<string, LoanCalendarPaymentInput[]>();
  for (const p of payments) {
    const list = paymentsByDate.get(p.paidOn) ?? [];
    list.push(p);
    paymentsByDate.set(p.paidOn, list);
  }

  // ── Range to render ──
  const lastPaymentDate = payments
    .filter((p) => p.status === 'active')
    .reduce((max, p) => (p.paidOn > max ? p.paidOn : max), '');
  const scheduleEnd = loan.status === 'closed_early' ? loan.closedAt ?? loan.endDate : loan.endDate;
  let lastRelevant = scheduleEnd > lastPaymentDate ? scheduleEnd : lastPaymentDate;
  if (loan.status === 'active' && today > lastRelevant) lastRelevant = today;
  const firstMonth = monthOf(loan.startDate);
  const lastMonth = maxMonth(monthOf(lastRelevant), firstMonth);
  const openingMonth = loan.status === 'active' ? maxMonth(monthOf(today), firstMonth) : lastMonth;

  const rangeStart = monthRange(`${firstMonth.year}-${String(firstMonth.month).padStart(2, '0')}-01`).from;
  const rangeEndMonth = monthRange(`${lastMonth.year}-${String(lastMonth.month).padStart(2, '0')}-01`);
  const rangeEnd = rangeEndMonth.to;

  // Lump sum has exactly ONE regular installment; once it's overdue, every day after its due
  // date up to today gets a light "overdue span" tint (an overlay, not its own state/icon).
  const lumpInstallment =
    loan.paymentType === 'lump_sum' ? installments.find((i) => !i.isMakeup) ?? null : null;
  const lumpOverdueFrom =
    lumpInstallment && lumpInstallment.dueDate < today && lumpInstallment.amountPaid < lumpInstallment.amountDue
      ? lumpInstallment.dueDate
      : null;

  const counts = Object.fromEntries(CALENDAR_DAY_STATES.map((s) => [s, 0])) as Record<
    CalendarDayState,
    number
  >;
  const days = new Map<string, CalendarDay>();

  for (const date of datesInRange({ from: rangeStart, to: rangeEnd })) {
    const inst = byDueDate.get(date) ?? null;
    const datePayments = paymentsByDate.get(date) ?? [];
    const receivedToday = datePayments
      .filter((p) => p.status === 'active')
      .reduce((sum, p) => sum + p.amount, 0);
    const doubleFloor =
      loan.installmentAmount > 0 ? Math.floor(receivedToday / loan.installmentAmount) : 0;
    const doubleMultiple = doubleFloor >= 2 ? doubleFloor : null;
    const isSettlementDay = datePayments.some((p) => p.type === 'settlement' && p.status === 'active');
    const sundayMuted = loan.skipSundays && isSunday(date) && inst === null;

    let state: CalendarDayState;
    let dayInstallment: CalendarDayInstallment | null = null;

    if (date < loan.startDate || date > lastRelevant) {
      state = 'outside';
    } else if (inst) {
      const done = completion.get(inst.id) ?? null;
      if (inst.status === 'settled') state = 'settled';
      else if (inst.isMakeup) state = makeupState(inst, done);
      else state = regularState(inst, done, today, loan.paymentType);

      dayInstallment = {
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        isMakeup: inst.isMakeup,
        makeupForInstallmentId: inst.makeupForInstallmentId,
        amountDue: inst.amountDue,
        amountPaid: inst.amountPaid,
        waivedAmount: inst.waivedAmount,
        originalDueDate: inst.originalDueDate,
        completionDate: done,
      };

      if (__DEV__) {
        const expected = expectedCachedStatus(state);
        if (expected && expected !== inst.status) {
          console.warn(
            `[LoanCalendar] installment #${inst.installmentNumber} derived "${state}" ` +
              `(expects cached status "${expected}") but cached status is "${inst.status}"`,
          );
        }
      }
    } else {
      // No installment lands here: a Sunday-skip gap (daily) or any non-due-date day on a
      // lump-sum loan (which has only ONE due date for its whole term). Both render the same
      // muted/blank way; isSundayNoCollection tells the UI which specific reason applies.
      state = 'no_collection';
    }

    const isOverdueSpan =
      lumpOverdueFrom !== null && inst === null && date > lumpOverdueFrom && date <= today;
    const hasPaymentMarker = receivedToday > 0 && dayInstallment === null;

    const day: CalendarDay = {
      date,
      state,
      installment: dayInstallment,
      receivedToday,
      doubleMultiple,
      hasPaymentMarker,
      isSettlementDay,
      isToday: date === today,
      isFuture: date > today,
      isSundayNoCollection: sundayMuted,
      isOverdueSpan,
      payments: datePayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        type: p.type,
        isNetted: p.isNetted,
        note: p.note,
        status: p.status,
        voidReason: p.voidReason,
      })),
    };
    days.set(date, day);
    counts[state]++;
  }

  return { days, counts, firstMonth, lastMonth, openingMonth };
}

// ───────────────────────── Month grid ─────────────────────────

/** 7-wide rows of 'YYYY-MM-DD' (null = filler outside the month), Monday-first. */
export function getMonthGrid(year: number, month: number): (string | null)[][] {
  const first = toYmd(new Date(year, month - 1, 1));
  const last = toYmd(new Date(year, month, 0));
  const dates = datesInRange({ from: first, to: last });
  const firstDow = parseYmd(first).getDay(); // 0 = Sunday
  const leading = WEEK_STARTS_ON === 1 ? (firstDow + 6) % 7 : firstDow;
  const cells: (string | null)[] = [...new Array(leading).fill(null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const d = new Date(key.year, key.month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function monthLabelKey(key: MonthKey): string {
  return `${key.year}-${String(key.month).padStart(2, '0')}`;
}

export interface MonthSummary {
  amountDue: number;
  received: number;
  missedCount: number;
}

/** Due/received/missed for one month, from the days already built (no extra date math). */
export function monthSummary(days: Map<string, CalendarDay>, year: number, month: number): MonthSummary {
  let amountDue = 0;
  let received = 0;
  let missedCount = 0;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  for (const [date, day] of days) {
    if (!date.startsWith(prefix)) continue;
    if (day.installment && !day.installment.isMakeup) amountDue += day.installment.amountDue;
    received += day.receivedToday;
    if (day.state === 'missed') missedCount++;
  }
  return { amountDue, received, missedCount };
}

// Re-exported so callers of this module don't also need to import from lib/loan directly
// for the one date helper they typically need alongside a calendar (today → addDays etc.).
export { addDays, daysBetween };
