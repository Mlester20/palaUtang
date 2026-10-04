import type { SQLiteDatabase } from 'expo-sqlite';

import {
  buildBorrowerFlags,
  type BorrowerFlag,
  type FlagLoanRow,
  type FlagThresholds,
  type Severity,
} from '@/lib/flags';
import type { PaymentType } from '@/types/loan';

type FlagSqlRow = {
  loan_id: number;
  borrower_id: number;
  borrower_name: string;
  nickname: string | null;
  phone: string | null;
  payment_type: PaymentType;
  installment_amount: number;
  overdue_outstanding: number;
  oldest_overdue_date: string | null;
  last_payment_date: string | null;
};

/**
 * ONE query: every ACTIVE loan with money overdue on regular installments (due_date < today;
 * make-ups excluded), plus each such borrower's latest active, non-netted payment date across
 * all their loans. Reads amount_paid / waived_amount, which don't depend on `today`, so it is
 * correct even before a reconcile. `$borrowerId` NULL = everyone.
 */
const FLAGS_SQL = `
  WITH overdue AS (
    SELECT i.loan_id,
           SUM(i.amount_due - i.amount_paid - i.waived_amount) AS overdue_outstanding,
           MIN(CASE WHEN i.amount_paid + i.waived_amount < i.amount_due THEN i.due_date END)
             AS oldest_overdue_date
    FROM installments i
    JOIN loans l ON l.id = i.loan_id
    WHERE l.status = 'active'
      AND i.is_makeup = 0
      AND i.due_date < $today
      AND ($borrowerId IS NULL OR l.borrower_id = $borrowerId)
    GROUP BY i.loan_id
    HAVING SUM(i.amount_due - i.amount_paid - i.waived_amount) > 0
  ),
  last_paid AS (
    SELECT l.borrower_id, MAX(p.paid_on) AS last_payment_date
    FROM payments p
    JOIN loans l ON l.id = p.loan_id
    WHERE p.status = 'active' AND p.is_netted = 0
      AND l.borrower_id IN (SELECT lo.borrower_id FROM loans lo JOIN overdue o ON o.loan_id = lo.id)
    GROUP BY l.borrower_id
  )
  SELECT l.id AS loan_id,
         b.id AS borrower_id,
         b.full_name AS borrower_name,
         b.nickname,
         b.phone,
         l.payment_type,
         l.installment_amount,
         o.overdue_outstanding,
         o.oldest_overdue_date,
         lp.last_payment_date
  FROM overdue o
  JOIN loans l ON l.id = o.loan_id
  JOIN borrowers b ON b.id = l.borrower_id
  LEFT JOIN last_paid lp ON lp.borrower_id = b.id`;

async function loadFlagRows(
  db: SQLiteDatabase,
  today: string,
  borrowerId: number | null,
): Promise<FlagLoanRow[]> {
  const rows = await db.getAllAsync<FlagSqlRow>(FLAGS_SQL, {
    $today: today,
    $borrowerId: borrowerId,
  });
  return rows.map((r) => ({
    loanId: r.loan_id,
    borrowerId: r.borrower_id,
    borrowerName: r.borrower_name,
    nickname: r.nickname,
    phone: r.phone,
    paymentType: r.payment_type,
    installmentAmount: r.installment_amount,
    overdueOutstanding: r.overdue_outstanding,
    oldestOverdueDate: r.oldest_overdue_date,
    lastPaymentDate: r.last_payment_date,
  }));
}

/**
 * Borrowers behind on their active loans at or above `minSeverity` (default: everyone behind,
 * i.e. Late and up), worst first: daysBehind desc, then totalOverdue desc.
 */
export async function getFlaggedBorrowers(
  db: SQLiteDatabase,
  today: string,
  {
    thresholds,
    minSeverity = 'late',
  }: { thresholds: FlagThresholds; minSeverity?: Exclude<Severity, 'none'> },
): Promise<BorrowerFlag[]> {
  return buildBorrowerFlags(await loadFlagRows(db, today, null), today, thresholds, minSeverity);
}

/** One borrower's flag (null when they aren't behind). */
export async function getBorrowerFlag(
  db: SQLiteDatabase,
  borrowerId: number,
  today: string,
  thresholds: FlagThresholds,
): Promise<BorrowerFlag | null> {
  const flags = buildBorrowerFlags(await loadFlagRows(db, today, borrowerId), today, thresholds);
  return flags[0] ?? null;
}
