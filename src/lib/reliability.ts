/**
 * Borrower reliability rating: a simple, explainable guide from payment history. It never
 * blocks a loan — it's a heads-up for the lender. Pure: no database, no React; `today` and the
 * thresholds are parameters (the same thresholds Settings uses for balda flags, Phase 9).
 *
 * Rows (src/db/reliability.ts, ONE query): the borrower's most recent 60 "due" installments
 * (original_due_date <= today) across all their non-cancelled loans — make-up, skipped and
 * settled (early-payoff waived) rows excluded, so this reads as a history of ordinary
 * collection days. A lump-sum loan contributes ONE row.
 *
 * Completion date: the data layer finds, per installment, the paid_on of the active allocation
 * whose running cumulative total first reaches amount_due (oldest-first, same fill order as
 * recomputeLoan) — i.e. the day it finished being paid. Still-unpaid installments due before
 * today are "currently late", measured up to today; one due exactly today isn't late yet.
 *
 * lateDays = COLLECTION days from the original due date to the completion date (or today),
 * skipping Sundays when the loan does (collectionDaysBetween, src/lib/loan.ts). Paid on or
 * before the due date — including in advance — is 0 = on time.
 *
 * Tiers, checked in THIS order (first match wins):
 *  1. NEW:      the weighted history (below) has fewer than minCountedInstallments.
 *  2. RISKY:    onTimeRate < riskyOnTimeRateBelow, OR currentDaysBehind >= criticalAfter,
 *               OR maxLateDays >= riskyMaxLateDaysAtLeast.
 *  3. RELIABLE: onTimeRate >= reliableOnTimeRateAtLeast AND currentDaysBehind < flagAfter
 *               AND maxLateDays <= reliableMaxLateDaysAtMost.
 *  4. FAIR:     everything else.
 *
 * History weight (NEW check only — percentages always count each installment as 1): a
 * lump-sum installment counts as `lumpSumHistoryWeight` (5). One lump-sum installment alone
 * therefore has weight 5, which is NOT "fewer than 5" — it is NOT New; it rates normally on
 * that single installment (e.g. paid on time → 100%, RELIABLE once the other checks pass).
 *
 * Worked examples:
 *  E. 50 due, 46 on time, maxLate 4 days, 0 days behind now → 92% → RELIABLE.
 *  F. 85% on time, nothing worse → FAIR. 65% → RISKY (rate). 95% but currentDaysBehind at the
 *     critical threshold → RISKY (the days-behind check overrides a good rate).
 *  G. 4 daily installments only → weight 4 < 5 → NEW. 1 lump-sum installment → weight 5,
 *     not New; counted as 1 installment for its own 100%/0% rate.
 *  I. Due Sat, paid Mon (no other Sunday) → 1 day late. Due Oct 5, paid Oct 7, no Sunday
 *     between → 2 days late.
 */

import { collectionDaysBetween, type PaymentType } from './loan';
import type { FlagThresholds } from './flags';

/** Tunable in one place; comments explain each number so the lender's policy can be adjusted. */
export const RELIABILITY_CONFIG = {
  /** Fewer than this many WEIGHTED due installments → not enough history to rate (New). */
  minCountedInstallments: 5,
  /** Only the most recent N due installments count, so old behaviour doesn't haunt forever. */
  maxHistoryInstallments: 60,
  /** A single lump-sum installment stands in for this many daily ones, for the New check only. */
  lumpSumHistoryWeight: 5,
  /** On-time rate below this → Risky. */
  riskyOnTimeRateBelow: 0.7,
  /** Any installment this many collection days late (or more) → Risky. */
  riskyMaxLateDaysAtLeast: 14,
  /** On-time rate at or above this (with the other Reliable checks) → Reliable. */
  reliableOnTimeRateAtLeast: 0.9,
  /** Worst lateness at or under this (with the other Reliable checks) → Reliable. */
  reliableMaxLateDaysAtMost: 5,
} as const;

export type ReliabilityTier = 'new' | 'reliable' | 'fair' | 'risky';

