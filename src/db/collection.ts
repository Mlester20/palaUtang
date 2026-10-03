import type { SQLiteDatabase } from 'expo-sqlite';

import {
  classifyRow,
  summarizeCollection,
  type ClassifiedRow,
  type CollectionRow,
  type CollectionSummary,
} from '@/lib/collection';
import type { LoanStatus, PaymentStatus, PaymentType } from '@/types/loan';

type CollectionSqlRow = {
  loan_id: number;
  borrower_id: number;
  borrower_name: string;
  nickname: string | null;
  phone: string | null;
  payment_type: PaymentType;
  loan_status: LoanStatus;
  installment_amount: number;
  due_today_amount: number;
  due_today_outstanding: number;
  overdue_outstanding: number;
  balda_days: number;
  oldest_overdue_date: string | null;
  collected_today: number;
  today_covered_last_paid_on: string | null;
};

/**
 * ONE query for the whole collection day. Reads the installment cache (call
 * reconcileAllActiveLoans(today) first). Only regular installments due on or before today are
 * scanned (index on due_date); make-up rows are excluded because their money is already counted
 * as overdue on the missed day.
 *
 * Returned loans: active loans with something due today or overdue, plus any loan with an active
 * payment dated today (so paid / paid-in-advance / just-completed loans show in "Paid").
 */
const COLLECTION_SQL = `
  WITH paid_today AS (
    SELECT loan_id, SUM(amount) AS collected_today
    FROM payments
    WHERE status = 'active' AND paid_on = $today
    GROUP BY loan_id
  ),
  inst AS (
    SELECT i.loan_id,
           SUM(CASE WHEN i.due_date = $today THEN i.amount_due ELSE 0 END) AS due_today_amount,
           SUM(CASE WHEN i.due_date = $today THEN i.amount_due - i.amount_paid ELSE 0 END)
             AS due_today_outstanding,
           SUM(CASE WHEN i.due_date < $today THEN i.amount_due - i.amount_paid ELSE 0 END)
             AS overdue_outstanding,
           SUM(CASE WHEN i.due_date < $today AND i.status = 'missed' THEN 1 ELSE 0 END)
             AS balda_days,
           MIN(CASE WHEN i.due_date < $today AND i.amount_paid < i.amount_due THEN i.due_date END)
             AS oldest_overdue_date
    FROM installments i
    JOIN loans l ON l.id = i.loan_id
    WHERE i.is_makeup = 0
      AND i.due_date <= $today
      AND (l.status = 'active' OR l.id IN (SELECT loan_id FROM paid_today))
    GROUP BY i.loan_id
  ),
  today_cover AS (
    -- Latest date of the active payments that cover today's installment (advance detection).
    SELECT i.loan_id, MAX(p.paid_on) AS last_paid_on
    FROM installments i
    JOIN payment_allocations pa ON pa.installment_id = i.id
    JOIN payments p ON p.id = pa.payment_id AND p.status = 'active'
    WHERE i.is_makeup = 0 AND i.due_date = $today
    GROUP BY i.loan_id
  )
  SELECT l.id AS loan_id,
         b.id AS borrower_id,
         b.full_name AS borrower_name,
         b.nickname,
         b.phone,
         l.payment_type,
         l.status AS loan_status,
         l.installment_amount,
         COALESCE(inst.due_today_amount, 0) AS due_today_amount,
         COALESCE(inst.due_today_outstanding, 0) AS due_today_outstanding,
         COALESCE(inst.overdue_outstanding, 0) AS overdue_outstanding,
         COALESCE(inst.balda_days, 0) AS balda_days,
         inst.oldest_overdue_date,
         COALESCE(pt.collected_today, 0) AS collected_today,
         tc.last_paid_on AS today_covered_last_paid_on
  FROM loans l
  JOIN borrowers b ON b.id = l.borrower_id
  LEFT JOIN inst ON inst.loan_id = l.id
  LEFT JOIN paid_today pt ON pt.loan_id = l.id
  LEFT JOIN today_cover tc ON tc.loan_id = l.id
  WHERE (l.status = 'active'
         AND (COALESCE(inst.due_today_amount, 0) > 0 OR COALESCE(inst.overdue_outstanding, 0) > 0))
     OR pt.collected_today > 0`;

function toRow(r: CollectionSqlRow): CollectionRow {
  return {
    loanId: r.loan_id,
    borrowerId: r.borrower_id,
    borrowerName: r.borrower_name,
    nickname: r.nickname,
    phone: r.phone,
    paymentType: r.payment_type,
    loanStatus: r.loan_status,
    installmentAmount: r.installment_amount,
    dueTodayAmount: r.due_today_amount,
    dueTodayOutstanding: r.due_today_outstanding,
    overdueOutstanding: r.overdue_outstanding,
    baldaDays: r.balda_days,
    oldestOverdueDate: r.oldest_overdue_date,
    collectedToday: r.collected_today,
    todayCoveredLastPaidOn: r.today_covered_last_paid_on,
  };
}

/** Every loan relevant to `today`'s collection, classified (overdue / due today / paid…). */
export async function getCollectionList(
  db: SQLiteDatabase,
  today: string,
): Promise<ClassifiedRow[]> {
  const rows = await db.getAllAsync<CollectionSqlRow>(COLLECTION_SQL, { $today: today });
  return rows.map((r) => classifyRow(toRow(r), today));
}

/** Expected, collected, remaining, progress and counts for `today`. */
export async function getCollectionSummary(
  db: SQLiteDatabase,
  today: string,
): Promise<CollectionSummary> {
  return summarizeCollection(await getCollectionList(db, today));
}

export interface DatedPayment {
  id: number;
  loanId: number;
  borrowerId: number;
  borrowerName: string;
  amount: number;
  note: string | null;
  status: PaymentStatus;
  voidReason: string | null;
  /** ISO timestamp of when it was entered (for the time shown). */
  createdAt: string;
}

/** Active and voided payments dated `date`, newest entry first. */
export async function getPaymentsByDate(db: SQLiteDatabase, date: string): Promise<DatedPayment[]> {
  const rows = await db.getAllAsync<{
    id: number;
    loan_id: number;
    borrower_id: number;
    borrower_name: string;
    amount: number;
    note: string | null;
    status: PaymentStatus;
    void_reason: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.loan_id, b.id AS borrower_id, b.full_name AS borrower_name, p.amount, p.note,
            p.status, p.void_reason, p.created_at
     FROM payments p
     JOIN loans l ON l.id = p.loan_id
     JOIN borrowers b ON b.id = l.borrower_id
     WHERE p.paid_on = ?
     ORDER BY p.created_at DESC, p.id DESC`,
    [date],
  );
  return rows.map((r) => ({
    id: r.id,
    loanId: r.loan_id,
    borrowerId: r.borrower_id,
    borrowerName: r.borrower_name,
    amount: r.amount,
    note: r.note,
    status: r.status,
    voidReason: r.void_reason,
    createdAt: r.created_at,
  }));
}

/** Active loans in total (to tell "no loans at all" apart from "nothing due today"). */
export async function countActiveLoans(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM loans WHERE status = 'active'",
  );
  return row?.n ?? 0;
}
