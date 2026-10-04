import type { SQLiteDatabase } from 'expo-sqlite';

import { principalOutstanding, summarizeProfit, type ProfitSummary } from '@/lib/profit';
import { datesInRange } from '@/lib/ranges';
import type { PaymentKind } from '@/types/loan';

/**
 * Principal / interest / cash for fromDate ≤ paid_on ≤ toDate (both inclusive, so a payment on
 * a boundary day is counted once). Three queries, whatever the data size:
 *  1. active payments in the range, joined with their loan's principal and total;
 *  2. per loan in (1), the sum of active REGULAR payments dated before fromDate, so cumulative
 *     splits match the full history (see src/lib/profit.ts);
 *  3. discounts given (loans closed early in the range) and new loans released (start_date in
 *     the range; cancelled loans excluded).
 */
export async function getProfitSummary(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string,
): Promise<ProfitSummary> {
  const range = { $from: fromDate, $to: toDate };
  const [payments, prior, loans] = await Promise.all([
    db.getAllAsync<{
      id: number;
      loan_id: number;
      amount: number;
      paid_on: string;
      type: PaymentKind;
      is_netted: number;
      principal: number;
      total_payable: number;
    }>(
      `SELECT p.id, p.loan_id, p.amount, p.paid_on, p.type, p.is_netted,
              l.principal, l.total_payable
       FROM payments p
       JOIN loans l ON l.id = p.loan_id
       WHERE p.status = 'active' AND p.paid_on BETWEEN $from AND $to`,
      range,
    ),
    db.getAllAsync<{ loan_id: number; paid: number }>(
      `SELECT loan_id, SUM(amount) AS paid
       FROM payments
       WHERE status = 'active' AND type = 'regular' AND paid_on < $from
         AND loan_id IN (SELECT loan_id FROM payments
                         WHERE status = 'active' AND paid_on BETWEEN $from AND $to)
       GROUP BY loan_id`,
      range,
    ),
    db.getFirstAsync<{ discounts: number; released: number; released_count: number }>(
      `SELECT
         (SELECT COALESCE(SUM(discount_amount), 0) FROM loans
          WHERE status = 'closed_early' AND closed_at BETWEEN $from AND $to) AS discounts,
         (SELECT COALESCE(SUM(principal), 0) FROM loans
          WHERE status != 'cancelled' AND start_date BETWEEN $from AND $to) AS released,
         (SELECT COUNT(*) FROM loans
          WHERE status != 'cancelled' AND start_date BETWEEN $from AND $to) AS released_count`,
      range,
    ),
  ]);

  return summarizeProfit({
    fromDate,
    toDate,
    payments: payments.map((p) => ({
      id: p.id,
      loanId: p.loan_id,
      amount: p.amount,
      paidOn: p.paid_on,
      type: p.type,
      isNetted: p.is_netted === 1,
      principal: p.principal,
      totalPayable: p.total_payable,
    })),
    priorRegularPaid: new Map(prior.map((r) => [r.loan_id, r.paid])),
    discountsGiven: loans?.discounts ?? 0,
    newLoansReleased: { amount: loans?.released ?? 0, count: loans?.released_count ?? 0 },
    dates: datesInRange({ from: fromDate, to: toDate }),
  });
}

export interface PortfolioStats {
  /** Borrowers with at least one active loan. */
  activeBorrowers: number;
  activeLoans: number;
  /** Sum of balances (total payable − paid) of active loans. */
  outstanding: number;
  /** Principal not yet returned on active loans (same split as the reports). */
  principalOutstanding: number;
  /** Non-archived borrowers, and loans of any status (to tell a brand-new database apart). */
  borrowerCount: number;
  loanCount: number;
}

/**
 * ONE query: a row per active loan with its active payments total (only regular payments can
 * exist while a loan is active), plus a last row with the borrower and loan counts.
 */
export async function getPortfolioStats(db: SQLiteDatabase): Promise<PortfolioStats> {
  const rows = await db.getAllAsync<{
    /** NULL on the last row, which carries the two counts instead. */
    borrower_id: number | null;
    principal: number;
    total_payable: number;
    regular_paid: number;
    all_paid: number;
    borrower_count: number | null;
    loan_count: number | null;
  }>(
    `SELECT l.borrower_id, l.principal, l.total_payable,
            COALESCE(SUM(CASE WHEN p.type = 'regular' THEN p.amount END), 0) AS regular_paid,
            COALESCE(SUM(p.amount), 0) AS all_paid,
            NULL AS borrower_count, NULL AS loan_count
     FROM loans l
     -- "+p.status": keep SQLite on the loan_id index; the low-selectivity status index made
     -- this a payments scan per loan (240 ms with 200 loans / 5,000 payments, ~2 ms without).
     LEFT JOIN payments p ON p.loan_id = l.id AND +p.status = 'active'
     WHERE l.status = 'active'
     GROUP BY l.id
     UNION ALL
     SELECT NULL, 0, 0, 0, 0,
            (SELECT COUNT(*) FROM borrowers WHERE archived_at IS NULL),
            (SELECT COUNT(*) FROM loans)`,
  );
  const stats: PortfolioStats = {
    activeBorrowers: 0,
    activeLoans: 0,
    outstanding: 0,
    principalOutstanding: 0,
    borrowerCount: 0,
    loanCount: 0,
  };
  const borrowers = new Set<number>();
  for (const r of rows) {
    if (r.borrower_id === null) {
      stats.borrowerCount = r.borrower_count ?? 0;
      stats.loanCount = r.loan_count ?? 0;
      continue;
    }
    borrowers.add(r.borrower_id);
    stats.activeLoans += 1;
    stats.outstanding += Math.max(0, r.total_payable - r.all_paid);
    stats.principalOutstanding += principalOutstanding(r.regular_paid, r.principal, r.total_payable);
  }
  stats.activeBorrowers = borrowers.size;
  return stats;
}