export interface ReliabilityInstallment {
  paymentType: PaymentType;
  /** The LOAN's skip_sundays (collection-day counting). */
  skipSundays: boolean;
  originalDueDate: string;
  /** null = not yet fully paid (active allocations only; voided payments are never allocated). */
  completionDate: string | null;
}

export interface ReliabilityResult {
  tier: ReliabilityTier;
  /** null while New (not enough data to rate). */
  onTimeRate: number | null;
  onTimeCount: number;
  /** Plain count (1 per installment, daily or lump sum) — the percentage's denominator. */
  countedInstallments: number;
  maxLateDays: number;
  currentDaysBehind: number;
  completedLoans: number;
  /** Short, human-readable lines for "Why this rating" (empty while New). */
  reasons: string[];
}

function lateDaysFor(row: ReliabilityInstallment, today: string): number {
  const end = row.completionDate ?? (row.originalDueDate < today ? today : row.originalDueDate);
  return end <= row.originalDueDate ? 0 : collectionDaysBetween(row.originalDueDate, end, row.skipSundays);
}

function buildReasons(
  onTimeRate: number,
  onTimeCount: number,
  countedInstallments: number,
  maxLateDays: number,
  currentDaysBehind: number,
  completedLoans: number,
): string[] {
  const reasons: string[] = [];
  reasons.push(`${Math.round(onTimeRate * 100)}% paid on time (${onTimeCount} of ${countedInstallments})`);
  reasons.push(maxLateDays === 0 ? 'Always paid on time' : `Longest delay: ${maxLateDays} days`);
  if (currentDaysBehind > 0) reasons.push(`Now ${currentDaysBehind} days behind`);
  if (completedLoans > 0) {
    reasons.push(`${completedLoans} loan${completedLoans === 1 ? '' : 's'} completed`);
  }
  return reasons;
}

/**
 * `installments` must already be the borrower's latest `maxHistoryInstallments` due rows (the
 * data layer enforces the limit with a window function); this function doesn't re-trim them.
 */
export function computeReliability(
  installments: ReliabilityInstallment[],
  completedLoans: number,
  currentDaysBehind: number,
  thresholds: FlagThresholds,
  today: string,
): ReliabilityResult {
  const cfg = RELIABILITY_CONFIG;
  const historyWeight = installments.reduce(
    (sum, row) => sum + (row.paymentType === 'lump_sum' ? cfg.lumpSumHistoryWeight : 1),
    0,
  );

  if (historyWeight < cfg.minCountedInstallments) {
    return {
      tier: 'new',
      onTimeRate: null,
      onTimeCount: 0,
      countedInstallments: installments.length,
      maxLateDays: 0,
      currentDaysBehind,
      completedLoans,
      reasons: [],
    };
  }

  let onTimeCount = 0;
  let maxLateDays = 0;
  for (const row of installments) {
    const late = lateDaysFor(row, today);
    if (late === 0) onTimeCount++;
    if (late > maxLateDays) maxLateDays = late;
  }
  const countedInstallments = installments.length;
  const onTimeRate = countedInstallments > 0 ? onTimeCount / countedInstallments : 0;

  let tier: ReliabilityTier;
  if (
    onTimeRate < cfg.riskyOnTimeRateBelow ||
    currentDaysBehind >= thresholds.criticalAfter ||
    maxLateDays >= cfg.riskyMaxLateDaysAtLeast
  ) {
    tier = 'risky';
  } else if (
    onTimeRate >= cfg.reliableOnTimeRateAtLeast &&
    currentDaysBehind < thresholds.flagAfter &&
    maxLateDays <= cfg.reliableMaxLateDaysAtMost
  ) {
    tier = 'reliable';
  } else {
    tier = 'fair';
  }

  return {
    tier,
    onTimeRate,
    onTimeCount,
    countedInstallments,
    maxLateDays,
    currentDaysBehind,
    completedLoans,
    reasons: buildReasons(
      onTimeRate,
      onTimeCount,
      countedInstallments,
      maxLateDays,
      currentDaysBehind,
      completedLoans,
    ),
  };
}
