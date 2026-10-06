import type { Severity } from '@/lib/flags';

/** Money is always stored as integer centavos (₱1,500.00 = 150000) to avoid floating-point errors. */
export type Centavos = number;

/** Chip colours: collection states plus the balda severities (late / flagged / critical). */
export type ChipTone = 'neutral' | 'success' | 'info' | 'partial' | Exclude<Severity, 'none'>;

/** Hero card: the same numbers as the Collection tab's summary. */
export interface HeroCollection {
  expectedCentavos: Centavos;
  collectedCentavos: Centavos;
  remainingCentavos: Centavos;
  /** 0–100, or null when nothing is due or collected today. */
  percent: number | null;
  paidCount: number;
  totalCount: number;
}

export interface DailyEarning {
  /** Short weekday label, Monday first: "Mon" … "Sun". */
  day: string;
  amountCentavos: Centavos;
}

export interface WeeklyEarnings {
  days: DailyEarning[];
  monthInterestCentavos: Centavos;
}

export interface DueTodayItem {
  id: string;
  borrowerName: string;
  amountDueCentavos: Centavos;
  chipLabel: string;
  chipTone: ChipTone;
}

export interface AttentionItem {
  borrowerId: number;
  name: string;
  nickname: string | null;
  phone: string | null;
  area: string | null;
  chipLabel: string;
  chipTone: ChipTone;
  totalOverdueCentavos: Centavos;
  /** "Last paid 3 days ago" / "No payments yet". */
  lastPaidText: string;
}
