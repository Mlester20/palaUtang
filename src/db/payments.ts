import type { SQLiteDatabase } from 'expo-sqlite';

import {
  computeLoanState,
  previewPayment as previewPaymentPure,
  summarizeLoan,
  validatePayment,
  type CalcInstallment,
  type CalcLoan,
  type CalcPayment,
  type LoanBalanceSummary,
  type LoanState,
  type PaymentError,
  type PaymentPreview,
} from '@/lib/payments';
import type {
  InstallmentStatus,
  LoanStatus,
  Payment,
  PaymentKind,
  PaymentStatus,
  PaymentType,
  SettlementMode,
} from '@/types/loan';

import { writeTransaction } from './transaction';

type LoanCalcRow = {
  payment_type: PaymentType;
  principal: number;
  interest_amount: number;
  total_payable: number;
  skip_sundays: number;
  status: LoanStatus;
  start_date: string;
  end_date: string;
  closed_at: string | null;
  discount_amount: number;
  settlement_mode: SettlementMode | null;
};

type InstallmentCalcRow = {
  id: number;
  installment_number: number;
  due_date: string;
  original_due_date: string;
  amount_due: number;
  amount_paid: number;
  waived_amount: number;
  status: InstallmentStatus;
  is_makeup: number;
  makeup_for_installment_id: number | null;
};

type PaymentRow = {
  id: number;
  loan_id: number;
  amount: number;
  paid_on: string;
  note: string | null;
  status: PaymentStatus;
  type: PaymentKind;
  is_netted: number;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};

/** Thrown by recordPayment; `errors` are i18n-able codes for the UI. */
export class PaymentValidationError extends Error {
  readonly errors: PaymentError[];
  constructor(errors: PaymentError[]) {
    super(`Payment rejected: ${errors.join(', ')}`);
    this.name = 'PaymentValidationError';
    this.errors = errors;
  }
}

export type VoidRule = 'voidSettlementFirst' | 'cancelRenewalFirst';

/** Thrown by voidPayment when an early-payoff rule forbids the void (i18n-able code). */
export class VoidBlockedError extends Error {
  readonly rule: VoidRule;
  constructor(rule: VoidRule) {
    super(
      rule === 'voidSettlementFirst'
        ? 'This loan was closed early. Void the settlement payment first.'
        : 'This settlement was netted into a renewal loan. Cancel the renewal loan first.',
    );
    this.name = 'VoidBlockedError';
    this.rule = rule;
  }
}

export type LoadedLoan = {
  loan: CalcLoan & {
    principal: number;
    interestAmount: number;
    endDate: string;
    closedAt: string | null;
    discountAmount: number;
    settlementMode: SettlementMode | null;
  };
  installments: CalcInstallment[];
  /** Active payments only. */
  payments: CalcPayment[];
};

/** Everything the pure payment/settlement logic needs for one loan. */
export async function loadLoanForCalc(
  db: SQLiteDatabase,
  loanId: number,
): Promise<LoadedLoan | null> {
  const loan = await db.getFirstAsync<LoanCalcRow>(
    `SELECT payment_type, principal, interest_amount, total_payable, skip_sundays, status,
            start_date, end_date, closed_at, discount_amount, settlement_mode
     FROM loans WHERE id = ?`,
    [loanId],
  );
  if (!loan) return null;
  const rows = await db.getAllAsync<InstallmentCalcRow>(
    `SELECT id, installment_number, due_date, original_due_date, amount_due, amount_paid,
            waived_amount, status, is_makeup, makeup_for_installment_id
     FROM installments WHERE loan_id = ?`,
    [loanId],
  );
  const payments = await db.getAllAsync<{
    id: number;
    amount: number;
    paid_on: string;
    type: PaymentKind;
  }>("SELECT id, amount, paid_on, type FROM payments WHERE loan_id = ? AND status = 'active'", [
    loanId,
  ]);
  return {
    loan: {
      paymentType: loan.payment_type,
      principal: loan.principal,
      interestAmount: loan.interest_amount,
      totalPayable: loan.total_payable,
      skipSundays: loan.skip_sundays === 1,
      status: loan.status,
      startDate: loan.start_date,
      endDate: loan.end_date,
      closedAt: loan.closed_at,
      discountAmount: loan.discount_amount,
      settlementMode: loan.settlement_mode,
    },
    installments: rows.map((r) => ({
      id: r.id,
      installmentNumber: r.installment_number,
      dueDate: r.due_date,
      originalDueDate: r.original_due_date,
      amountDue: r.amount_due,
      amountPaid: r.amount_paid,
      waivedAmount: r.waived_amount,
      status: r.status,
      isMakeup: r.is_makeup === 1,
      makeupForInstallmentId: r.makeup_for_installment_id,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      paidOn: p.paid_on,
      type: p.type,
    })),
  };
}

const allocationKey = (a: { paymentId: number; installmentId: number; amount: number }) =>
  `${a.paymentId}:${a.installmentId}:${a.amount}`;

