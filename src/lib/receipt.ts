/**
 * Pure payment-receipt logic: no database, no React. Money = integer centavos, dates = local
 * 'YYYY-MM-DD'. Everything that depends on "today"/"as of" is passed in, so it is testable.
 *
 * Worked examples (loan ₱6,000 total, 40 daily × ₱150):
 *  A. 25 active payments already total ₱3,750 (totalPaidBefore). A new ₱150 payment is allocated
 *     to one missed installment (original_due_date < paid_on). computeAppliedBreakdown returns
 *     one 'missed' line of ₱150/1 day. computeBalanceAsOfPayment with
 *     totalPaidUpToAndIncluding = 3750 + 150 = 3900 gives { totalPaid: 3900, balance: 2100 }.
 *  F. Before settling, balance is ₱2,250 (totalPayable - totalPaidBefore = 2250). The settlement
 *     pays ₱1,950 and forgives a ₱300 discount (1950 + 300 = 2250). With
 *     totalPaidUpToAndIncluding = totalPayable - 300 and isActiveSettlement = true, the discount
 *     is subtracted too: balance = totalPayable - (totalPayable - 300) - 300 = 0.
 *  Netted settlement (renewal): same maths as F, but `kind` is 'settlementNetted' so the UI/text
 *  states plainly that no cash was received (the amount was deducted from the new loan instead).
 */

import { formatDisplayDate } from './loan';
import { formatPeso } from './money';

import { t } from '@/i18n';

export type ReceiptKind = 'regular' | 'settlement' | 'settlementNetted';

export type AppliedBucket = 'missed' | 'current' | 'advance';

export interface AppliedBreakdownLine {
  bucket: AppliedBucket;
  /** Centavos applied to installments in this bucket. */
  amount: number;
  /** Number of installments (collection days) in this bucket. */
  days: number;
}

export interface ReceiptAllocationInput {
  /** The covered installment's original_due_date (never shifted), 'YYYY-MM-DD'. */
  originalDueDate: string;
  amount: number;
}

export interface ReceiptData {
  receiptNo: string;
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
  /** 'YYYY-MM-DD' */
  paidOn: string;
  borrowerName: string;
  loanId: number;
  loanPrincipal: number;
  amountReceived: number;
  kind: ReceiptKind;
  /** Non-zero buckets only, in missed → current → advance order. */
  applied: AppliedBreakdownLine[];
  /** Cumulative active-payment total for this loan, up to and including this payment. */
  totalPaid: number;
  /** As of this payment's date (not today). */
  balance: number;
  /** > 0 only when this payment is the active settlement that closed the loan with a discount. */
  discountAmount: number;
}

export interface ReceiptSettings {
  /** Max 100 characters; shown as-is (already trimmed) or null for none. */
  footerNote: string | null;
  showBalance: boolean;
}

/** "R-000123" from a payment id. Never truncates: ids above 999999 just get more digits. */
export function receiptNumber(paymentId: number): string {
  return `R-${String(paymentId).padStart(6, '0')}`;
}

/**
 * Settings → Receipts & statements → Preview, when there isn't a single real payment yet.
 * businessName/businessPhone/businessAddress are overwritten by the caller with the real
 * profile/settings; only the payment-shaped numbers here are made up.
 */
export function sampleReceiptData(businessName: string): ReceiptData {
  return {
    receiptNo: receiptNumber(123),
    businessName,
    businessPhone: null,
    businessAddress: null,
    paidOn: '2026-01-05',
    borrowerName: 'Juan Dela Cruz',
    loanId: 45,
    loanPrincipal: 600000,
    amountReceived: 15000,
    kind: 'regular',
    applied: [
      { bucket: 'missed', amount: 15000, days: 1 },
    ],
    totalPaid: 375000,
    balance: 225000,
    discountAmount: 0,
  };
}

const BUCKET_ORDER: AppliedBucket[] = ['missed', 'current', 'advance'];

/**
 * Groups one payment's allocations by whether the installment they covered was overdue
 * (missed, original_due_date < paidOn), due that same day (current), or not yet due (advance).
 * Only non-zero buckets are returned, in missed → current → advance order.
 */
