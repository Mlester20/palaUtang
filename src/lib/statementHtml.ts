/**
 * Pure HTML builder for the borrower/loan statement PDF: no React, no database. Every
 * user-provided string (names, notes, business name/address) is escaped so `< > & " '` can
 * never break or inject markup into the printed document. Inline CSS only, system fonts, no
 * external resources (required so expo-print can render it standalone, no network needed).
 *
 * Pagination: `thead` repeats via `display: table-header-group`; every `tr` has
 * `page-break-inside: avoid` so a row is never split across pages; a loan's own header block
 * (name/dates/amounts) also avoids breaking, but the payment/schedule TABLES are left free to
 * paginate normally — wrapping a whole 80-row table in "avoid" would force it onto one giant
 * page instead of flowing across many, which is the opposite of what "paginates cleanly" means
 * for a long statement.
 */

import { formatDisplayDate } from './loan';
import { formatPeso } from './money';

import { t } from '@/i18n';
import type { InstallmentStatus, LoanStatus, LoanSummary, PaymentKind } from '@/types/loan';

export type PaperSize = 'A4' | 'Letter';

/** Points at 72 DPI, matching Print.printToFileAsync's width/height options. */
export function paperSizeDimensions(size: PaperSize): { width: number; height: number } {
  return size === 'A4' ? { width: 595, height: 842 } : { width: 612, height: 792 };
}

export type StatementScope = { borrowerId: number } | { loanId: number };

export interface StatementOptions {
  includePayments: boolean;
  includeSchedule: boolean;
  showInterest: boolean;
  /** Filters ONLY the payment list below; the summary is always as of today. */
  paymentsFromDate: string | null;
  paperSize: PaperSize;
}

export interface StatementPaymentRow {
  loanId: number;
  amount: number;
  paidOn: string;
  type: PaymentKind;
  isNetted: boolean;
  /** Same rule as the receipt: total_payable − cumulative active allocations (− discount
   *  for the settlement that closed the loan), as of this payment. */
  balanceAfter: number;
}

export interface StatementInstallmentRow {
  loanId: number;
  installmentNumber: number;
  originalDueDate: string;
  amountDue: number;
  amountPaid: number;
  status: InstallmentStatus;
  isMakeup: boolean;
}

