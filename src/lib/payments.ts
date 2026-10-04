/**
 * Pure payment / balda logic: no database, no React. Money = integer centavos, dates = local
 * 'YYYY-MM-DD'. Everything that depends on the date takes `today`, so it is testable.
 *
 * Source of truth = the ACTIVE (non-voided) payments. Installment amount_paid/status, make-up
 * rows, allocations, loan end date and loan status are all re-derived by computeLoanState().
 *
 * Allocation rule: cumulative fill, oldest installment first. The active payments (ordered by
 * paid_on, then id) pour into the regular installments in schedule order. That is exactly
 * "past-due first, then today, then upcoming": a double payment recovers balda days first and
 * then pays future days in advance. Make-up rows never receive money; they are extra collection
 * days for the money still owed on missed days.
 *
 * Worked examples — loan ₱6,000 total, 40 daily × ₱150, Sundays skipped. "Day n" = installment #n.
 *  A. Days 1–4 paid (₱600), day 5 unpaid, today = day 6:
 *     #5 due < today and ₱0 paid → 'missed'; make-up #41 (₱150) is appended on the first
 *     collection day after #40. #6 (due today) stays 'pending'. Overdue ₱150, balance ₱5,400.
 *  B. Then ₱300 paid on day 6: fill ₱600 + ₱300 → #5 ₱150 (recovered), #6 ₱150.
 *     #5 is 'paid' → make-up #41 becomes 'skipped'; end date returns to #40's date. Balance ₱5,100.
 *  C. No balda (days 1–5 paid), ₱300 paid on day 6 → #6 and #7 'paid'; #7 is due after today,
 *     so it is shown as "Advance" and no longer needs collecting.
 *  D. Void the ₱300 from B → recompute is back to A: #5 'missed', #41 'pending' again (same row,
 *     re-dated), balance ₱5,400.
 *  E. Days 1–5 paid; ₱100 on day 6 → #6 'partial' (₱50 short, no make-up). On day 7, ₱200 →
 *     fill continues: #6 +₱50 (now paid), #7 +₱150 (paid).
 *  F. Phone closed 5 days (5 past-due days with ₱0) → one recompute marks all 5 'missed' and
 *     appends 5 make-ups on the next 5 collection days after #40, skipping Sundays.
 *  G. Lump sum ₱6,000: ₱2,000 early → 'partial', balance ₱4,000. Due date passes → 'missed'
 *     (shown as OVERDUE with days count), no make-up, no shift. ₱4,000 more → 'paid', completed.
 *  H. Paying more than the balance is rejected. Paying exactly the balance → loan 'completed';
 *     voiding that payment → balance > 0 → loan back to 'active'.
 *
 * Early payoff (Phase 8): a settlement is an ordinary payment with type 'settlement', filled
 * oldest-first like any other. While an ACTIVE settlement exists the loan is closed:
 *  - every regular installment not fully paid becomes 'settled' and its uncovered part is
 *    waived_amount (a partly paid one keeps its amount_paid);
 *  - make-up rows become 'skipped' (their day was paid) or 'settled' with waived 0 (the missed
 *    day's own row already carries the waived money, so it is never counted twice);
 *  - no balda, no new make-ups; status 'closed_early', closed_at = end_date = settlement date;
 *  - discount = total_payable − everything paid, and the balance is 0.
 * Voiding the settlement removes it from the input, so the very same function reopens the loan
 * (waivers back to 0, balda/make-ups recomputed for today).
 */

import { addDays, daysBetween, isSunday, type PaymentType } from './loan';

import type { InstallmentStatus, LoanStatus } from '@/types/loan';

// ───────────────────────── Inputs ─────────────────────────

export interface CalcLoan {
  paymentType: PaymentType;
  totalPayable: number;
  skipSundays: boolean;
  status: LoanStatus;
  startDate: string;
}

export type CalcPaymentType = 'regular' | 'settlement';

export interface CalcInstallment {
  id: number;
  installmentNumber: number;
  dueDate: string;
  originalDueDate: string;
  amountDue: number;
  amountPaid: number;
  /** Forgiven by an early payoff (0 unless the loan is closed early). */
  waivedAmount?: number;
  status: InstallmentStatus;
  isMakeup: boolean;
  makeupForInstallmentId: number | null;
}

