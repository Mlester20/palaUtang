import type { SQLiteDatabase } from 'expo-sqlite';

import { computeLoanState } from '@/lib/payments';
import {
  computeRenewal,
  computeSettlement,
  validateSettlementDate,
  type SettlementDateError,
  type SettlementError as SettlementCalcError,
  type SettlementResult,
} from '@/lib/settlement';
import type { CreateLoanInput, SettlementMode } from '@/types/loan';

import { insertLoanWithSchedule } from './loans';
import { loadLoanForCalc, recomputeInTransaction, type LoadedLoan } from './payments';
import { writeTransaction } from './transaction';

export type SettleErrorCode =
  'notFound' | 'dateInvalid' | 'amountInvalid' | 'stale' | 'principalBelowSettlement';

/** Why a settlement couldn't be saved (codes are i18n-able in the UI). */
export class SettleError extends Error {
  readonly code: SettleErrorCode;
  readonly dateErrors: SettlementDateError[];
  readonly amountErrors: SettlementCalcError[];
  constructor(
    code: SettleErrorCode,
    details: { dateErrors?: SettlementDateError[]; amountErrors?: SettlementCalcError[] } = {},
  ) {
    super(`Settlement rejected: ${code}`);
    this.name = 'SettleError';
    this.code = code;
    this.dateErrors = details.dateErrors ?? [];
    this.amountErrors = details.amountErrors ?? [];
  }
}

export interface SettlementOptions {
  loanId: number;
  settlementDate: string;
  mode: SettlementMode;
  /** Discount mode only, centavos. */
  discount?: number;
  note?: string | null;
}

export interface SettlementLine {
  installmentId: number;
  installmentNumber: number;
  dueDate: string;
  isMakeup: boolean;
  amount: number;
}

export interface SettlementPreview extends SettlementResult {
  totalPaid: number;
  latestPaymentDate: string | null;
  dateErrors: SettlementDateError[];
  /** Installments the settlement money pays (oldest first). */
  covered: SettlementLine[];
  /** Installments (or parts) that would be forgiven. */
  waived: SettlementLine[];
}

function settlementFor(data: LoadedLoan, options: SettlementOptions, today: string) {
  const totalPaid = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const latestPaymentDate = data.payments.reduce<string | null>(
    (max, p) => (max === null || p.paidOn > max ? p.paidOn : max),
    null,
  );
  const result = computeSettlement({
    loan: data.loan,
    installments: data.installments,
    totalPaid,
    settlementDate: options.settlementDate,
    mode: options.mode,
    discount: options.discount,
  });
  const dateErrors = validateSettlementDate(
    data.loan,
    options.settlementDate,
    latestPaymentDate,
    today,
  );
  return { totalPaid, latestPaymentDate, result, dateErrors };
}

/** What settling would do (amount, covered and waived installments). Saves nothing. */
export async function previewSettlement(
  db: SQLiteDatabase,
  options: SettlementOptions,
  today: string,
): Promise<SettlementPreview | null> {
  const data = await loadLoanForCalc(db, options.loanId);
  if (!data) return null;
  const { totalPaid, latestPaymentDate, result, dateErrors } = settlementFor(data, options, today);

  const covered: SettlementLine[] = [];
  const waived: SettlementLine[] = [];
  if (result.settlementAmount > 0) {
    const before = computeLoanState(data.loan, data.installments, data.payments, today);
    const after = computeLoanState(
      data.loan,
      data.installments,
      [
        ...data.payments,
        {
          id: -1,
          amount: result.settlementAmount,
          paidOn: options.settlementDate,
          type: 'settlement',
        },
      ],
      today,
    );
    const paidBefore = new Map(before.installments.map((i) => [i.id, i.amountPaid]));
    for (const row of after.installments) {
      if (row.id === null) continue;
      const line = {
        installmentId: row.id,
        installmentNumber: row.installmentNumber,
        dueDate: row.dueDate,
        isMakeup: row.isMakeup,
      };
      const added = row.amountPaid - (paidBefore.get(row.id) ?? 0);
      if (added > 0) covered.push({ ...line, amount: added });
      if (row.waivedAmount > 0) waived.push({ ...line, amount: row.waivedAmount });
    }
  }
  return { ...result, totalPaid, latestPaymentDate, dateErrors, covered, waived };
}

