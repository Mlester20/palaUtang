import type { SQLiteDatabase } from 'expo-sqlite';

import { getLoanById, getLoansByBorrower } from '@/db/loans';
import { getLoanBalanceSummary } from '@/db/payments';
import type { ReceiptAllocationInput } from '@/lib/receipt';
import type {
  StatementData,
  StatementInstallmentRow,
  StatementOptions,
  StatementPaymentRow,
  StatementScope,
} from '@/lib/statementHtml';
import type { PaymentKind, PaymentStatus } from '@/types/loan';

/**
 * Receipts & statements (Phase 13): read-only queries, no writes. Each exported function runs a
 * FIXED, small number of queries regardless of how many payments/installments exist (no
 * per-row loops), per the project's performance rule (see memory day-loop-date-math-perf).
 */

export interface ReceiptQueryResult {
  loanId: number;
  loanPrincipal: number;
  totalPayable: number;
  /** loans.discount_amount; only meaningful when this payment is the active settlement. */
  discountAmount: number;
  borrowerName: string;
  paidOn: string;
  amountReceived: number;
  paymentStatus: PaymentStatus;
  paymentType: PaymentKind;
  isNetted: boolean;
  allocations: ReceiptAllocationInput[];
  /** Sum of active-payment allocations for this loan, up to and including this payment. */
  totalPaidUpToAndIncluding: number;
}

/**
 * Everything the pure receipt maths (src/lib/receipt.ts) needs for ONE payment, in 3 queries:
 * the payment + its loan + borrower, this payment's allocations (for the applied breakdown),
 * and the cumulative allocation total up to and including it (for the balance as of this
 * payment). Returns null if the payment doesn't exist.
 */