/**
 * Rebuilds the cache (installment amount_paid/waived_amount/status, make-up rows, allocations,
 * loan end date, status, closed fields and discount) from the active payments. Writes only what
 * differs, so a second run changes nothing. Must be called inside a write transaction.
 *  - closed_early with an active settlement: stays closed (settled rows, no balda/make-ups).
 *  - closed_early whose settlement was voided: reopens (closed_*, mode, discount cleared).
 */
export async function recomputeInTransaction(
  db: SQLiteDatabase,
  loanId: number,
  today: string,
): Promise<LoanState | null> {
  const data = await loadLoanForCalc(db, loanId);
  if (!data) return null;
  // Cancelled loans are frozen as they were.
  if (data.loan.status === 'cancelled') return null;

  const state = computeLoanState(data.loan, data.installments, data.payments, today);
  const current = new Map(data.installments.map((i) => [i.id, i]));
  const now = new Date().toISOString();

  for (const target of state.installments) {
    if (target.id === null) {
      await db.runAsync(
        `INSERT INTO installments (loan_id, installment_number, due_date, original_due_date,
           amount_due, amount_paid, waived_amount, status, is_makeup, makeup_for_installment_id,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          loanId,
          target.installmentNumber,
          target.dueDate,
          target.originalDueDate,
          target.amountDue,
          target.amountPaid,
          target.waivedAmount,
          target.status,
          target.makeupForInstallmentId,
          now,
        ],
      );
      continue;
    }
    const old = current.get(target.id)!;
    if (
      old.dueDate !== target.dueDate ||
      old.amountDue !== target.amountDue ||
      old.amountPaid !== target.amountPaid ||
      (old.waivedAmount ?? 0) !== target.waivedAmount ||
      old.status !== target.status
    ) {
      await db.runAsync(
        `UPDATE installments
         SET due_date = ?, amount_due = ?, amount_paid = ?, waived_amount = ?, status = ?
         WHERE id = ?`,
        [
          target.dueDate,
          target.amountDue,
          target.amountPaid,
          target.waivedAmount,
          target.status,
          target.id,
        ],
      );
    }
  }

  // Allocations are derived too: replace them only if the set changed.
  const existing = await db.getAllAsync<{
    payment_id: number;
    installment_id: number;
    amount: number;
  }>(
    `SELECT pa.payment_id, pa.installment_id, pa.amount
     FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
     WHERE p.loan_id = ?`,
    [loanId],
  );
  const existingKeys = existing
    .map((a) =>
      allocationKey({ paymentId: a.payment_id, installmentId: a.installment_id, amount: a.amount }),
    )
    .sort()
    .join('|');
  const targetKeys = state.allocations.map(allocationKey).sort().join('|');
  if (existingKeys !== targetKeys) {
    await db.runAsync(
      'DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE loan_id = ?)',
      [loanId],
    );
    for (const a of state.allocations) {
      await db.runAsync(
        'INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES (?, ?, ?)',
        [a.paymentId, a.installmentId, a.amount],
      );
    }
  }

  const closed = state.status === 'closed_early';
  if (
    data.loan.endDate !== state.endDate ||
    data.loan.status !== state.status ||
    data.loan.closedAt !== state.closedAt ||
    data.loan.discountAmount !== state.discountAmount ||
    (!closed && data.loan.settlementMode !== null)
  ) {
    // status and closed_at change together (CHECK). Reopening also clears mode and note.
    await db.runAsync(
      `UPDATE loans
       SET end_date = ?, status = ?, closed_at = ?, discount_amount = ?,
           settlement_mode = CASE WHEN ? THEN settlement_mode ELSE NULL END,
           closed_reason = CASE WHEN ? THEN closed_reason ELSE NULL END,
           updated_at = ?
       WHERE id = ?`,
      [
        state.endDate,
        state.status,
        state.closedAt,
        state.discountAmount,
        closed ? 1 : 0,
        closed ? 1 : 0,
        now,
        loanId,
      ],
    );
  }
  return state;
}

/** Recompute one loan in its own transaction. Idempotent. */
export function recomputeLoan(db: SQLiteDatabase, loanId: number, today: string) {
  return writeTransaction(db, () => recomputeInTransaction(db, loanId, today));
}

/**
 * Brings every active loan up to date for `today` (new balda days, make-ups, overdue lump sums).
 * Run after DB init and when the app returns to the foreground. Closed-early, completed and
 * cancelled loans are never touched.
 *
 * Cheap: payments already recompute their own loan, so only TIME can make a cached status stale.
 * One query finds the loans whose cached status no longer matches today's date, and only those
 * are recomputed, all in a single transaction. On a normal re-open this touches nothing.
 */
export async function reconcileAllActiveLoans(db: SQLiteDatabase, today: string) {
  const stale = await db.getAllAsync<{ id: number }>(
    `SELECT DISTINCT i.loan_id AS id
     FROM installments i
     JOIN loans l ON l.id = i.loan_id
     WHERE l.status = 'active'
       AND i.is_makeup = 0
       AND (
         (i.due_date < ? AND i.status = 'pending')                                 -- became past due
         OR (i.due_date < ? AND i.status = 'partial' AND l.payment_type = 'lump_sum') -- lump now overdue
         OR (i.due_date >= ? AND i.status = 'missed')                              -- clock moved back
       )`,
    [today, today, today],
  );
  if (stale.length === 0) return;
  await writeTransaction(db, async () => {
    for (const { id } of stale) await recomputeInTransaction(db, id, today);
  });
}

/** What a payment would do (covered installments, balda recovered, advance), without saving. */
export async function previewPayment(
  db: SQLiteDatabase,
  loanId: number,
  amount: number,
  paidOn: string,
  today: string,
): Promise<PaymentPreview | null> {
  const data = await loadLoanForCalc(db, loanId);
  if (!data) return null;
  return previewPaymentPure(data.loan, data.installments, data.payments, amount, paidOn, today);
}

/** Saves a regular payment and recomputes the loan, in one transaction. Returns the payment id. */
export function recordPayment(
  db: SQLiteDatabase,
  input: { loanId: number; amount: number; paidOn: string; note: string | null },
  today: string,
): Promise<number> {
  return writeTransaction(db, async () => {
    const data = await loadLoanForCalc(db, input.loanId);
    if (!data) throw new Error('Loan not found.');
    const balance = computeLoanState(data.loan, data.installments, data.payments, today).balance;
    // Only active loans take payments (closed_early / completed / cancelled are rejected).
    const errors = validatePayment(data.loan, balance, input.amount, input.paidOn, today);
    if (errors.length > 0) throw new PaymentValidationError(errors);

    const result = await db.runAsync(
      `INSERT INTO payments (loan_id, amount, paid_on, note, status, type, is_netted, created_at)
       VALUES (?, ?, ?, ?, 'active', 'regular', 0, ?)`,
      [
        input.loanId,
        input.amount,
        input.paidOn,
        input.note?.trim() || null,
        new Date().toISOString(),
      ],
    );
    await recomputeInTransaction(db, input.loanId, today);
    return result.lastInsertRowId;
  });
}

/**
 * Voids (never deletes) a payment, then recomputes its loan. A reason is required.
 * Early-payoff rules:
 *  - a regular payment on a closed_early loan can't be voided (void the settlement first);
 *  - a netted settlement can't be voided while its renewal loan isn't cancelled;
 *  - voiding a settlement reopens the loan (recompute handles it).
 */
export function voidPayment(
  db: SQLiteDatabase,
  paymentId: number,
  reason: string,
  today: string,
): Promise<void> {
  return writeTransaction(db, async () => {
    if (!reason.trim()) throw new Error('A reason is required to void a payment.');
    const payment = await db.getFirstAsync<{
      loan_id: number;
      loan_status: LoanStatus;
      type: PaymentKind;
      is_netted: number;
    }>(
      `SELECT p.loan_id, l.status AS loan_status, p.type, p.is_netted
       FROM payments p JOIN loans l ON l.id = p.loan_id
       WHERE p.id = ? AND p.status = 'active'`,
      [paymentId],
    );
    if (!payment) throw new Error('This payment was not found or is already voided.');
    if (payment.loan_status === 'cancelled')
      throw new Error('Payments on a cancelled loan cannot be changed.');
    if (payment.type === 'regular' && payment.loan_status === 'closed_early') {
      throw new VoidBlockedError('voidSettlementFirst');
    }
    if (payment.type === 'settlement' && payment.is_netted === 1) {
      const renewal = await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM loans WHERE renewed_from_loan_id = ? AND status != 'cancelled'",
        [payment.loan_id],
      );
      if ((renewal?.n ?? 0) > 0) throw new VoidBlockedError('cancelRenewalFirst');
    }

    await db.runAsync(
      "UPDATE payments SET status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?",
      [new Date().toISOString(), reason.trim(), paymentId],
    );
    await recomputeInTransaction(db, payment.loan_id, today);
  });
}

/** All payments of a loan, newest first; voided ones included (status shows it). */
export async function getPaymentsByLoan(db: SQLiteDatabase, loanId: number): Promise<Payment[]> {
  const rows = await db.getAllAsync<PaymentRow>(
    'SELECT * FROM payments WHERE loan_id = ? ORDER BY paid_on DESC, id DESC',
    [loanId],
  );
  return rows.map((r) => ({
    id: r.id,
    loanId: r.loan_id,
    amount: r.amount,
    paidOn: r.paid_on,
    note: r.note,
    status: r.status,
    type: r.type,
    isNetted: r.is_netted === 1,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    createdAt: r.created_at,
  }));
}

/** Paid, balance, overdue, balda days, next due, days overdue — always derived from payments. */
export async function getLoanBalanceSummary(
  db: SQLiteDatabase,
  loanId: number,
  today: string,
): Promise<LoanBalanceSummary | null> {
  const data = await loadLoanForCalc(db, loanId);
  if (!data) return null;
  const state = computeLoanState(data.loan, data.installments, data.payments, today);
  return summarizeLoan(data.loan, state, today);
}
