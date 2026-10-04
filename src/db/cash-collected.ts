import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * THE definition of "cash collected", shared by the Collection tab, the Home dashboard,
 * Reports and the cash ledger: ACTIVE payments (regular or cash settlement), EXCLUDING netted
 * settlements (deducted from a renewal's principal; no cash changed hands). The same rule in
 * JavaScript is isCashPayment() in src/lib/cash.ts.
 *
 * The unary "+" keeps SQLite on the paid_on / loan_id indexes instead of the low-selectivity
 * status index (see getPortfolioStats).
 */
export function cashPaymentCondition(alias = 'p'): string {
  return `+${alias}.status = 'active' AND +${alias}.is_netted = 0`;
}

export interface CashCollectedDay {
  date: string;
  amount: number;
  /** Number of cash payments that day. */
  count: number;
}

/** Cash collected per day, fromDate ≤ paid_on ≤ toDate (one aggregate query), oldest first. */
export async function getCashCollectedByDay(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string,
): Promise<CashCollectedDay[]> {
  return db.getAllAsync<CashCollectedDay>(
    `SELECT p.paid_on AS date, SUM(p.amount) AS amount, COUNT(*) AS count
     FROM payments p
     WHERE ${cashPaymentCondition('p')} AND p.paid_on BETWEEN $from AND $to
     GROUP BY p.paid_on
     ORDER BY p.paid_on`,
    { $from: fromDate, $to: toDate },
  );
}

/** Total cash collected, fromDate ≤ paid_on ≤ toDate (one aggregate query). */
export async function getCashCollectedTotal(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount), 0) AS total
     FROM payments p
     WHERE ${cashPaymentCondition('p')} AND p.paid_on BETWEEN $from AND $to`,
    { $from: fromDate, $to: toDate },
  );
  return row?.total ?? 0;
}
