import type { PaymentType } from '@/lib/loan';

export type { PaymentType };
/** 'closed_early' = settled before the term ended (early payoff / pa-ending). */
export type LoanStatus = 'active' | 'completed' | 'cancelled' | 'closed_early';
export type SettlementMode = 'full' | 'prorata' | 'discount';
/** 'skipped' = a make-up day that is no longer needed (its missed day was recovered). */
/** 'settled' = closed by an early payoff; any unpaid part is in waived_amount. */
export type InstallmentStatus = 'pending' | 'paid' | 'partial' | 'missed' | 'skipped' | 'settled';

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
  /** Early payoff: settlement date ('YYYY-MM-DD'), note, mode, and the amount forgiven. */
  closedAt: string | null;
  closedReason: string | null;
  settlementMode: SettlementMode | null;
  discountAmount: number;
  /** Set when this loan renewed (replaced) an earlier one. */
  renewedFromLoanId: number | null;
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
  /** The loan that renewed this one, if any (latest). */
  renewedByLoanId: number | null;
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
  /** Part of amount_due forgiven by an early payoff (0 otherwise). */
  waivedAmount: number;
  status: InstallmentStatus;
  /** Extra collection day appended because an installment was missed (balda). */
  isMakeup: boolean;
  makeupForInstallmentId: number | null;
  createdAt: string;
}

export type PaymentStatus = 'active' | 'voided';
export type PaymentKind = 'regular' | 'settlement';

export interface Payment {
  id: number;
  loanId: number;
  amount: number;
  /** 'YYYY-MM-DD' */
  paidOn: string;
  note: string | null;
  status: PaymentStatus;
  type: PaymentKind;
  /** Settlement deducted from a renewal loan's principal: no cash changed hands. */
  isNetted: boolean;
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
  /** Renewal: the loan this one replaces. */
  renewedFromLoanId?: number | null;
  schedule: { installmentNumber: number; dueDate: string; amountDue: number }[];
}
