/**
 * Pure End of Day report logic: no database, no React. Money = integer centavos, dates = local
 * 'YYYY-MM-DD'. The screen (src/app/eod.tsx) assembles an EodReportData from several existing
 * db modules (src/db/cash.ts, cash-collected.ts, reports.ts, flags.ts, eod.ts) and passes it
 * here to build the shareable text, or to src/components/eod/EodView.tsx for the image.
 *
 * Worked examples (see Phase 17 spec, scenarios A-D):
 *  A. Payments ₱150 (due that day), ₱300 (₱150 recovers Oct 5 + ₱150 due that day), ₱450 (₱150
 *     due that day + ₱300 advance) → appliedBreakdown: due 450, recovered 150, advance 300; they
 *     sum to cashCollected (900) because every regular-payment allocation lands in one bucket.
 *  C. Cash lines: opening 20,000; +collected 3,000; -released 5,000; -withdrawals 500;
 *     -expenses 100 → closing 17,400 (computeCashOnHand over the SAME CashParts shape the Cash
 *     screen uses — see buildCashLines).
 *  D. "Missed that day" is driven by src/db/eod.ts getMissedThatDay, which reconstructs the day
 *     from payment_allocations (paid_on <= date) instead of trusting today's cached installment
 *     status — so voiding a payment or a later recovery changes only the days actually affected.
 */

import { addEntryToParts, computeCashOnHand, EMPTY_PARTS, type CashParts, type LedgerDay } from './cash';
import { formatFullDate, formatTime } from './date';
import { formatDisplayDate } from './loan';
import { formatPeso } from './money';
import type { AppliedBreakdownLine } from './receipt';

import { t } from '@/i18n';

export function isFutureDate(date: string, today: string): boolean {
  return date > today;
}

// ───────────────────────── Cash reconciliation ─────────────────────────

export interface CashLines {
  opening: number;
  parts: CashParts;
  closingExpected: number;
  expensesByCategory: { category: string; amount: number }[];
}

/**
 * Builds ONE day's reconciliation lines from its LedgerDay (src/db/cash.ts getCashLedger for a
 * fromDate=toDate=date range) — the exact same balanceBefore/items the Cash screen itself reads,
 * so "the closing equals the Cash screen's cash on hand for that date" holds by construction.
 */