/**
 * The settlement itself; must run inside a write transaction. Re-validates against the CURRENT
 * data (the preview may be stale) and, if `expectedAmount` is given, fails with 'stale' when the
 * amount changed. Returns the settlement payment id and amount.
 */
async function settleInTransaction(
  db: SQLiteDatabase,
  options: SettlementOptions,
  today: string,
  isNetted: boolean,
  expectedAmount: number | undefined,
) {
  const data = await loadLoanForCalc(db, options.loanId);
  if (!data) throw new SettleError('notFound');
  const { result, dateErrors } = settlementFor(data, options, today);
  if (dateErrors.length > 0) throw new SettleError('dateInvalid', { dateErrors });
  if (result.errors.length > 0 || result.settlementAmount < 1) {
    throw new SettleError('amountInvalid', { amountErrors: result.errors });
  }
  if (expectedAmount !== undefined && expectedAmount !== result.settlementAmount) {
    throw new SettleError('stale');
  }

  // The unique partial index allows only one active settlement per loan, so a double tap
  // fails here even if two saves were queued.
  const payment = await db.runAsync(
    `INSERT INTO payments (loan_id, amount, paid_on, note, status, type, is_netted, created_at)
     VALUES (?, ?, ?, ?, 'active', 'settlement', ?, ?)`,
    [
      options.loanId,
      result.settlementAmount,
      options.settlementDate,
      options.note?.trim() || null,
      isNetted ? 1 : 0,
      new Date().toISOString(),
    ],
  );
  await db.runAsync('UPDATE loans SET settlement_mode = ?, closed_reason = ? WHERE id = ?', [
    options.mode,
    options.note?.trim() || null,
    options.loanId,
  ]);
  // Allocates the settlement, waives the rest, and closes the loan (status, closed_at, discount).
  const state = await recomputeInTransaction(db, options.loanId, today);
  if (state?.status !== 'closed_early') throw new Error('The loan could not be closed.');

  return { paymentId: payment.lastInsertRowId, settlementAmount: result.settlementAmount };
}

/** Settles (closes early) a loan in ONE transaction. */
export function settleLoan(
  db: SQLiteDatabase,
  options: SettlementOptions & { expectedAmount?: number },
  today: string,
) {
  return writeTransaction(db, () =>
    settleInTransaction(db, options, today, false, options.expectedAmount),
  );
}

export type RenewalLoanInput = Omit<CreateLoanInput, 'borrowerId' | 'renewedFromLoanId'>;

/**
 * Settles the old loan with a NETTED settlement (deducted from the new principal; no cash) and
 * creates the renewal loan, all in ONE transaction: if anything fails, nothing is saved.
 */
export function settleAndRenew(
  db: SQLiteDatabase,
  options: SettlementOptions & { expectedAmount?: number },
  newLoan: RenewalLoanInput,
  today: string,
): Promise<{ newLoanId: number; settlementAmount: number; cashToRelease: number }> {
  return writeTransaction(db, async () => {
    const old = await db.getFirstAsync<{ borrower_id: number }>(
      'SELECT borrower_id FROM loans WHERE id = ?',
      [options.loanId],
    );
    if (!old) throw new SettleError('notFound');

    const { settlementAmount } = await settleInTransaction(
      db,
      options,
      today,
      true,
      options.expectedAmount,
    );
    const renewal = computeRenewal({ settlementAmount, newPrincipal: newLoan.principal });
    if (renewal.error) throw new SettleError('principalBelowSettlement');

    const newLoanId = await insertLoanWithSchedule(db, {
      ...newLoan,
      borrowerId: old.borrower_id,
      renewedFromLoanId: options.loanId,
    });
    return { newLoanId, settlementAmount, cashToRelease: renewal.cashToRelease };
  });
}
