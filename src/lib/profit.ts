/**
 * Principal vs interest split of money received (cash basis). Pure: no database, no React.
 * Money = integer centavos, dates = local 'YYYY-MM-DD'. Deterministic: a payment's split never
 * changes after the fact (later payments don't move earlier ones).
 *
 * REGULAR payments (active only), per loan, in (paid_on, id) order with cumulative paid P:
 *   principalReturned(P) = round_half_up(P × principal ÷ total_payable)
 *   a payment's principal = principalReturned(P after) − principalReturned(P before)
 *   its interest          = amount − its principal
 * Splitting by the DELTA of the cumulative function keeps rounding exact.
 *
 * SETTLEMENT (active; netted or cash):
 *   remaining principal = principal − principalReturned(all regular payments before it)
 *   principal portion   = min(amount, remaining principal); interest = amount − that
 *   if amount < remaining principal, the gap is "Unrecovered principal" on the settlement date.
 *
 * Netted settlements (is_netted = 1) COUNT for principal / interest / profit but are NOT cash.
 * Voided payments are never in the input.
 *
 * INVARIANT: for a fully paid loan P = total_payable, so principalReturned(P) = principal
 * exactly and the interest parts sum to total_payable − principal = interest_amount exactly,
 * whatever the rounding of individual payments.
 *
 * Worked examples (₱5,000 at 20% → total ₱6,000, 40 × ₱150):
 *  H. ₱3,000 paid → principal 3000 × 5000 ÷ 6000 = ₱2,500, interest ₱500. Fully paid → ₱5,000
 *     + ₱1,000. Uneven: ₱5,000 at 15% = ₱5,750 over 30 days (29 × ₱191.66 + ₱191.86): each
 *     payment rounds, yet the sum is exactly ₱5,000 principal + ₱750 interest.
 *  I. 25 days paid (₱3,750) → principal ₱3,125, interest ₱625. Settled with discount ₱300
 *     (₱1,950): remaining principal ₱1,875 → principal ₱1,875, interest ₱75; total interest
 *     ₱700, discount given ₱300. Pro-rata settlement ₱1,875 → principal ₱1,875, interest ₱0
 *     (total interest ₱625).
 *  J. Settled with ₱1,000 when ₱1,875 principal remains → principal ₱1,000, interest ₱0,
 *     unrecovered principal ₱875 (shown in red).
 *  K. Same as I but netted into a renewal: principal/interest identical, the ₱1,950 is in
 *     "Netted renewals", not in cash collected.
 */

import { isCashPayment } from './cash';
import { mulDivRoundHalfUp } from './settlement';

import type { PaymentKind } from '@/types/loan';

export interface ProfitPayment {
  id: number;
  loanId: number;
  amount: number;
  paidOn: string;
  type: PaymentKind;
  isNetted: boolean;
  /** Loan fields. */
  principal: number;
  totalPayable: number;
}

export interface PaymentSplit {
  paymentId: number;
  loanId: number;
  paidOn: string;
  amount: number;
  /** Cash in hand (false for a netted settlement). */
  isCash: boolean;
  principal: number;
  interest: number;
  /** Principal that will never come back (settlement below the remaining principal). */
  unrecoveredPrincipal: number;
}

export function principalReturned(cumulativePaid: number, principal: number, totalPayable: number) {
  return mulDivRoundHalfUp(cumulativePaid, principal, totalPayable);
}

/**
 * Splits each payment. `priorRegularPaid` = per loan, the sum of ACTIVE REGULAR payments dated
 * before the first payment given (e.g. before a report's start date), so ranges split exactly
 * like the full history would.
 */