export function buildCashLines(balanceBefore: number, day: LedgerDay | undefined): CashLines {
  let parts: CashParts = { ...EMPTY_PARTS };
  const expenseCategories = new Map<string, number>();
  if (day) {
    parts.collected = day.collected;
    for (const item of day.items) {
      if (item.type === 'release') parts.released += item.release.amount;
      else if (item.type === 'entry' && item.entry.status === 'active') {
        parts = addEntryToParts(parts, item.entry);
        if (item.entry.kind === 'expense') {
          const key = item.entry.category ?? 'other';
          expenseCategories.set(key, (expenseCategories.get(key) ?? 0) + item.entry.amount);
        }
      }
    }
  }
  return {
    opening: balanceBefore,
    parts,
    closingExpected: balanceBefore + computeCashOnHand(parts),
    expensesByCategory: [...expenseCategories.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ───────────────────────── Borrower name lists ─────────────────────────

export interface NameAmount {
  name: string;
  amount: number;
}

export interface LimitedList {
  shown: NameAmount[];
  moreCount: number;
}

/** First `max` entries (already sorted by the caller) + how many more exist. */
export function limitNames(list: NameAmount[], max: number): LimitedList {
  return { shown: list.slice(0, max), moreCount: Math.max(0, list.length - max) };
}

export const MAX_NAMES_IN_IMAGE = 30;

// ───────────────────────── Report data shape ─────────────────────────

export interface EodReportData {
  date: string;
  generatedAt: Date;
  businessName: string;
  collection: {
    cashCollected: number;
    paymentCount: number;
    distinctBorrowers: number;
    appliedBreakdown: AppliedBreakdownLine[];
    earlyPayoffCount: number;
    earlyPayoffAmount: number;
    discountGiven: number;
    nettedCount: number;
    nettedAmount: number;
    missedLoanCount: number;
    missedAmount: number;
  };
  newLoans: {
    count: number;
    principal: number;
    cashReleased: number;
  };
  cash:
    | { available: false; reason: 'notSetUp' | 'beforeStart' }
    | ({ available: true } & CashLines);
  counted: {
    /** null = not entered for this date. */
    amount: number | null;
  };
  /** null = toggle is off. */
  profit: { interestEarned: number; principalReturned: number; netOfExpenses: number } | null;
  /** null = not today (the spec: Attention is a live number, today only). */
  flaggedCount: number | null;
  /** null = toggle is off. */
  borrowerLists: { paid: NameAmount[]; missed: NameAmount[] } | null;
}

/** No payments, no new loans, no cash movement that day — the friendly empty state. */
export function hasNoActivity(data: EodReportData): boolean {
  const cashMoved =
    data.cash.available &&
    (data.cash.parts.collected > 0 ||
      data.cash.parts.released > 0 ||
      data.cash.parts.withdrawals > 0 ||
      data.cash.parts.expenses > 0 ||
      data.cash.parts.capitalIn > 0 ||
      data.cash.parts.adjustmentsIn > 0 ||
      data.cash.parts.adjustmentsOut > 0);
  return (
    data.collection.cashCollected === 0 &&
    data.collection.earlyPayoffAmount === 0 &&
    data.collection.nettedAmount === 0 &&
    data.collection.missedLoanCount === 0 &&
    data.newLoans.count === 0 &&
    !cashMoved
  );
}

function appliedLineLabel(line: AppliedBreakdownLine): string {
  if (line.bucket === 'current') return t('eod.appliedDue');
  if (line.bucket === 'missed') return t('eod.appliedRecovered');
  return t('eod.appliedAdvance');
}

/** Compact plain-text report for SMS/Messenger ("Share as text" / "Copy text"). */
export function buildEodText(data: EodReportData): string {
  const lines: string[] = [];
  lines.push(t('eod.title'));
  lines.push(data.businessName);
  lines.push(formatDisplayDate(data.date));
  lines.push('');

  const c = data.collection;
  lines.push(`${t('eod.collectionSection')}`);
  lines.push(`  ${t('eod.cashCollected')}: ${formatPeso(c.cashCollected)}`);
  lines.push(`  ${t('eod.paymentsCount', { count: c.paymentCount, borrowers: c.distinctBorrowers })}`);
  for (const line of c.appliedBreakdown) {
    lines.push(`    ${appliedLineLabel(line)}: ${formatPeso(line.amount)}`);
  }
  if (c.earlyPayoffCount > 0) {
    lines.push(
      `  ${t('eod.earlyPayoffs', { count: c.earlyPayoffCount, amount: formatPeso(c.earlyPayoffAmount) })}`,
    );
    if (c.discountGiven > 0) lines.push(`    ${t('eod.discountGiven')}: ${formatPeso(c.discountGiven)}`);
  }
  if (c.nettedCount > 0) {
    lines.push(
      `  ${t('eod.appliedToRenewals', { count: c.nettedCount, amount: formatPeso(c.nettedAmount) })}`,
    );
  }
  lines.push(
    c.missedLoanCount > 0
      ? `  ${t('eod.missedThatDay', { count: c.missedLoanCount, amount: formatPeso(c.missedAmount) })}`
      : `  ${t('eod.missedNone')}`,
  );

  lines.push('');
  lines.push(t('eod.newLoansSection'));
  lines.push(
    data.newLoans.count > 0
      ? `  ${t('eod.newLoansLine', {
          count: data.newLoans.count,
          principal: formatPeso(data.newLoans.principal),
          released: formatPeso(data.newLoans.cashReleased),
        })}`
      : `  ${t('eod.newLoansNone')}`,
  );

  if (data.cash.available) {
    lines.push('');
    lines.push(t('eod.cashSection'));
    lines.push(`  ${t('eod.cashOpening')}: ${formatPeso(data.cash.opening)}`);
    lines.push(`  + ${t('eod.cashCollected')}: ${formatPeso(data.cash.parts.collected)}`);
    if (data.cash.parts.capitalIn > 0) {
      lines.push(`  + ${t('eod.cashCapitalIn')}: ${formatPeso(data.cash.parts.capitalIn)}`);
    }
    lines.push(`  − ${t('eod.cashReleased')}: ${formatPeso(data.cash.parts.released)}`);
    lines.push(`  − ${t('eod.cashWithdrawals')}: ${formatPeso(data.cash.parts.withdrawals)}`);
    for (const e of data.cash.expensesByCategory) {
      lines.push(`  − ${t('eod.cashExpenseCategory', { category: e.category })}: ${formatPeso(e.amount)}`);
    }
    if (data.cash.parts.adjustmentsIn > 0 || data.cash.parts.adjustmentsOut > 0) {
      const net = data.cash.parts.adjustmentsIn - data.cash.parts.adjustmentsOut;
      lines.push(`  ${net >= 0 ? '+' : '−'} ${t('eod.cashAdjustments')}: ${formatPeso(Math.abs(net))}`);
    }
    lines.push(`  = ${t('eod.cashClosing')}: ${formatPeso(data.cash.closingExpected)}`);
    if (data.counted.amount !== null) {
      const diff = data.counted.amount - data.cash.closingExpected;
      lines.push(`  ${t('eod.cashCounted')}: ${formatPeso(data.counted.amount)}`);
      lines.push(
        `  ${
          diff === 0
            ? t('eod.cashMatches')
            : diff > 0
              ? t('eod.cashOver', { amount: formatPeso(diff) })
              : t('eod.cashShort', { amount: formatPeso(-diff) })
        }`,
      );
    }
  } else {
    lines.push('');
    lines.push(
      data.cash.reason === 'notSetUp' ? t('eod.cashNotSetUp') : t('eod.cashBeforeStart'),
    );
  }

  if (data.profit) {
    lines.push('');
    lines.push(t('eod.profitSection'));
    lines.push(`  ${t('eod.profitInterest')}: ${formatPeso(data.profit.interestEarned)}`);
    lines.push(`  ${t('eod.profitPrincipal')}: ${formatPeso(data.profit.principalReturned)}`);
    lines.push(`  ${t('eod.profitNet')}: ${formatPeso(data.profit.netOfExpenses)}`);
  }

  if (data.flaggedCount !== null) {
    lines.push('');
    lines.push(
      data.flaggedCount === 0
        ? t('eod.attentionNone')
        : t('eod.attentionCount', { count: data.flaggedCount }),
    );
  }

  if (data.borrowerLists) {
    if (data.borrowerLists.paid.length > 0) {
      lines.push('');
      lines.push(t('eod.paidListTitle'));
      for (const p of data.borrowerLists.paid) lines.push(`  ${p.name} — ${formatPeso(p.amount)}`);
    }
    if (data.borrowerLists.missed.length > 0) {
      lines.push('');
      lines.push(t('eod.missedListTitle'));
      for (const m of data.borrowerLists.missed) lines.push(`  ${m.name} — ${formatPeso(m.amount)}`);
    }
  }

  lines.push('');
  lines.push(
    t('eod.generatedAt', {
      when: `${formatFullDate(data.generatedAt)}, ${formatTime(data.generatedAt)}`,
    }),
  );
  return lines.join('\n');
}
