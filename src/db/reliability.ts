import type { SQLiteDatabase } from 'expo-sqlite';

import {
  computeReliability,
  RELIABILITY_CONFIG,
  type ReliabilityInstallment,
  type ReliabilityResult,
} from '@/lib/reliability';
import type { FlagThresholds } from '@/lib/flags';
import type { PaymentType } from '@/lib/loan';

import { getFlaggedBorrowers } from './flags';

type InstallmentRow = {
  borrower_id: number;
  payment_type: PaymentType;
  skip_sundays: number;
  original_due_date: string;
  /** null = not yet fully paid. */
  completion_date: string | null;
};

/** `null` ids = everyone; an empty array deliberately matches nothing. */
function borrowerFilter(ids: number[] | null, column: string) {
  if (ids === null) return { clause: '1 = 1', params: {} as Record<string, number> };
  if (ids.length === 0) return { clause: '1 = 0', params: {} as Record<string, number> };
  const params: Record<string, number> = {};
  const placeholders = ids.map((id, i) => {
    const key = `$b${i}`;
    params[key] = id;
    return key;
  });
  return { clause: `${column} IN (${placeholders.join(', ')})`, params };
}

/**
 * The borrower's most recent `maxHistoryInstallments` due installments (make-up, skipped and
 * settled rows excluded; cancelled loans excluded), each with its completion date. ONE query:
 *  - `due`: ranks installments per borrower (ROW_NUMBER, newest original_due_date first);
 *  - `alloc`: running cumulative total per installment over its active allocations, oldest
 *    paid_on first (same fill order recomputeLoan uses);
 *  - `completion`: the first paid_on whose running total reaches amount_due = the day it
 *    finished being paid (null if it never did).
 */
export async function getReliabilityInstallments(
  db: SQLiteDatabase,
  borrowerIds: number[] | null,
  today: string,
): Promise<Map<number, ReliabilityInstallment[]>> {
  const { clause, params } = borrowerFilter(borrowerIds, 'l.borrower_id');
  const rows = await db.getAllAsync<InstallmentRow>(
    `WITH due AS (
       SELECT i.id, l.borrower_id, l.payment_type, l.skip_sundays, i.original_due_date,
              i.amount_due,
              ROW_NUMBER() OVER (
                PARTITION BY l.borrower_id ORDER BY i.original_due_date DESC, i.id DESC
              ) AS rn
       FROM installments i
       JOIN loans l ON l.id = i.loan_id
       WHERE i.is_makeup = 0
         AND i.status NOT IN ('skipped', 'settled')
         AND i.original_due_date <= $today
         AND l.status != 'cancelled'
         AND ${clause}
     ),
     counted AS (
       SELECT * FROM due WHERE rn <= $maxHistory
     ),
     alloc AS (
       SELECT pa.installment_id, p.paid_on,
              SUM(pa.amount) OVER (
                PARTITION BY pa.installment_id ORDER BY p.paid_on, p.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS running_total
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id AND p.status = 'active'
       WHERE pa.installment_id IN (SELECT id FROM counted)
     ),
     completion AS (
       SELECT a.installment_id, MIN(a.paid_on) AS completion_date
       FROM alloc a
       JOIN installments i2 ON i2.id = a.installment_id
       WHERE a.running_total >= i2.amount_due
       GROUP BY a.installment_id
     )
     SELECT c.borrower_id, c.payment_type, c.skip_sundays, c.original_due_date,
            comp.completion_date
     FROM counted c
     LEFT JOIN completion comp ON comp.installment_id = c.id
     ORDER BY c.borrower_id, c.original_due_date`,
    { $today: today, $maxHistory: RELIABILITY_CONFIG.maxHistoryInstallments, ...params },
  );

  const byBorrower = new Map<number, ReliabilityInstallment[]>();
  for (const r of rows) {
    const list = byBorrower.get(r.borrower_id);
    const row: ReliabilityInstallment = {
      paymentType: r.payment_type,
      skipSundays: r.skip_sundays === 1,
      originalDueDate: r.original_due_date,
      completionDate: r.completion_date,
    };
    if (list) list.push(row);
    else byBorrower.set(r.borrower_id, [row]);
  }
  return byBorrower;
}

/** Loans 'completed' or 'closed_early', per borrower — ONE query. */
export async function getCompletedLoanCounts(
  db: SQLiteDatabase,
  borrowerIds: number[] | null,
): Promise<Map<number, number>> {
  const { clause, params } = borrowerFilter(borrowerIds, 'borrower_id');
  const rows = await db.getAllAsync<{ borrower_id: number; n: number }>(
    `SELECT borrower_id, COUNT(*) AS n FROM loans
     WHERE status IN ('completed', 'closed_early') AND ${clause}
     GROUP BY borrower_id`,
    params,
  );
  return new Map(rows.map((r) => [r.borrower_id, r.n]));
}

/**
 * Ratings for a list of borrowers, or 'all'. A small FIXED number of queries regardless of how
 * many borrowers: the installment history (1), completed-loan counts (1), and the existing
 * Phase 9 flags query (1, reused for currentDaysBehind) — plus one more to list every borrower
 * id only when `borrowerIds` is 'all'. Never one query per borrower.
 */
export async function getReliabilityRatings(
  db: SQLiteDatabase,
  borrowerIds: number[] | 'all',
  today: string,
  thresholds: FlagThresholds,
): Promise<Map<number, ReliabilityResult>> {
  let requested: number[];
  let queryIds: number[] | null;
  if (borrowerIds === 'all') {
    const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM borrowers');
    requested = rows.map((r) => r.id);
    queryIds = null;
  } else {
    requested = borrowerIds;
    queryIds = borrowerIds;
  }

  const [installments, completed, flagged] = await Promise.all([
    getReliabilityInstallments(db, queryIds, today),
    getCompletedLoanCounts(db, queryIds),
    getFlaggedBorrowers(db, today, { thresholds, minSeverity: 'late' }),
  ]);
  const daysBehind = new Map(flagged.map((f) => [f.borrowerId, f.daysBehind]));

  const result = new Map<number, ReliabilityResult>();
  for (const id of requested) {
    result.set(
      id,
      computeReliability(
        installments.get(id) ?? [],
        completed.get(id) ?? 0,
        daysBehind.get(id) ?? 0,
        thresholds,
        today,
      ),
    );
  }
  return result;
}

/** One borrower's rating (borrower detail, the loan form's Risky banner). */
export async function getBorrowerReliability(
  db: SQLiteDatabase,
  borrowerId: number,
  today: string,
  thresholds: FlagThresholds,
): Promise<ReliabilityResult> {
  const map = await getReliabilityRatings(db, [borrowerId], today, thresholds);
  return map.get(borrowerId) ?? computeReliability([], 0, 0, thresholds, today);
}
