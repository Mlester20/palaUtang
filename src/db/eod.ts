import type { SQLiteDatabase } from 'expo-sqlite';

import { cashPaymentCondition } from './cash-collected';

/**
 * Queries the End of Day report needs that no existing module already provides. Everything else
 * (cash collected, cash reconciliation, profit, loan releases, flagged count) is read straight
 * from src/db/cash.ts, src/db/cash-collected.ts, src/db/reports.ts, src/db/flags.ts — see
 * src/lib/eodReport.ts for how the pieces are assembled.
 */

export interface DayPaymentsSummary {
  /** Cash payments (regular + cash settlement, netted excluded) dated that day. */
  count: number;
  distinctBorrowers: number;
}

/** Number of cash payments and distinct borrowers who paid on `date` — ONE query. */
export async function getDayPaymentsSummary(
  db: SQLiteDatabase,
  date: string,
): Promise<DayPaymentsSummary> {
  const row = await db.getFirstAsync<{ n: number; borrowers: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT l.borrower_id) AS borrowers
     FROM payments p JOIN loans l ON l.id = p.loan_id
     WHERE ${cashPaymentCondition('p')} AND p.paid_on = $date`,
    { $date: date },
  );
  return { count: row?.n ?? 0, distinctBorrowers: row?.borrowers ?? 0 };
}

export interface DayAllocation {
  /** The covered installment's original_due_date (never shifted). */
  originalDueDate: string;
  amount: number;
}

/** Every regular payment's allocations dated `date` — feeds computeAppliedBreakdown (ONE query). */
export async function getDayRegularAllocations(
  db: SQLiteDatabase,
  date: string,
): Promise<DayAllocation[]> {
  const rows = await db.getAllAsync<{ original_due_date: string; amount: number }>(
    `SELECT i.original_due_date, pa.amount
     FROM payment_allocations pa
     JOIN payments p ON p.id = pa.payment_id
     JOIN installments i ON i.id = pa.installment_id
     WHERE p.status = 'active' AND p.type = 'regular' AND p.paid_on = $date`,
    { $date: date },
  );
  return rows.map((r) => ({ originalDueDate: r.original_due_date, amount: r.amount }));
}

export interface DaySettlements {
  cashSettlementCount: number;
  cashSettlementAmount: number;
  nettedCount: number;
  nettedAmount: number;
  /** Discount forgiven on loans closed early ON this date. */
  discountGiven: number;
}

/** Early payoffs (cash + netted) and discounts given on `date` — ONE query (5 scalar subqueries). */
export async function getDaySettlements(db: SQLiteDatabase, date: string): Promise<DaySettlements> {
  const row = await db.getFirstAsync<{
    cash_count: number;
    cash_amount: number;
    netted_count: number;
    netted_amount: number;
    discount: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM payments
        WHERE status = 'active' AND type = 'settlement' AND is_netted = 0 AND paid_on = $date) AS cash_count,
       (SELECT COALESCE(SUM(amount), 0) FROM payments
        WHERE status = 'active' AND type = 'settlement' AND is_netted = 0 AND paid_on = $date) AS cash_amount,
       (SELECT COUNT(*) FROM payments
        WHERE status = 'active' AND type = 'settlement' AND is_netted = 1 AND paid_on = $date) AS netted_count,
       (SELECT COALESCE(SUM(amount), 0) FROM payments
        WHERE status = 'active' AND type = 'settlement' AND is_netted = 1 AND paid_on = $date) AS netted_amount,
       (SELECT COALESCE(SUM(discount_amount), 0) FROM loans
        WHERE status = 'closed_early' AND closed_at = $date) AS discount`,
    { $date: date },
  );
  return {
    cashSettlementCount: row?.cash_count ?? 0,
    cashSettlementAmount: row?.cash_amount ?? 0,
    nettedCount: row?.netted_count ?? 0,
    nettedAmount: row?.netted_amount ?? 0,
    discountGiven: row?.discount ?? 0,
  };
}

export interface MissedLoan {
  loanId: number;
  borrowerName: string;
  unpaidAmount: number;
}

export interface MissedThatDay {
  loanCount: number;
  unpaidAmount: number;
  /** Worst (biggest unpaid) first — for the optional "Missed today" borrower list. */
  loans: MissedLoan[];
}

/**
 * Installments (make-ups included) due ON `date`, still unpaid AS OF THE END OF `date` — i.e.
 * using cumulative ACTIVE allocations with paid_on <= date (not the cached, present-day
 * amount_paid column, which would show a later recovery). A loan only counts if it was still
 * active as of `date`: not cancelled, and not closed early on or before `date` (closed_at is the
 * actual settlement date, so this is a precise historical check, not today's cached status).
 * 'skipped' installments never had anything due, so they're excluded too. ONE query (CTEs).
 */
export async function getMissedThatDay(db: SQLiteDatabase, date: string): Promise<MissedThatDay> {
  const rows = await db.getAllAsync<{ loan_id: number; borrower_name: string; unpaid: number }>(
    `WITH due_that_day AS (
       SELECT i.id, i.loan_id, i.amount_due
       FROM installments i
       JOIN loans l ON l.id = i.loan_id
       WHERE i.original_due_date = $date
         AND i.status != 'skipped'
         AND l.status != 'cancelled'
         AND (l.closed_at IS NULL OR l.closed_at > $date)
     ),
     paid_by_date AS (
       SELECT pa.installment_id, SUM(pa.amount) AS paid
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE p.status = 'active' AND p.paid_on <= $date
         AND pa.installment_id IN (SELECT id FROM due_that_day)
       GROUP BY pa.installment_id
     )
     SELECT d.loan_id, b.full_name AS borrower_name,
            SUM(d.amount_due - COALESCE(pbd.paid, 0)) AS unpaid
     FROM due_that_day d
     JOIN loans l ON l.id = d.loan_id
     JOIN borrowers b ON b.id = l.borrower_id
     LEFT JOIN paid_by_date pbd ON pbd.installment_id = d.id
     GROUP BY d.loan_id
     HAVING SUM(d.amount_due - COALESCE(pbd.paid, 0)) > 0
     ORDER BY unpaid DESC`,
    { $date: date },
  );
  return {
    loanCount: rows.length,
    unpaidAmount: rows.reduce((sum, r) => sum + r.unpaid, 0),
    loans: rows.map((r) => ({ loanId: r.loan_id, borrowerName: r.borrower_name, unpaidAmount: r.unpaid })),
  };
}

export interface PaidBorrower {
  borrowerId: number;
  borrowerName: string;
  amount: number;
}

/** Per-borrower cash total for `date`, biggest first — for the optional "Paid today" list. */
export async function getPaidBorrowersForDay(db: SQLiteDatabase, date: string): Promise<PaidBorrower[]> {
  const rows = await db.getAllAsync<{ borrower_id: number; borrower_name: string; amount: number }>(
    `SELECT b.id AS borrower_id, b.full_name AS borrower_name, SUM(p.amount) AS amount
     FROM payments p
     JOIN loans l ON l.id = p.loan_id
     JOIN borrowers b ON b.id = l.borrower_id
     WHERE ${cashPaymentCondition('p')} AND p.paid_on = $date
     GROUP BY b.id
     ORDER BY amount DESC`,
    { $date: date },
  );
  return rows.map((r) => ({
    borrowerId: r.borrower_id,
    borrowerName: r.borrower_name,
    amount: r.amount,
  }));
}
