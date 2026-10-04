import type { SQLiteDatabase } from 'expo-sqlite';

import { summarizeCollection, type ClassifiedRow, type CollectionSummary } from '@/lib/collection';
import type { BorrowerFlag, FlagThresholds } from '@/lib/flags';
import type { DailyProfit } from '@/lib/profit';
import { datesInRange, monthRange, unionRange, weekRange } from '@/lib/ranges';

import { getCashSummary, type CashSummary } from './cash';
import { getCollectionList } from './collection';
import { getFlaggedBorrowers } from './flags';
import { getPortfolioStats, getProfitSummary, type PortfolioStats } from './reports';

export interface DashboardSnapshot {
  today: string;
  /** Collection rows for today (same source as the Collection tab). */
  collection: ClassifiedRow[];
  summary: CollectionSummary;
  stats: PortfolioStats;
  /** Flagged and Critical borrowers, worst first. */
  flagged: BorrowerFlag[];
  /** Monday → Sunday of this week: cash collected (netted settlements excluded). */
  week: DailyProfit[];
  /** Interest earned from the 1st of this month to its last day. */
  monthInterest: number;
  /** Cash on hand today (cashOnHand null = cash tracking not set up yet). */
  cash: CashSummary;
}

/**
 * Everything the Home screen shows, in a fixed number of queries no matter how many loans:
 * collection list (1) + portfolio stats (1) + flags (1) + profit for this week ∪ this month (3)
 * + cash summary (4).
 * Call reconcileAllActiveLoans(today) first so balda statuses are current.
 */
export async function loadDashboard(
  db: SQLiteDatabase,
  today: string,
  thresholds: FlagThresholds,
): Promise<DashboardSnapshot> {
  const week = weekRange(today);
  const month = monthRange(today);
  const span = unionRange(week, month);
  const [collection, stats, flagged, profit, cash] = await Promise.all([
    getCollectionList(db, today),
    getPortfolioStats(db),
    getFlaggedBorrowers(db, today, { thresholds, minSeverity: 'flagged' }),
    getProfitSummary(db, span.from, span.to),
    getCashSummary(db, today),
  ]);
  const byDate = new Map(profit.days.map((d) => [d.date, d]));
  return {
    today,
    collection,
    summary: summarizeCollection(collection),
    stats,
    flagged,
    week: datesInRange(week).map(
      (date) => byDate.get(date) ?? { date, cashCollected: 0, interestEarned: 0 },
    ),
    monthInterest: profit.days
      .filter((d) => d.date >= month.from && d.date <= month.to)
      .reduce((sum, d) => sum + d.interestEarned, 0),
    cash,
  };
}