/** Active (non-voided) payments only. */
export interface CalcPayment {
  id: number;
  amount: number;
  paidOn: string;
  /** Defaults to 'regular'. */
  type?: CalcPaymentType;
}

// ───────────────────────── Outputs ─────────────────────────

/** Target state of a row; id = null for a make-up row that must be inserted. */
export interface TargetInstallment extends Omit<CalcInstallment, 'id' | 'waivedAmount'> {
  id: number | null;
  waivedAmount: number;
}

export interface Allocation {
  paymentId: number;
  installmentId: number;
  amount: number;
}

export interface LoanState {
  /** Sorted by due date, then installment number. */
  installments: TargetInstallment[];
  allocations: Allocation[];
  totalPaid: number;
  /** total_payable − paid when closed early (the forgiven part), else 0. */
  discountAmount: number;
  balance: number;
  endDate: string;
  status: LoanStatus;
  /** Settlement date while closed early, else null. */
  closedAt: string | null;
}

// ───────────────────────── Core ─────────────────────────

/** The `count` collection days strictly after `afterDate` (Sundays skipped when asked). */
export function nextCollectionDays(afterDate: string, count: number, skipSundays: boolean) {
  const days: string[] = [];
  let date = afterDate;
  while (days.length < count) {
    date = addDays(date, 1);
    if (!(skipSundays && isSunday(date))) days.push(date);
  }
  return days;
}

/**
 * Status of a regular installment from what has been paid on it and today's date.
 *  - daily, past due: ₱0 paid → 'missed' (balda); something paid → 'partial' (shortfall overdue).
 *  - lump sum, past due with any balance → 'missed' (shown as OVERDUE), even if partly paid.
 *  - due today or later is never balda: 'partial' if something was paid, else 'pending'.
 */
export function installmentStatus(
  paymentType: PaymentType,
  amountDue: number,
  amountPaid: number,
  dueDate: string,
  today: string,
): InstallmentStatus {
  if (amountPaid >= amountDue) return 'paid';
  if (dueDate < today) {
    if (paymentType === 'lump_sum') return 'missed';
    return amountPaid === 0 ? 'missed' : 'partial';
  }
  return amountPaid > 0 ? 'partial' : 'pending';
}

function byDueDate(a: { dueDate: string; installmentNumber: number }, b: typeof a) {
  return a.dueDate < b.dueDate
    ? -1
    : a.dueDate > b.dueDate
      ? 1
      : a.installmentNumber - b.installmentNumber;
}

/**
 * Deterministic, idempotent rebuild of the whole loan state from its active payments.
 * Feeding the result back in (as the "current" rows) produces the same result again.
 */
