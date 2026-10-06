import type { SQLiteDatabase } from 'expo-sqlite';

import { getInstallmentsByLoan, getLoanById } from '@/db/loans';
import {
  buildLoanCalendar,
  type LoanCalendarAllocationInput,
  type LoanCalendarPaymentInput,
  type LoanCalendarResult,
} from '@/lib/loanCalendar';
import type { PaymentKind, PaymentStatus } from '@/types/loan';

/**
 * ONE loan's whole calendar in exactly 3 queries, regardless of how many installments/payments
 * exist: (1) the loan (getLoanById, reused — already has paymentType/skipSundays/status/dates),
 * (2) its installments (getInstallmentsByLoan, reused), (3) its payments LEFT JOIN
 * payment_allocations in one query (one row per payment+allocation pair; grouped back into
 * payments[] + allocations[] here). No per-day or per-installment queries; changing the
 * displayed month never re-queries (the pure function already built every day up front).
 */
export async function getLoanCalendarData(
  db: SQLiteDatabase,
  loanId: number,
  today: string,
): Promise<LoanCalendarResult | null> {
  const [loan, installments, paymentAllocRows] = await Promise.all([
    getLoanById(db, loanId),
    getInstallmentsByLoan(db, loanId),
    db.getAllAsync<{
      payment_id: number;
      amount: number;
      paid_on: string;
      status: PaymentStatus;
      type: PaymentKind;
      is_netted: number;
      note: string | null;
      void_reason: string | null;
      installment_id: number | null;
      alloc_amount: number | null;
    }>(
      `SELECT p.id AS payment_id, p.amount, p.paid_on, p.status, p.type, p.is_netted, p.note,
              p.void_reason, pa.installment_id, pa.amount AS alloc_amount
       FROM payments p
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
       WHERE p.loan_id = ?
       ORDER BY p.paid_on, p.id`,
      [loanId],
    ),
  ]);
  if (!loan) return null;

  const paymentsById = new Map<number, LoanCalendarPaymentInput>();
  const allocations: LoanCalendarAllocationInput[] = [];
  for (const r of paymentAllocRows) {
    if (!paymentsById.has(r.payment_id)) {
      paymentsById.set(r.payment_id, {
        id: r.payment_id,
        amount: r.amount,
        paidOn: r.paid_on,
        status: r.status,
        type: r.type,
        isNetted: r.is_netted === 1,
        note: r.note,
        voidReason: r.void_reason,
      });
    }
    if (r.installment_id !== null && r.alloc_amount !== null) {
      allocations.push({
        installmentId: r.installment_id,
        paymentId: r.payment_id,
        amount: r.alloc_amount,
        paidOn: r.paid_on,
      });
    }
  }

  return buildLoanCalendar({
    loan: {
      paymentType: loan.paymentType,
      skipSundays: loan.skipSundays,
      status: loan.status,
      startDate: loan.startDate,
      endDate: loan.endDate,
      closedAt: loan.closedAt,
      installmentAmount: loan.installmentAmount,
    },
    installments: installments.map((i) => ({
      id: i.id,
      installmentNumber: i.installmentNumber,
      dueDate: i.dueDate,
      originalDueDate: i.originalDueDate,
      amountDue: i.amountDue,
      amountPaid: i.amountPaid,
      waivedAmount: i.waivedAmount,
      status: i.status,
      isMakeup: i.isMakeup,
      makeupForInstallmentId: i.makeupForInstallmentId,
    })),
    allocations,
    payments: [...paymentsById.values()],
    today,
  });
}