export async function getReceiptData(
  db: SQLiteDatabase,
  paymentId: number,
): Promise<ReceiptQueryResult | null> {
  const row = await db.getFirstAsync<{
    loan_id: number;
    amount: number;
    paid_on: string;
    status: PaymentStatus;
    type: PaymentKind;
    is_netted: number;
    principal: number;
    total_payable: number;
    discount_amount: number;
    borrower_name: string;
  }>(
    `SELECT p.loan_id, p.amount, p.paid_on, p.status, p.type, p.is_netted,
            l.principal, l.total_payable, l.discount_amount,
            b.full_name AS borrower_name
     FROM payments p
     JOIN loans l ON l.id = p.loan_id
     JOIN borrowers b ON b.id = l.borrower_id
     WHERE p.id = ?`,
    [paymentId],
  );
  if (!row) return null;

  const allocationRows = await db.getAllAsync<{ original_due_date: string; amount: number }>(
    `SELECT i.original_due_date, pa.amount
     FROM payment_allocations pa
     JOIN installments i ON i.id = pa.installment_id
     WHERE pa.payment_id = ?`,
    [paymentId],
  );

  const cumulative = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(pa.amount), 0) AS total
     FROM payment_allocations pa
     JOIN payments p2 ON p2.id = pa.payment_id
     WHERE p2.loan_id = ? AND p2.status = 'active'
       AND (p2.paid_on < ? OR (p2.paid_on = ? AND p2.id <= ?))`,
    [row.loan_id, row.paid_on, row.paid_on, paymentId],
  );

  return {
    loanId: row.loan_id,
    loanPrincipal: row.principal,
    totalPayable: row.total_payable,
    discountAmount: row.discount_amount,
    borrowerName: row.borrower_name,
    paidOn: row.paid_on,
    amountReceived: row.amount,
    paymentStatus: row.status,
    paymentType: row.type,
    isNetted: row.is_netted === 1,
    allocations: allocationRows.map((a) => ({
      originalDueDate: a.original_due_date,
      amount: a.amount,
    })),
    totalPaidUpToAndIncluding: cumulative?.total ?? 0,
  };
}

/** Settings → Preview: the most recently entered active payment, or null if there are none. */
export async function getLatestActivePaymentId(db: SQLiteDatabase): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM payments WHERE status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1",
  );
  return row?.id ?? null;
}

/**
 * Everything the statement HTML builder (src/lib/statementHtml.ts) needs. Query count: 1 for the
 * borrower, 1 for the loans (reuses getLoanById/getLoansByBorrower), up to 2 more for the
 * payment list and schedule (one query each, across every loan in scope via a SQL window
 * function for the running balance — never a per-payment loop), plus one getLoanBalanceSummary
 * call per ACTIVE loan for the overdue total (bounded by the borrower's own loan count, not by
 * payment/installment history, so it stays cheap even for a very old account).
 */
export async function getStatementData(
  db: SQLiteDatabase,
  scope: StatementScope,
  options: Pick<StatementOptions, 'includePayments' | 'includeSchedule'>,
  today: string,
): Promise<StatementData | null> {
  let borrowerId: number;
  let allLoans: Awaited<ReturnType<typeof getLoansByBorrower>>;
  if ('loanId' in scope) {
    const loan = await getLoanById(db, scope.loanId);
    if (!loan) return null;
    borrowerId = loan.borrowerId;
    allLoans = [loan];
  } else {
    borrowerId = scope.borrowerId;
    allLoans = await getLoansByBorrower(db, borrowerId);
  }

  const borrowerRow = await db.getFirstAsync<{ full_name: string; phone: string | null }>(
    'SELECT full_name, phone FROM borrowers WHERE id = ?',
    [borrowerId],
  );
  if (!borrowerRow) return null;

  const loans = allLoans.filter((l) => l.status !== 'cancelled');
  const loanIds = loans.map((l) => l.id);

  let overdueAmount = 0;
  for (const loan of loans) {
    if (loan.status !== 'active') continue;
    const summary = await getLoanBalanceSummary(db, loan.id, today);
    overdueAmount += summary?.overdueAmount ?? 0;
  }

  let payments: StatementPaymentRow[] = [];
  if (options.includePayments && loanIds.length > 0) {
    const placeholders = loanIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<{
      loan_id: number;
      amount: number;
      paid_on: string;
      type: PaymentKind;
      is_netted: number;
      cum_allocated: number;
    }>(
      `SELECT p.loan_id, p.amount, p.paid_on, p.type, p.is_netted,
              SUM(COALESCE(alloc.amt, 0)) OVER (
                PARTITION BY p.loan_id ORDER BY p.paid_on, p.id
              ) AS cum_allocated
       FROM payments p
       LEFT JOIN (
         SELECT payment_id, SUM(amount) AS amt FROM payment_allocations GROUP BY payment_id
       ) alloc ON alloc.payment_id = p.id
       WHERE p.loan_id IN (${placeholders}) AND p.status = 'active'
       ORDER BY p.loan_id, p.paid_on, p.id`,
      loanIds,
    );
    const discountByLoan = new Map(loans.map((l) => [l.id, l.discountAmount]));
    const payableByLoan = new Map(loans.map((l) => [l.id, l.totalPayable]));
    payments = rows.map((r) => {
      const isActiveSettlement = r.type === 'settlement';
      const discount = isActiveSettlement ? discountByLoan.get(r.loan_id) ?? 0 : 0;
      const totalPayable = payableByLoan.get(r.loan_id) ?? 0;
      return {
        loanId: r.loan_id,
        amount: r.amount,
        paidOn: r.paid_on,
        type: r.type,
        isNetted: r.is_netted === 1,
        balanceAfter: Math.max(0, totalPayable - r.cum_allocated - discount),
      };
    });
  }

  let installments: StatementInstallmentRow[] = [];
  if (options.includeSchedule && loanIds.length > 0) {
    const placeholders = loanIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<{
      loan_id: number;
      installment_number: number;
      original_due_date: string;
      amount_due: number;
      amount_paid: number;
      status: StatementInstallmentRow['status'];
      is_makeup: number;
    }>(
      `SELECT loan_id, installment_number, original_due_date, amount_due, amount_paid, status, is_makeup
       FROM installments
       WHERE loan_id IN (${placeholders})
       ORDER BY loan_id, due_date, installment_number`,
      loanIds,
    );
    installments = rows.map((r) => ({
      loanId: r.loan_id,
      installmentNumber: r.installment_number,
      originalDueDate: r.original_due_date,
      amountDue: r.amount_due,
      amountPaid: r.amount_paid,
      status: r.status,
      isMakeup: r.is_makeup === 1,
    }));
  }

  return {
    businessName: '', // filled in by the service layer (business profile is in kv-store, not SQL)
    businessPhone: null,
    businessAddress: null,
    borrowerName: borrowerRow.full_name,
    borrowerPhone: borrowerRow.phone,
    loans,
    overdueAmount,
    payments,
    installments,
  };
}