export function splitPayments(
  payments: ProfitPayment[],
  priorRegularPaid: ReadonlyMap<number, number> = new Map(),
): PaymentSplit[] {
  const ordered = [...payments].sort(
    (a, b) => a.loanId - b.loanId || a.paidOn.localeCompare(b.paidOn) || a.id - b.id,
  );
  const cumulative = new Map<number, number>();
  const splits: PaymentSplit[] = [];
  for (const p of ordered) {
    const before = cumulative.get(p.loanId) ?? priorRegularPaid.get(p.loanId) ?? 0;
    const returnedBefore = principalReturned(before, p.principal, p.totalPayable);
    let principal: number;
    let unrecoveredPrincipal = 0;
    if (p.type === 'settlement') {
      const remaining = Math.max(0, p.principal - returnedBefore);
      principal = Math.min(p.amount, remaining);
      unrecoveredPrincipal = remaining - principal;
      cumulative.set(p.loanId, before);
    } else {
      const after = before + p.amount;
      principal = principalReturned(after, p.principal, p.totalPayable) - returnedBefore;
      cumulative.set(p.loanId, after);
    }
    splits.push({
      paymentId: p.id,
      loanId: p.loanId,
      paidOn: p.paidOn,
      amount: p.amount,
      // Inputs are active payments; the shared cash rule drops netted settlements.
      isCash: isCashPayment({ status: 'active', isNetted: p.isNetted }),
      principal,
      interest: p.amount - principal,
      unrecoveredPrincipal,
    });
  }
  return splits;
}

export interface DailyProfit {
  date: string;
  cashCollected: number;
  interestEarned: number;
}

export interface ProfitSummary {
  fromDate: string;
  toDate: string;
  /** Active payments that put cash in hand (regular + cash settlements). */
  cashCollected: number;
  /** Settlements deducted from a renewal's principal (no cash changed hands). */
  nettedSettlements: number;
  /** cashCollected + nettedSettlements = principalReturned + interestEarned. */
  totalReceived: number;
  principalReturned: number;
  interestEarned: number;
  /** Forgiven on loans closed early in the range (by closed_at). */
  discountsGiven: number;
  unrecoveredPrincipal: number;
  newLoansReleased: { amount: number; count: number };
  /** One entry per calendar day from fromDate to toDate, oldest first. */
  days: DailyProfit[];
}

export interface ProfitInput {
  fromDate: string;
  toDate: string;
  /** Active payments with fromDate ≤ paid_on ≤ toDate. */
  payments: ProfitPayment[];
  priorRegularPaid: ReadonlyMap<number, number>;
  discountsGiven: number;
  newLoansReleased: { amount: number; count: number };
  /** Every date in the range (from ranges.ts), so empty days still show. */
  dates: string[];
}

export function summarizeProfit(input: ProfitInput): ProfitSummary {
  const byDay = new Map<string, DailyProfit>(
    input.dates.map((date) => [date, { date, cashCollected: 0, interestEarned: 0 }]),
  );
  let cashCollected = 0;
  let nettedSettlements = 0;
  let principal = 0;
  let interest = 0;
  let unrecovered = 0;
  for (const s of splitPayments(input.payments, input.priorRegularPaid)) {
    if (s.isCash) cashCollected += s.amount;
    else nettedSettlements += s.amount;
    principal += s.principal;
    interest += s.interest;
    unrecovered += s.unrecoveredPrincipal;
    let day = byDay.get(s.paidOn);
    if (!day) {
      day = { date: s.paidOn, cashCollected: 0, interestEarned: 0 };
      byDay.set(s.paidOn, day);
    }
    if (s.isCash) day.cashCollected += s.amount;
    day.interestEarned += s.interest;
  }
  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    cashCollected,
    nettedSettlements,
    totalReceived: cashCollected + nettedSettlements,
    principalReturned: principal,
    interestEarned: interest,
    discountsGiven: input.discountsGiven,
    unrecoveredPrincipal: unrecovered,
    newLoansReleased: input.newLoansReleased,
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** What's still out on an active loan: principal not yet returned by its regular payments. */
export function principalOutstanding(regularPaid: number, principal: number, totalPayable: number) {
  return Math.max(0, principal - principalReturned(regularPaid, principal, totalPayable));
}
