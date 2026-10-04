/**
 * Balda flags: how far behind each borrower is. Pure: no database, no React; `today` is a
 * parameter. Money = integer centavos, dates = local 'YYYY-MM-DD'.
 *
 * Rows come from getFlaggedBorrowers (src/db/flags.ts): one row per ACTIVE loan with money
 * overdue, read from the installment cache. "Overdue outstanding" = what is still owed on
 * REGULAR installments with due_date < today. Make-up rows never count (they are future
 * collection days for money already owed on the missed day, and never receive money).
 *
 * daysBehind per loan:
 *  - daily:    ceil(overdue outstanding ÷ regular installment amount). Only collection days
 *              have installments, so a skipped Sunday is never counted.
 *  - lump sum: calendar days past its due date while money is still owed (0 before that).
 * Only status 'active' loans are read; completed, cancelled and closed_early loans never flag.
 * Being ahead (advance payments) means nothing is overdue → 0. "Days since the last payment"
 * is informational only and never the basis of a flag.
 *
 * Per borrower: daysBehind = the WORST of their active loans, totalOverdue = the SUM.
 * Severity: 0 → none; 1 … flagAfter−1 → late; flagAfter … criticalAfter−1 → flagged;
 * criticalAfter or more → critical. Defaults 3 and 7.
 *
 * Worked examples (daily ₱150, defaults; today = T):
 *  A. ₱450 overdue → 3 days → flagged. ₱300 → 2 → late (badge only, not in "Needs attention").
 *     ₱1,050 → 7 → critical. Thresholds 2/5 instead: ₱300 → flagged, ₱750 → critical.
 *  B. Paid 5 days ahead, then nothing for 4 days: the fill covered those 4 days → ₱0 overdue → 0.
 *  C. ₱200 overdue (one ₱150 day missed + ₱50 short on another) → ceil(200 ÷ 150) = 2 days.
 *  D. Two active loans, 1 and 4 days behind (₱150 and ₱600) → borrower 4 days, ₱750 overdue.
 *  E. Completed / cancelled / closed_early loans are not in the input at all → no flag.
 *  F. skip_sundays: Saturday missed, no Sunday row; Monday morning (Monday due = today, not
 *     overdue) → ₱150 overdue → 1 day.
 *  G. Lump sum due T−8 with a balance → 8 days → critical.
 */

import { daysBetween, type PaymentType } from './loan';

export type Severity = 'none' | 'late' | 'flagged' | 'critical';

export const SEVERITY_RANK: Record<Severity, number> = { none: 0, late: 1, flagged: 2, critical: 3 };

export interface FlagThresholds {
  /** Days behind at which a borrower is "Flagged". */
  flagAfter: number;
  /** Days behind at which a borrower is "Critical". */
  criticalAfter: number;
}

export const DEFAULT_FLAG_THRESHOLDS: FlagThresholds = { flagAfter: 3, criticalAfter: 7 };
export const FLAG_THRESHOLD_LIMITS = { min: 1, max: 60 } as const;

export type ThresholdError = 'outOfRange' | 'order';

/** 1 ≤ flagAfter < criticalAfter ≤ 60, whole numbers. */
export function validateThresholds({ flagAfter, criticalAfter }: FlagThresholds): ThresholdError | null {
  const { min, max } = FLAG_THRESHOLD_LIMITS;
  const inRange = (n: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!inRange(flagAfter) || !inRange(criticalAfter)) return 'outOfRange';
  if (flagAfter >= criticalAfter) return 'order';
  return null;
}

export function severityFor(daysBehind: number, thresholds: FlagThresholds): Severity {
  if (daysBehind <= 0) return 'none';
  if (daysBehind >= thresholds.criticalAfter) return 'critical';
  if (daysBehind >= thresholds.flagAfter) return 'flagged';
  return 'late';
}

/** True for Flagged and Critical (what "Needs attention" and the Balda count show). */
export function isFlagged(severity: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK.flagged;
}

/** The loan fields daysBehind needs (a Collection row has them too). */
export interface LoanLateness {
  paymentType: PaymentType;
  installmentAmount: number;
  /** Outstanding on regular installments due before today. */
  overdueOutstanding: number;
  /** Oldest past-due date with money still owed (null if nothing overdue). */
  oldestOverdueDate: string | null;
}

export function loanDaysBehind(loan: LoanLateness, today: string): number {
  if (loan.overdueOutstanding <= 0) return 0;
  if (loan.paymentType === 'lump_sum') {
    return loan.oldestOverdueDate ? Math.max(1, daysBetween(loan.oldestOverdueDate, today)) : 1;
  }
  // A ₱0 installment amount can't divide anything: any overdue money is at least one day.
  if (loan.installmentAmount <= 0) return 1;
  return Math.ceil(loan.overdueOutstanding / loan.installmentAmount);
}

export interface FlagLoanRow extends LoanLateness {
  loanId: number;
  borrowerId: number;
  borrowerName: string;
  nickname: string | null;
  phone: string | null;
  /** Latest active, non-netted payment date across ALL the borrower's loans (informational). */
  lastPaymentDate: string | null;
}

export interface BorrowerFlag {
  borrowerId: number;
  borrowerName: string;
  nickname: string | null;
  phone: string | null;
  daysBehind: number;
  totalOverdue: number;
  severity: Severity;
  lastPaymentDate: string | null;
  /** Days since lastPaymentDate (null = no payments yet). */
  daysSinceLastPayment: number | null;
  /** Active loans with money overdue. */
  loanCount: number;
}

/**
 * Groups per-loan rows by borrower (worst daysBehind, summed overdue) and keeps those at or
 * above `minSeverity`. Sorted by daysBehind, then totalOverdue (both highest first), then name.
 */
export function buildBorrowerFlags(
  rows: FlagLoanRow[],
  today: string,
  thresholds: FlagThresholds,
  minSeverity: Exclude<Severity, 'none'> = 'late',
): BorrowerFlag[] {
  const byBorrower = new Map<number, BorrowerFlag>();
  for (const row of rows) {
    const days = loanDaysBehind(row, today);
    if (days <= 0) continue;
    const flag = byBorrower.get(row.borrowerId);
    if (flag) {
      flag.daysBehind = Math.max(flag.daysBehind, days);
      flag.totalOverdue += row.overdueOutstanding;
      flag.loanCount += 1;
    } else {
      byBorrower.set(row.borrowerId, {
        borrowerId: row.borrowerId,
        borrowerName: row.borrowerName,
        nickname: row.nickname,
        phone: row.phone,
        daysBehind: days,
        totalOverdue: row.overdueOutstanding,
        severity: 'none',
        lastPaymentDate: row.lastPaymentDate,
        daysSinceLastPayment: row.lastPaymentDate
          ? Math.max(0, daysBetween(row.lastPaymentDate, today))
          : null,
        loanCount: 1,
      });
    }
  }
  const result: BorrowerFlag[] = [];
  for (const flag of byBorrower.values()) {
    flag.severity = severityFor(flag.daysBehind, thresholds);
    if (SEVERITY_RANK[flag.severity] >= SEVERITY_RANK[minSeverity]) result.push(flag);
  }
  return result.sort(
    (a, b) =>
      b.daysBehind - a.daysBehind ||
      b.totalOverdue - a.totalOverdue ||
      a.borrowerName.localeCompare(b.borrowerName) ||
      a.borrowerId - b.borrowerId,
  );
}
