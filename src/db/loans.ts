import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CreateLoanInput,
  Installment,
  InstallmentStatus,
  Loan,
  LoanStatus,
  LoanSummary,
  PaymentType,
} from '@/types/loan';

type LoanRow = {
  id: number;
  borrower_id: number;
  principal: number;
  interest_rate: number | null;
  interest_amount: number;
  total_payable: number;
  payment_type: PaymentType;
  number_of_installments: number;
  installment_amount: number;
  start_date: string;
  end_date: string;
  skip_sundays: number;
  status: LoanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LoanSummaryRow = LoanRow & {
  borrower_name: string;
  paid_count: number;
  total_count: number;
  amount_paid: number;
};

type InstallmentRow = {
  id: number;
  loan_id: number;
  installment_number: number;
  due_date: string;
  original_due_date: string;
  amount_due: number;
  amount_paid: number;
  status: InstallmentStatus;
  created_at: string;
};

function toLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    borrowerId: row.borrower_id,
    principal: row.principal,
    interestRate: row.interest_rate,
    interestAmount: row.interest_amount,
    totalPayable: row.total_payable,
    paymentType: row.payment_type,
    numberOfInstallments: row.number_of_installments,
    installmentAmount: row.installment_amount,
    startDate: row.start_date,
    endDate: row.end_date,
    skipSundays: row.skip_sundays === 1,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLoanSummary(row: LoanSummaryRow): LoanSummary {
  return {
    ...toLoan(row),
    borrowerName: row.borrower_name,
    paidCount: row.paid_count ?? 0,
    totalCount: row.total_count ?? 0,
    amountPaid: row.amount_paid ?? 0,
  };
}

function toInstallment(row: InstallmentRow): Installment {
  return {
    id: row.id,
    loanId: row.loan_id,
    installmentNumber: row.installment_number,
    dueDate: row.due_date,
    originalDueDate: row.original_due_date,
    amountDue: row.amount_due,
    amountPaid: row.amount_paid,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Loan + borrower name + schedule progress, aggregated from installments. */
const SUMMARY_SELECT = `
  SELECT l.*,
         b.full_name AS borrower_name,
         COUNT(i.id) AS total_count,
         COALESCE(SUM(i.status = 'paid'), 0) AS paid_count,
         COALESCE(SUM(i.amount_paid), 0) AS amount_paid
  FROM loans l
  JOIN borrowers b ON b.id = l.borrower_id
  LEFT JOIN installments i ON i.loan_id = l.id`;

/**
 * Inserts the loan and its whole schedule in ONE transaction: if any row fails, nothing is saved.
 * Returns the new loan id.
 */
export async function createLoanWithSchedule(
  db: SQLiteDatabase,
  input: CreateLoanInput,
): Promise<number> {
  const scheduleTotal = input.schedule.reduce((sum, row) => sum + row.amountDue, 0);
  if (
    input.schedule.length !== input.numberOfInstallments ||
    scheduleTotal !== input.totalPayable
  ) {
    throw new Error('Schedule does not match the loan total.');
  }

  const now = new Date().toISOString();
  let loanId = 0;

  // Runs on the main connection, where foreign_keys = ON is enforced (borrower must exist).
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `INSERT INTO loans (
         borrower_id, principal, interest_rate, interest_amount, total_payable, payment_type,
         number_of_installments, installment_amount, start_date, end_date, skip_sundays,
         status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        input.borrowerId,
        input.principal,
        input.interestRate,
        input.interestAmount,
        input.totalPayable,
        input.paymentType,
        input.numberOfInstallments,
        input.installmentAmount,
        input.startDate,
        input.endDate,
        input.skipSundays ? 1 : 0,
        input.notes?.trim() || null,
        now,
        now,
      ],
    );
    loanId = result.lastInsertRowId;

    // One prepared statement reused for every installment (schedules can be 365 rows).
    const insert = await db.prepareAsync(
      `INSERT INTO installments (
         loan_id, installment_number, due_date, original_due_date, amount_due, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const row of input.schedule) {
        await insert.executeAsync([
          loanId,
          row.installmentNumber,
          row.dueDate,
          row.dueDate, // original_due_date starts equal to due_date and never changes
          row.amountDue,
          now,
        ]);
      }
    } finally {
      await insert.finalizeAsync();
    }
  });

  return loanId;
}

/** A borrower's loans, active first, newest first. */
export async function getLoansByBorrower(
  db: SQLiteDatabase,
  borrowerId: number,
): Promise<LoanSummary[]> {
  const rows = await db.getAllAsync<LoanSummaryRow>(
    `${SUMMARY_SELECT}
     WHERE l.borrower_id = ?
     GROUP BY l.id
     ORDER BY (l.status = 'active') DESC, l.start_date DESC, l.id DESC`,
    [borrowerId],
  );
  return rows.map(toLoanSummary);
}

export async function getLoanById(db: SQLiteDatabase, id: number): Promise<LoanSummary | null> {
  const row = await db.getFirstAsync<LoanSummaryRow>(
    `${SUMMARY_SELECT}
     WHERE l.id = ?
     GROUP BY l.id`,
    [id],
  );
  return row ? toLoanSummary(row) : null;
}

export async function getInstallmentsByLoan(
  db: SQLiteDatabase,
  loanId: number,
): Promise<Installment[]> {
  const rows = await db.getAllAsync<InstallmentRow>(
    'SELECT * FROM installments WHERE loan_id = ? ORDER BY installment_number',
    [loanId],
  );
  return rows.map(toInstallment);
}

/** A loan can be cancelled only while it is active and nothing has been paid on it. */
export async function canCancelLoan(db: SQLiteDatabase, id: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ ok: number }>(
    `SELECT (l.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM installments WHERE loan_id = l.id AND amount_paid > 0)
            ) AS ok
     FROM loans l WHERE l.id = ?`,
    [id],
  );
  return row?.ok === 1;
}

/** Marks the loan cancelled (its schedule is kept for the record). Throws if not allowed. */
export async function cancelLoan(db: SQLiteDatabase, id: number) {
  // The guard lives in the UPDATE itself, so it can't race with a payment being recorded.
  const result = await db.runAsync(
    `UPDATE loans SET status = 'cancelled', updated_at = ?
     WHERE id = ? AND status = 'active'
       AND NOT EXISTS (SELECT 1 FROM installments WHERE loan_id = ? AND amount_paid > 0)`,
    [new Date().toISOString(), id, id],
  );
  if (result.changes === 0) {
    throw new Error('This loan can no longer be cancelled (it is not active or has payments).');
  }
}

export async function countActiveLoansByBorrower(
  db: SQLiteDatabase,
  borrowerId: number,
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status = 'active'",
    [borrowerId],
  );
  return row?.n ?? 0;
}