export function computeLoanState(
  loan: CalcLoan,
  installments: CalcInstallment[],
  payments: CalcPayment[],
  today: string,
): LoanState {
  const regular = installments
    .filter((i) => !i.isMakeup)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
  const makeups = installments.filter((i) => i.isMakeup);

  // 1. Cumulative fill, oldest installment first.
  const paidById = new Map<number, number>(regular.map((r) => [r.id, 0]));
  const allocations: Allocation[] = [];
  const ordered = [...payments].sort((a, b) =>
    a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : a.id - b.id,
  );
  let cursor = 0;
  for (const payment of ordered) {
    let remaining = payment.amount;
    while (remaining > 0 && cursor < regular.length) {
      const row = regular[cursor]!;
      const room = row.amountDue - paidById.get(row.id)!;
      if (room <= 0) {
        cursor++;
        continue;
      }
      const take = Math.min(room, remaining);
      paidById.set(row.id, paidById.get(row.id)! + take);
      allocations.push({ paymentId: payment.id, installmentId: row.id, amount: take });
      remaining -= take;
    }
    // Anything left over (overpayment) is not allocated; recordPayment blocks it up front.
  }

  // 2. Regular rows: derived amount_paid + status. Due dates never move.
  const settlement = ordered.find((p) => p.type === 'settlement') ?? null;
  const totalPaid = allocations.reduce((sum, a) => sum + a.amount, 0);

  if (settlement && loan.status !== 'cancelled') {
    return closedState(loan, regular, makeups, paidById, allocations, totalPaid, settlement);
  }

  const targets: TargetInstallment[] = regular.map((row) => {
    const amountPaid = paidById.get(row.id)!;
    return {
      ...row,
      amountPaid,
      waivedAmount: 0,
      status: installmentStatus(loan.paymentType, row.amountDue, amountPaid, row.dueDate, today),
    };
  });

  // 3. Make-ups (daily only): one per fully missed regular day, on the next collection days
  //    after the last regular due date, in schedule order. Existing rows are reused (stable ids
  //    and numbers); rows whose missed day was recovered become 'skipped'.
  const missed = loan.paymentType === 'daily' ? targets.filter((t) => t.status === 'missed') : [];
  const lastRegularDue = regular.reduce((max, r) => (r.dueDate > max ? r.dueDate : max), '');
  const makeupDates = lastRegularDue
    ? nextCollectionDays(lastRegularDue, missed.length, loan.skipSundays)
    : [];
  const makeupByRegular = new Map(makeups.map((m) => [m.makeupForInstallmentId, m]));
  let nextNumber = installments.reduce((max, i) => Math.max(max, i.installmentNumber), 0) + 1;
  const neededFor = new Set<number>();

  missed.forEach((miss, k) => {
    const regularId = miss.id!;
    neededFor.add(regularId);
    const existing = makeupByRegular.get(regularId);
    const dueDate = makeupDates[k]!;
    targets.push(
      existing
        ? {
            ...existing,
            dueDate,
            amountDue: miss.amountDue,
            amountPaid: 0,
            waivedAmount: 0,
            status: 'pending',
          }
        : {
            id: null,
            installmentNumber: nextNumber++,
            dueDate,
            originalDueDate: dueDate,
            amountDue: miss.amountDue,
            amountPaid: 0,
            waivedAmount: 0,
            status: 'pending',
            isMakeup: true,
            makeupForInstallmentId: regularId,
          },
    );
  });
  for (const m of makeups) {
    if (!neededFor.has(m.makeupForInstallmentId!)) {
      targets.push({ ...m, amountPaid: 0, waivedAmount: 0, status: 'skipped' });
    }
  }
  targets.sort(byDueDate);

  // 4. Totals, end date, loan status. (A closed_early loan without an active settlement —
  //    i.e. its settlement was voided — reopens here as active/completed.)
  const balance = loan.totalPayable - totalPaid;
  const endDate = targets
    .filter((t) => t.status !== 'skipped')
    .reduce((max, t) => (t.dueDate > max ? t.dueDate : max), '');
  const status: LoanStatus =
    loan.status === 'cancelled' ? 'cancelled' : balance <= 0 ? 'completed' : 'active';

  return {
    installments: targets,
    allocations,
    totalPaid,
    discountAmount: 0,
    balance,
    endDate,
    status,
    closedAt: null,
  };
}

/** State of a loan closed by an ACTIVE settlement payment (see the header). */
function closedState(
  loan: CalcLoan,
  regular: CalcInstallment[],
  makeups: CalcInstallment[],
  paidById: Map<number, number>,
  allocations: Allocation[],
  totalPaid: number,
  settlement: CalcPayment,
): LoanState {
  const targets: TargetInstallment[] = regular.map((row) => {
    const amountPaid = paidById.get(row.id)!;
    const fullyPaid = amountPaid >= row.amountDue;
    return {
      ...row,
      amountPaid,
      waivedAmount: fullyPaid ? 0 : row.amountDue - amountPaid,
      status: fullyPaid ? 'paid' : 'settled',
    };
  });
  const paidRegular = new Set(targets.filter((t) => t.status === 'paid').map((t) => t.id));
  for (const m of makeups) {
    targets.push({
      ...m,
      amountPaid: 0,
      waivedAmount: 0, // the missed day's own row carries the waived money
      status: paidRegular.has(m.makeupForInstallmentId) ? 'skipped' : 'settled',
    });
  }
  targets.sort(byDueDate);

  return {
    installments: targets,
    allocations,
    totalPaid,
    discountAmount: Math.max(0, loan.totalPayable - totalPaid),
    balance: 0,
    endDate: settlement.paidOn,
    status: 'closed_early',
    closedAt: settlement.paidOn,
  };
}

// ───────────────────────── Summary ─────────────────────────

export interface LoanBalanceSummary {
  totalPaid: number;
  balance: number;
  /** Unpaid money on regular installments whose due date has passed. */
  overdueAmount: number;
  /** Fully missed regular days (daily loans). */
  baldaDays: number;
  nextDue: { date: string; amount: number } | null;
  /** Lump sum only: days since the due date while a balance remains. */
  daysOverdue: number;
}