export interface StatementData {
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
  borrowerName: string;
  borrowerPhone: string | null;
  /** Already excludes cancelled loans; empty means nothing to print. */
  loans: LoanSummary[];
  /** Sum of each active loan's current overdue amount (0 if none, or not requested). */
  overdueAmount: number;
  /** Populated only when options.includePayments; newest-last within each loan. */
  payments: StatementPaymentRow[];
  /** Populated only when options.includeSchedule. */
  installments: StatementInstallmentRow[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_LABEL: Record<LoanStatus, () => string> = {
  active: () => t('statements.statusActive'),
  completed: () => t('statements.statusCompleted'),
  closed_early: () => t('statements.statusClosedEarly'),
  cancelled: () => t('statements.statusActive'), // never reached: cancelled loans are filtered out
};

const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  pending: 'pending',
  paid: 'paid',
  partial: 'partial',
  missed: 'missed',
  skipped: 'skipped',
  settled: 'settled',
};

function loanBalance(loan: LoanSummary): number {
  return Math.max(0, loan.totalPayable - loan.amountPaid - loan.discountAmount);
}

function renderPaymentsTable(rows: StatementPaymentRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(formatDisplayDate(p.paidOn))}</td>
        <td class="right">${escapeHtml(formatPeso(p.amount))}</td>
        <td>${escapeHtml(
          p.type === 'regular'
            ? t('receipts.kindRegular')
            : p.isNetted
              ? t('receipts.kindNetted')
              : t('receipts.kindSettlement'),
        )}</td>
        <td class="right">${escapeHtml(formatPeso(p.balanceAfter))}</td>
      </tr>`,
    )
    .join('');
  return `
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(t('statements.colDate'))}</th>
          <th class="right">${escapeHtml(t('statements.colAmount'))}</th>
          <th>${escapeHtml(t('statements.colType'))}</th>
          <th class="right">${escapeHtml(t('statements.colBalance'))}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderScheduleTable(rows: StatementInstallmentRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (i) => `
      <tr>
        <td>${i.installmentNumber}${i.isMakeup ? ' *' : ''}</td>
        <td>${escapeHtml(formatDisplayDate(i.originalDueDate))}</td>
        <td class="right">${escapeHtml(formatPeso(i.amountDue))}</td>
        <td class="right">${escapeHtml(formatPeso(i.amountPaid))}</td>
        <td>${escapeHtml(INSTALLMENT_STATUS_LABEL[i.status])}</td>
      </tr>`,
    )
    .join('');
  return `
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(t('statements.colNumber'))}</th>
          <th>${escapeHtml(t('statements.colDueDate'))}</th>
          <th class="right">${escapeHtml(t('statements.colAmountDue'))}</th>
          <th class="right">${escapeHtml(t('statements.colAmountPaid'))}</th>
          <th>${escapeHtml(t('statements.colStatus'))}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderLoan(
  loan: LoanSummary,
  options: StatementOptions,
  payments: StatementPaymentRow[],
  installments: StatementInstallmentRow[],
  /** Unfiltered by "payments from date", just for finding this loan's settlement row below. */
  allPayments: StatementPaymentRow[],
): string {
  const rows: string[] = [];
  rows.push(kv(t('statements.startDate'), formatDisplayDate(loan.startDate)));
  rows.push(kv(t('statements.endDate'), formatDisplayDate(loan.endDate)));
  rows.push(
    kv(
      t('statements.paymentType'),
      loan.paymentType === 'daily' ? t('presets.daily') : t('presets.lumpSum'),
    ),
  );
  rows.push(kv(t('statements.term'), String(loan.numberOfInstallments)));
  rows.push(kv(t('statements.principalLabel'), formatPeso(loan.principal)));
  if (options.showInterest) {
    rows.push(kv(t('statements.interestAmount'), formatPeso(loan.interestAmount)));
    if (loan.interestRate !== null) {
      rows.push(kv(t('statements.interestRate'), `${loan.interestRate}%`));
    }
  }
  rows.push(kv(t('statements.totalPayable'), formatPeso(loan.totalPayable)));
  rows.push(kv(t('statements.installmentAmount'), formatPeso(loan.installmentAmount)));
  rows.push(kv(t('statements.statusLabel'), STATUS_LABEL[loan.status]()));
  rows.push(kv(t('statements.totalPaid'), formatPeso(loan.amountPaid)));
  rows.push(kv(t('statements.currentBalance'), formatPeso(loanBalance(loan))));
  if (loan.status === 'closed_early') {
    rows.push(kv(t('statements.settlementDate'), formatDisplayDate(loan.closedAt ?? loan.endDate)));
    // Only known when the payment list was loaded for this loan (its own settlement row).
    const settlementPayment = allPayments.find((p) => p.type === 'settlement');
    if (settlementPayment) {
      rows.push(kv(t('statements.settlementAmount'), formatPeso(settlementPayment.amount)));
    }
    if (loan.discountAmount > 0) {
      rows.push(kv(t('statements.discountAmount'), formatPeso(loan.discountAmount)));
    }
  }
  if (loan.renewedFromLoanId !== null) {
    rows.push(kv('', t('statements.renewedFrom', { number: loan.renewedFromLoanId })));
  }
  if (loan.renewedByLoanId !== null) {
    rows.push(kv('', t('statements.renewedAs', { number: loan.renewedByLoanId })));
  }

  const paymentsHtml =
    options.includePayments && payments.length > 0
      ? `<div class="subsection-title">${escapeHtml(t('statements.paymentListHeading'))}</div>${renderPaymentsTable(payments)}`
      : '';
  const scheduleHtml =
    options.includeSchedule && installments.length > 0
      ? `<div class="subsection-title">${escapeHtml(t('statements.scheduleHeading'))}</div>${renderScheduleTable(installments)}`
      : '';

  return `
    <div class="loan-block">
      <div class="loan-header">
        <div class="loan-title">${escapeHtml(t('statements.loanHeading', { number: loan.id }))}</div>
        ${rows.join('')}
      </div>
      ${paymentsHtml}
      ${scheduleHtml}
    </div>`;
}

function kv(label: string, value: string): string {
  return `<div class="kv"><span class="muted">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

