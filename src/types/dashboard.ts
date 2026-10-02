/** Money is always stored as integer centavos (₱1,500.00 = 150000) to avoid floating-point errors. */
export type Centavos = number;

export type DueStatus = 'paid' | 'unpaid' | 'balda';

export interface CollectionSummary {
  targetCentavos: Centavos;
  collectedCentavos: Centavos;
  paidCount: number;
  totalCount: number;
}

export interface DashboardStats {
  activeBorrowers: number;
  activeLoans: number;
  baldaCount: number;
  outstandingCentavos: Centavos;
}

export interface DailyEarning {
  /** Short weekday label, Monday first: "Mon" … "Sun". */
  day: string;
  amountCentavos: Centavos;
}

export interface WeeklyEarnings {
  days: DailyEarning[];
  estimatedMonthInterestCentavos: Centavos;
}

export interface DueTodayItem {
  id: string;
  borrowerName: string;
  amountDueCentavos: Centavos;
  status: DueStatus;
}

export interface DashboardData {
  collection: CollectionSummary;
  stats: DashboardStats;
  weekly: WeeklyEarnings;
  dueToday: DueTodayItem[];
}