export function computeAppliedBreakdown(
  allocations: ReceiptAllocationInput[],
  paidOn: string,
): AppliedBreakdownLine[] {
  const totals: Record<AppliedBucket, { amount: number; days: number }> = {
    missed: { amount: 0, days: 0 },
    current: { amount: 0, days: 0 },
    advance: { amount: 0, days: 0 },
  };
  for (const a of allocations) {
    const bucket: AppliedBucket =
      a.originalDueDate < paidOn ? 'missed' : a.originalDueDate > paidOn ? 'advance' : 'current';
    totals[bucket].amount += a.amount;
    totals[bucket].days += 1;
  }
  return BUCKET_ORDER.map((bucket) => ({ bucket, ...totals[bucket] })).filter(
    (line) => line.amount > 0,
  );
}

/**
 * Balance AS OF this payment (not today): total_payable minus every active payment's allocations
 * for this loan up to and including this one, ordered by (paid_on, then id) — the same ordering
 * `computeLoanState` uses. For the active settlement that closed the loan, the discount is
 * subtracted too, so the balance lands on exactly ₱0.
 */
export function computeBalanceAsOfPayment(params: {
  totalPayable: number;
  totalPaidUpToAndIncluding: number;
  isActiveSettlement: boolean;
  discountAmount: number;
}): { totalPaid: number; balance: number } {
  const totalPaid = params.totalPaidUpToAndIncluding;
  const discount = params.isActiveSettlement ? params.discountAmount : 0;
  const balance = Math.max(0, params.totalPayable - totalPaid - discount);
  return { totalPaid, balance };
}

/** Shared by the receipt text builder and the receipt image component (ReceiptView). */
export function appliedLineText(line: AppliedBreakdownLine): string {
  const amount = formatPeso(line.amount);
  if (line.bucket === 'current') return t('receipts.appliedCurrent', { amount });
  if (line.bucket === 'missed') {
    return line.days === 1
      ? t('receipts.appliedMissedOne', { amount })
      : t('receipts.appliedMissedMany', { amount, count: line.days });
  }
  return line.days === 1
    ? t('receipts.appliedAdvanceOne', { amount })
    : t('receipts.appliedAdvanceMany', { amount, count: line.days });
}

/** Compact plain-text receipt for SMS/Messenger ("Copy as text" / "Share as text"). */
export function buildReceiptText(data: ReceiptData, settings: ReceiptSettings): string {
  const lines: string[] = [];
  lines.push(t('receipts.title'));
  lines.push(t('receipts.subtitle'));
  lines.push('');
  lines.push(data.businessName);
  if (data.businessPhone) lines.push(data.businessPhone);
  if (data.businessAddress) lines.push(data.businessAddress);
  lines.push('');
  lines.push(`${t('receipts.receiptNoLabel')} ${data.receiptNo}`);
  lines.push(`${t('receipts.dateLabel')}: ${formatDisplayDate(data.paidOn)}`);
  lines.push(`${t('receipts.borrowerLabel')}: ${data.borrowerName}`);
  lines.push(
    `${t('receipts.loanLabel', { number: data.loanId })} · ${t('receipts.principalLabel', {
      amount: formatPeso(data.loanPrincipal),
    })}`,
  );
  lines.push('');
  lines.push(`${t('receipts.amountReceived')}: ${formatPeso(data.amountReceived)}`);
  lines.push(
    data.kind === 'regular'
      ? t('receipts.kindRegular')
      : data.kind === 'settlement'
        ? t('receipts.kindSettlement')
        : t('receipts.kindNetted'),
  );

  if (data.applied.length > 0) {
    lines.push('');
    lines.push(`${t('receipts.appliedTitle')}:`);
    for (const line of data.applied) lines.push(`  ${appliedLineText(line)}`);
  }
  if (data.discountAmount > 0) {
    lines.push(`  ${t('receipts.discountLine', { amount: formatPeso(data.discountAmount) })}`);
  }

  if (settings.showBalance) {
    lines.push('');
    lines.push(`${t('receipts.totalPaidSoFar')}: ${formatPeso(data.totalPaid)}`);
    lines.push(`${t('receipts.balanceAfter')}: ${formatPeso(data.balance)}`);
    lines.push(t('receipts.balanceAsOf', { date: formatDisplayDate(data.paidOn) }));
  }

  if (settings.footerNote) {
    lines.push('');
    lines.push(settings.footerNote);
  }

  return lines.join('\n');
}
