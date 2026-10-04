/**
 * Early payoff ("pa-ending") and renewal maths. Pure: no database, no React.
 * Money = integer centavos; dates = local 'YYYY-MM-DD'; the settlement date is a parameter.
 *
 * Worked examples — loan ₱5,000 principal, 20% flat → ₱6,000 total, 40 daily × ₱150:
 *  A. Day 25, 25 paid (₱3,750; balance ₱2,250):
 *       full     = ₱2,250
 *       prorata  = earned 25/40 × ₱1,000 = ₱625 → ₱5,000 + ₱625 − ₱3,750 = ₱1,875
 *       discount ₱300 → ₱2,250 − ₱300 = ₱1,950
 *  B. Day 25 but only 22 paid (₱3,300; 3 balda days; balance ₱2,700):
 *       prorata  = ₱5,625 − ₱3,300 = ₱2,325 (arrears included; ≤ balance ₱2,700)
 *  C. Day 1 after one ₱150 payment: prorata = ₱5,000 + 1/40 × ₱1,000 − ₱150 = ₱4,875;
 *       full = ₱5,850.
 *  D. Lump sum ₱6,000 (₱5,000 + ₱1,000) due in 30 days, nothing paid, settled on day 15:
 *       prorata = 15/30 × ₱1,000 = ₱500 earned → ₱5,500; full = ₱6,000.
 *  E. discount ≥ balance → error (the settlement must stay ≥ ₱0.01). A settlement that leaves
 *       collected < principal sets lenderLoss > 0 (UI warns and asks for extra confirmation).
 *  G. Renewal: ₱2,250 settled (full), new principal ₱5,000 → cash to release ₱2,750;
 *       a new principal below ₱2,250 is an error.
 */

import { daysBetween, type PaymentType } from './loan';

import type { SettlementMode } from '@/types/loan';

export interface SettlementLoan {
  paymentType: PaymentType;
  principal: number;
  interestAmount: number;
  totalPayable: number;
  startDate: string;
  status: 'active' | 'completed' | 'cancelled' | 'closed_early';
}

export interface SettlementInstallment {
  isMakeup: boolean;
  originalDueDate: string;
}

export interface SettlementInput {
  loan: SettlementLoan;
  installments: SettlementInstallment[];
  /** Sum of active payments so far (before the settlement). */
  totalPaid: number;
  settlementDate: string;
  mode: SettlementMode;
  /** Discount mode only: centavos taken off the remaining balance. */
  discount?: number;
}

export type SettlementError = 'discountInvalid' | 'nothingToSettle';

export interface SettlementResult {
  remainingBalance: number;
  /** Interest earned up to the settlement date (pro-rata basis), for display in every mode. */
  earnedInterest: number;
  unearnedInterest: number;
  /** 0–1, as an exact fraction numerator / denominator. */
  elapsed: { numerator: number; denominator: number };
  settlementAmount: number;
  /** remaining balance − settlement amount (forgiven). */
  discountAmount: number;
  /** How far collected-in-total falls below the principal (0 if the lender breaks even). */
  lenderLoss: number;
  /** Collected so far + settlement − principal. */
  resultingProfit: number;
  errors: SettlementError[];
}

/** a × num ÷ den rounded half-up, in integers only (no floating point on money). */
export function mulDivRoundHalfUp(a: number, num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.floor((2 * a * num + den) / (2 * den));
}

/**
 * Elapsed share of the term at `settlementDate`, clamped to 0..1.
 *  - daily: original (non make-up) installments with original_due_date ≤ date ÷ all originals
 *  - lump sum: days from start ÷ days from start to the due date
 */
export function elapsedFraction(
  loan: SettlementLoan,
  installments: SettlementInstallment[],
  settlementDate: string,
): { numerator: number; denominator: number } {
  const originals = installments.filter((i) => !i.isMakeup);
  if (loan.paymentType === 'daily') {
    const done = originals.filter((i) => i.originalDueDate <= settlementDate).length;
    return {
      numerator: Math.min(done, originals.length),
      denominator: Math.max(1, originals.length),
    };
  }
  const due = originals.reduce((max, i) => (i.originalDueDate > max ? i.originalDueDate : max), '');
  const total = due ? Math.max(1, daysBetween(loan.startDate, due)) : 1;
  const passed = Math.min(total, Math.max(0, daysBetween(loan.startDate, settlementDate)));
  return { numerator: passed, denominator: total };
}

export function computeSettlement({
  loan,
  installments,
  totalPaid,
  settlementDate,
  mode,
  discount = 0,
}: SettlementInput): SettlementResult {
  const errors: SettlementError[] = [];
  const remainingBalance = Math.max(0, loan.totalPayable - totalPaid);
  if (remainingBalance <= 0) errors.push('nothingToSettle');

  const elapsed = elapsedFraction(loan, installments, settlementDate);
  const earnedInterest = mulDivRoundHalfUp(
    loan.interestAmount,
    elapsed.numerator,
    elapsed.denominator,
  );
  const unearnedInterest = loan.interestAmount - earnedInterest;

  let settlementAmount: number;
  switch (mode) {
    case 'prorata':
      // Principal + interest earned so far − what was paid; includes any arrears.
      settlementAmount = Math.min(
        remainingBalance,
        Math.max(1, loan.principal + earnedInterest - totalPaid),
      );
      break;
    case 'discount':
      if (!Number.isSafeInteger(discount) || discount < 0 || discount >= remainingBalance) {
        errors.push('discountInvalid');
      }
      settlementAmount = remainingBalance - Math.max(0, Math.min(discount, remainingBalance - 1));
      break;
    default:
      settlementAmount = remainingBalance;
  }
  if (remainingBalance <= 0) settlementAmount = 0;

  const collected = totalPaid + settlementAmount;
  return {
    remainingBalance,
    earnedInterest,
    unearnedInterest,
    elapsed,
    settlementAmount,
    discountAmount: remainingBalance - settlementAmount,
    lenderLoss: Math.max(0, loan.principal - collected),
    resultingProfit: collected - loan.principal,
    errors,
  };
}

export type SettlementDateError = 'notActive' | 'futureDate' | 'beforeStart' | 'beforeLastPayment';

/** Settlement date must be ≤ today, ≥ start date, ≥ the latest active payment date. */
export function validateSettlementDate(
  loan: Pick<SettlementLoan, 'status' | 'startDate'>,
  settlementDate: string,
  latestPaymentDate: string | null,
  today: string,
): SettlementDateError[] {
  const errors: SettlementDateError[] = [];
  if (loan.status !== 'active') errors.push('notActive');
  if (settlementDate > today) errors.push('futureDate');
  if (settlementDate < loan.startDate) errors.push('beforeStart');
  if (latestPaymentDate && settlementDate < latestPaymentDate) errors.push('beforeLastPayment');
  return errors;
}

export interface RenewalResult {
  /** New principal − settlement amount: the cash actually handed to the borrower. */
  cashToRelease: number;
  error: 'principalBelowSettlement' | null;
}

export function computeRenewal({
  settlementAmount,
  newPrincipal,
}: {
  settlementAmount: number;
  newPrincipal: number;
}): RenewalResult {
  if (newPrincipal < settlementAmount) {
    return { cashToRelease: 0, error: 'principalBelowSettlement' };
  }
  return { cashToRelease: newPrincipal - settlementAmount, error: null };
}
