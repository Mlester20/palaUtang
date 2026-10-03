import type { PaymentType } from '@/lib/loan';

export type { PaymentType };
export type LoanStatus = 'active' | 'completed' | 'cancelled';
/** 'skipped' = a make-up day that is no longer needed (its missed day was recovered). */
export type InstallmentStatus = 'pending' | 'paid' | 'partial' | 'missed' | 'skipped';

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
  /** Regular (non make-up) installments fully paid. */
  paidCount: number;
  /** Regular (non make-up) installments in the schedule. */
  totalCount: number;
  /** Sum of active (non-voided) payments. */
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
  /** Cache derived from active payments by recomputeLoan. */
  amountPaid: number;
  status: InstallmentStatus;
  /** Extra collection day appended because an installment was missed (balda). */
  isMakeup: boolean;
  makeupForInstallmentId: number | null;
  createdAt: string;
}

export type PaymentStatus = 'active' | 'voided';

export interface Payment {
  id: number;
  loanId: number;
  amount: number;
  /** 'YYYY-MM-DD' */
  paidOn: string;
  note: string | null;
  status: PaymentStatus;
  voidedAt: string | null;
  voidReason: string | null;
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
