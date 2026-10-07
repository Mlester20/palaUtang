import type { SQLiteDatabase } from 'expo-sqlite';

import { writeTransaction } from './transaction';

/** One area (or "No area", `area: null`) with how many ACTIVE borrowers are on its route. */
export interface RouteAreaSummary {
  area: string | null;
  activeBorrowerCount: number;
}

/**
 * Every area in use, A–Z order from the database (screens apply the saved area order on top via
 * compareByAreaOrder), including "No area" (`area: null`) — ONE query, GROUP BY treats NULL as
 * its own group. Counts ACTIVE borrowers only: this is for the route screens, not the "how many
 * would be affected by a rename" count on the Areas management screen (src/db/areas.ts getAreas).
 */
export async function getAreasForRoute(db: SQLiteDatabase): Promise<RouteAreaSummary[]> {
  const rows = await db.getAllAsync<{ area: string | null; n: number }>(
    `SELECT area, COUNT(*) AS n FROM borrowers WHERE archived_at IS NULL GROUP BY area`,
  );
  return rows
    .map((r) => ({ area: r.area, activeBorrowerCount: r.n }))
    .sort((a, b) => (a.area ?? '').localeCompare(b.area ?? ''));
}

/** One borrower's row on an area's route screen. */
export interface RouteBorrower {
  id: number;
  fullName: string;
  nickname: string | null;
  address: string | null;
  phone: string | null;
  /** 1-based rank on this route; null = not yet placed (shouldn't happen for a matched area). */
  routePosition: number | null;
  activeLoanCount: number;
  hasOverdueBalance: boolean;
}

/**
 * Active borrowers in `areaName`, route order (route_position, NULLs last, then name) — ONE
 * query, no loops. `today` drives the overdue check (installments due before today, still owed).
 */
export async function getRouteBorrowers(
  db: SQLiteDatabase,
  areaName: string,
  today: string,
): Promise<RouteBorrower[]> {
  const rows = await db.getAllAsync<{
    id: number;
    full_name: string;
    nickname: string | null;
    address: string | null;
    phone: string | null;
    route_position: number | null;
    active_loan_count: number;
    has_overdue: number;
  }>(
    `SELECT b.id, b.full_name, b.nickname, b.address, b.phone, b.route_position,
            (SELECT COUNT(*) FROM loans l WHERE l.borrower_id = b.id AND l.status = 'active')
              AS active_loan_count,
            EXISTS (
              SELECT 1 FROM loans l
              JOIN installments i ON i.loan_id = l.id
              WHERE l.borrower_id = b.id AND l.status = 'active' AND i.is_makeup = 0
                AND i.due_date < $today AND i.amount_paid + i.waived_amount < i.amount_due
            ) AS has_overdue
     FROM borrowers b
     WHERE b.archived_at IS NULL AND b.area IS NOT NULL AND lower(b.area) = lower($area)
     ORDER BY (b.route_position IS NULL), b.route_position, b.full_name COLLATE NOCASE`,
    { $area: areaName, $today: today },
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    nickname: r.nickname,
    address: r.address,
    phone: r.phone,
    routePosition: r.route_position,
    activeLoanCount: r.active_loan_count,
    hasOverdueBalance: r.has_overdue === 1,
  }));
}

/**
 * Renumbers `areaName`'s active borrowers 1..N to match `orderedBorrowerIds`, in ONE transaction.
 * Tolerates a stale list (the screen's draft may be out of date with what's actually in the area
 * by the time Save is tapped): ids no longer in the area are ignored, and borrowers in the area
 * but missing from the list are appended at the end in their current order.
 */
export async function saveAreaRoute(
  db: SQLiteDatabase,
  areaName: string,
  orderedBorrowerIds: number[],
): Promise<void> {
  return writeTransaction(db, async () => {
    const current = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM borrowers WHERE archived_at IS NULL AND area IS NOT NULL AND lower(area) = lower(?)
       ORDER BY (route_position IS NULL), route_position, full_name COLLATE NOCASE`,
      [areaName],
    );
    const currentIds = new Set(current.map((r) => r.id));
    const kept = orderedBorrowerIds.filter((id) => currentIds.has(id));
    const keptSet = new Set(kept);
    const missing = current.map((r) => r.id).filter((id) => !keptSet.has(id));
    const finalOrder = [...kept, ...missing];
    for (let i = 0; i < finalOrder.length; i++) {
      await db.runAsync('UPDATE borrowers SET route_position = ? WHERE id = ?', [i + 1, finalOrder[i]]);
    }
  });
}
