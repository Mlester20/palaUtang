import type { PaymentType } from '@/lib/loan';

export type { PaymentType };
export type LoanStatus = 'active' | 'completed' | 'cancelled';
export type InstallmentStatus = 'pending' | 'paid' | 'partial' | 'missed';

/** Money fields are integer centavos; dates are 'YYYY-MM-DD'. */
export interface Loan {
  id: number;
  borrowerId: number;
  principal: number;
  /** Flat % for the whole term; null when the loan was created by installment amount. */
  interestRate: number | null;
  interestAmount: number;
  totalPayable: number;
  paymentType: PaymentType;
  numberOfInstallments: number;
  installmentAmount: number;
  startDate: string;
  endDate: string;
  skipSundays: boolean;
  status: LoanStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A loan with its borrower's name and schedule progress (for lists and the detail header). */
export interface LoanSummary extends Loan {
  borrowerName: string;
  paidCount: number;
  totalCount: number;
  amountPaid: number;
}

export interface Installment {
  id: number;
  loanId: number;
  installmentNumber: number;
  /** May move in later phases (balda / schedule shift). */
  dueDate: string;
  /** Never changes after creation. */
  originalDueDate: string;
  amountDue: number;
  amountPaid: number;
  status: InstallmentStatus;
  createdAt: string;
}

export interface CreateLoanInput {
  borrowerId: number;
  principal: number;
  interestRate: number | null;
  interestAmount: number;
  totalPayable: number;
  paymentType: PaymentType;
  numberOfInstallments: number;
  installmentAmount: number;
  startDate: string;
  endDate: string;
  skipSundays: boolean;
  notes: string | null;
  schedule: { installmentNumber: number; dueDate: string; amountDue: number }[];
}
