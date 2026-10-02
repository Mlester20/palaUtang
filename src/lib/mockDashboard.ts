import type { DashboardData } from '@/types/dashboard';

/**
 * Static sample data for the Home dashboard (Phase 3). Amounts are integer centavos.
 * Replace this with real queries in a later phase; the dashboard components only take props.
 */
export const mockDashboard: DashboardData = {
  collection: {
    targetCentavos: 1_875_000, // ₱18,750.00 due today across 25 borrowers
    collectedCentavos: 1_312_500, // ₱13,125.00 collected so far
    paidCount: 18,
    totalCount: 25,
  },
  stats: {
    activeBorrowers: 25,
    activeLoans: 31,
    baldaCount: 4,
    outstandingCentavos: 18_435_000, // ₱184,350.00
  },
  weekly: {
    days: [
      { day: 'Mon', amountCentavos: 1_650_000 },
      { day: 'Tue', amountCentavos: 1_720_000 },
      { day: 'Wed', amountCentavos: 1_480_000 },
      { day: 'Thu', amountCentavos: 1_805_000 },
      { day: 'Fri', amountCentavos: 1_312_500 },
      { day: 'Sat', amountCentavos: 950_000 },
      { day: 'Sun', amountCentavos: 420_000 },
    ],
    estimatedMonthInterestCentavos: 1_268_000, // ₱12,680.00
  },
  dueToday: [
    { id: 'due-1', borrowerName: 'Maria Santos', amountDueCentavos: 75_000, status: 'paid' },
    { id: 'due-2', borrowerName: 'Juan Dela Cruz', amountDueCentavos: 50_000, status: 'unpaid' },
    { id: 'due-3', borrowerName: 'Rosario Reyes', amountDueCentavos: 125_000, status: 'balda' },
    { id: 'due-4', borrowerName: 'Jose Mendoza', amountDueCentavos: 60_000, status: 'paid' },
    { id: 'due-5', borrowerName: 'Lorna Bautista', amountDueCentavos: 150_000, status: 'unpaid' },
  ],
};