/** Builds the full standalone HTML document for Print.printToFileAsync. */
export function buildStatementHtml(data: StatementData, options: StatementOptions, today: string): string {
  const activeLoanCount = data.loans.filter((l) => l.status === 'active').length;
  const totalBorrowed = data.loans.reduce((sum, l) => sum + l.principal, 0);
  const totalPayable = data.loans.reduce((sum, l) => sum + l.totalPayable, 0);
  const totalPaid = data.loans.reduce((sum, l) => sum + l.amountPaid, 0);
  const currentBalance = data.loans.reduce((sum, l) => sum + loanBalance(l), 0);

  const allPaymentsByLoan = new Map<number, StatementPaymentRow[]>();
  for (const p of data.payments) {
    const all = allPaymentsByLoan.get(p.loanId) ?? [];
    all.push(p);
    allPaymentsByLoan.set(p.loanId, all);
  }
  const paymentsByLoan = new Map<number, StatementPaymentRow[]>();
  for (const p of data.payments) {
    if (options.paymentsFromDate && p.paidOn < options.paymentsFromDate) continue;
    const list = paymentsByLoan.get(p.loanId) ?? [];
    list.push(p);
    paymentsByLoan.set(p.loanId, list);
  }
  const installmentsByLoan = new Map<number, StatementInstallmentRow[]>();
  for (const i of data.installments) {
    const list = installmentsByLoan.get(i.loanId) ?? [];
    list.push(i);
    installmentsByLoan.set(i.loanId, list);
  }

  const loansHtml = data.loans
    .map((loan) =>
      renderLoan(
        loan,
        options,
        paymentsByLoan.get(loan.id) ?? [],
        installmentsByLoan.get(loan.id) ?? [],
        allPaymentsByLoan.get(loan.id) ?? [],
      ),
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 28px; }
  .header { text-align: center; margin-bottom: 18px; }
  .header h1 { font-size: 17px; margin: 6px 0 2px; }
  .muted { color: #64748b; }
  .section { margin-top: 18px; page-break-inside: avoid; }
  .section-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;
    border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 8px;
  }
  .subsection-title { font-size: 11px; font-weight: 700; margin-top: 10px; margin-bottom: 4px; }
  .kv { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; }
  .loan-block { margin-top: 16px; }
  .loan-header { page-break-inside: avoid; }
  .loan-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e2e8f0; font-size: 10px; }
  th { background: #f1f5f9; }
  .right { text-align: right; }
  .footer-note { margin-top: 24px; font-size: 10px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div>${escapeHtml(data.businessName)}</div>
    ${data.businessPhone ? `<div class="muted">${escapeHtml(data.businessPhone)}</div>` : ''}
    ${data.businessAddress ? `<div class="muted">${escapeHtml(data.businessAddress)}</div>` : ''}
    <h1>${escapeHtml(t('statements.screenTitle'))}</h1>
    <div class="muted">${escapeHtml(t('statements.generatedOn', { date: formatDisplayDate(today) }))}</div>
    <div class="muted">${escapeHtml(t('statements.asOf', { date: formatDisplayDate(today) }))}</div>
    ${
      options.includePayments && options.paymentsFromDate
        ? `<div class="muted">${escapeHtml(t('statements.paymentsListedFrom', { date: formatDisplayDate(options.paymentsFromDate) }))}</div>`
        : ''
    }
  </div>

  <div class="section">
    <div class="section-title">${escapeHtml(t('statements.borrowerLabel'))}</div>
    <div class="kv"><span>${escapeHtml(data.borrowerName)}</span><span></span></div>
    ${data.borrowerPhone ? kv(t('statements.phoneLabel'), data.borrowerPhone) : ''}
  </div>

  <div class="section">
    <div class="section-title">${escapeHtml(t('statements.summaryTitle'))}</div>
    ${kv(t('statements.activeLoans'), String(activeLoanCount))}
    ${kv(t('statements.totalBorrowed'), formatPeso(totalBorrowed))}
    ${kv(t('statements.totalPayable'), formatPeso(totalPayable))}
    ${kv(t('statements.totalPaid'), formatPeso(totalPaid))}
    ${kv(t('statements.currentBalance'), formatPeso(currentBalance))}
    ${data.overdueAmount > 0 ? kv(t('statements.overdueAmount'), formatPeso(data.overdueAmount)) : ''}
  </div>

  ${loansHtml}
</body>
</html>`;
}