export function summarizeLoan(loan: CalcLoan, state: LoanState, today: string): LoanBalanceSummary {
  const regular = state.installments.filter((i) => !i.isMakeup);
  const overdueAmount =
    state.status === 'closed_early'
      ? 0
      : regular
          .filter((i) => i.dueDate < today)
          .reduce((sum, i) => sum + (i.amountDue - i.amountPaid - i.waivedAmount), 0);
  const baldaDays =
    loan.paymentType === 'daily' ? regular.filter((i) => i.status === 'missed').length : 0;
  const upcoming = state.installments.find(
    (i) =>
      i.status !== 'skipped' && i.status !== 'paid' && i.status !== 'settled' && i.dueDate >= today,
  );
  const lump = loan.paymentType === 'lump_sum' ? regular[0] : undefined;
  return {
    totalPaid: state.totalPaid,
    balance: state.balance,
    overdueAmount,
    baldaDays,
    nextDue:
      state.balance > 0 && upcoming
        ? { date: upcoming.dueDate, amount: upcoming.amountDue - upcoming.amountPaid }
        : null,
    daysOverdue:
      lump && state.balance > 0 && lump.dueDate < today ? daysBetween(lump.dueDate, today) : 0,
  };
}

// ───────────────────────── Validation + preview ─────────────────────────

export type PaymentError =
  'notActive' | 'amountRequired' | 'overBalance' | 'futureDate' | 'beforeStart';

export function validatePayment(
  loan: CalcLoan,
  balance: number,
  amount: number,
  paidOn: string,
  today: string,
): PaymentError[] {
  const errors: PaymentError[] = [];
  if (loan.status !== 'active') errors.push('notActive');
  if (!Number.isSafeInteger(amount) || amount <= 0) errors.push('amountRequired');
  else if (amount > balance) errors.push('overBalance');
  if (paidOn > today) errors.push('futureDate');
  if (paidOn < loan.startDate) errors.push('beforeStart');
  return errors;
}

export type PreviewLineKind = 'recovered' | 'overdue' | 'today' | 'advance';

export interface PaymentPreviewLine {
  installmentId: number;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  kind: PreviewLineKind;
}

export interface PaymentPreview {
  lines: PaymentPreviewLine[];
  /** Balda days this payment fully recovers (their make-up days drop off). */
  recoveredCount: number;
  balanceBefore: number;
  balanceAfter: number;
  endDateBefore: string;
  endDateAfter: string;
  completesLoan: boolean;
  errors: PaymentError[];
}

/**
 * What a new payment would do, without saving. Lines are the per-installment increase in
 * amount paid, so the answer doesn't depend on payment ordering (cumulative fill).
 */
export function previewPayment(
  loan: CalcLoan,
  installments: CalcInstallment[],
  payments: CalcPayment[],
  amount: number,
  paidOn: string,
  today: string,
): PaymentPreview {
  const before = computeLoanState(loan, installments, payments, today);
  const errors = validatePayment(loan, before.balance, amount, paidOn, today);
  const valid = Number.isSafeInteger(amount) && amount > 0;
  const after = valid
    ? computeLoanState(loan, installments, [...payments, { id: -1, amount, paidOn }], today)
    : before;

  const beforeById = new Map(before.installments.map((i) => [i.id, i]));
  const lines: PaymentPreviewLine[] = [];
  let recoveredCount = 0;
  for (const row of after.installments) {
    if (row.isMakeup || row.id === null) continue;
    const old = beforeById.get(row.id)!;
    const added = row.amountPaid - old.amountPaid;
    if (added <= 0) continue;
    let kind: PreviewLineKind;
    if (row.dueDate < today) {
      const recovered = old.status === 'missed' && row.status === 'paid';
      if (recovered) recoveredCount++;
      kind = recovered ? 'recovered' : 'overdue';
    } else {
      kind = row.dueDate === today ? 'today' : 'advance';
    }
    lines.push({
      installmentId: row.id,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate,
      amount: added,
      kind,
    });
  }

  return {
    lines,
    recoveredCount,
    balanceBefore: before.balance,
    balanceAfter: after.balance,
    endDateBefore: before.endDate,
    endDateAfter: after.endDate,
    completesLoan: before.balance > 0 && after.balance <= 0,
    errors,
  };
}
