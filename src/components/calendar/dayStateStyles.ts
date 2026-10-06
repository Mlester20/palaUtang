import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { TranslationKey } from '@/i18n';
import type { CalendarDayState } from '@/lib/loanCalendar';
import type { PaymentType } from '@/lib/loan';

/**
 * One config object per day state (icon + colors), so the calendar grid and the legend always
 * agree. Each state has its OWN icon (never color alone), matching the colour language already
 * used by src/components/loans/StatusBadges.tsx (green = paid, amber = partial, red = missed/
 * overdue, violet = settled, dashed/faded = skipped-equivalent) extended with teal = recovered
 * and sky = advance (reusing AdvanceMarker's sky).
 */
export type DayStateStyle = {
  icon: ComponentProps<typeof Ionicons>['name'] | null;
  cellClass: string;
  iconColor: { light: string; dark: string };
  dashed?: boolean;
  faded?: boolean;
};

export const DAY_STATE_STYLE: Record<CalendarDayState, DayStateStyle> = {
  paid: {
    icon: 'checkmark-circle',
    cellClass: 'bg-green-50 dark:bg-green-950',
    iconColor: { light: '#16a34a', dark: '#4ade80' },
  },
  recovered: {
    icon: 'checkmark-done-circle',
    cellClass: 'bg-teal-50 dark:bg-teal-950',
    iconColor: { light: '#0d9488', dark: '#2dd4bf' },
  },
  advance: {
    icon: 'arrow-forward-circle',
    cellClass: 'bg-sky-50 dark:bg-sky-950',
    iconColor: { light: '#0284c7', dark: '#38bdf8' },
  },
  partial: {
    icon: 'contrast-outline',
    cellClass: 'bg-amber-50 dark:bg-amber-950',
    iconColor: { light: '#b45309', dark: '#fbbf24' },
  },
  pending: {
    icon: 'ellipse-outline',
    cellClass: 'bg-white dark:bg-slate-900',
    iconColor: { light: '#94a3b8', dark: '#64748b' },
  },
  missed: {
    icon: 'close-circle',
    cellClass: 'bg-red-50 dark:bg-red-950',
    iconColor: { light: '#dc2626', dark: '#f87171' },
  },
  makeup_pending: {
    icon: 'add-circle-outline',
    cellClass: 'bg-amber-50 dark:bg-amber-950',
    iconColor: { light: '#b45309', dark: '#fbbf24' },
    dashed: true,
  },
  makeup_not_needed: {
    icon: 'remove-circle-outline',
    cellClass: 'bg-white dark:bg-slate-900',
    iconColor: { light: '#cbd5e1', dark: '#475569' },
    dashed: true,
    faded: true,
  },
  settled: {
    icon: 'flag',
    cellClass: 'bg-violet-50 dark:bg-violet-950',
    iconColor: { light: '#7c3aed', dark: '#c4b5fd' },
  },
  no_collection: {
    icon: null,
    cellClass: 'bg-slate-50 dark:bg-slate-950',
    iconColor: { light: '#cbd5e1', dark: '#475569' },
    faded: true,
  },
  outside: {
    icon: null,
    cellClass: 'bg-transparent',
    iconColor: { light: 'transparent', dark: 'transparent' },
  },
};

const STATE_LABEL: Record<CalendarDayState, TranslationKey> = {
  paid: 'calendar.statePaid',
  recovered: 'calendar.stateRecovered',
  advance: 'calendar.stateAdvance',
  partial: 'calendar.statePartial',
  pending: 'calendar.statePending',
  missed: 'calendar.stateMissed',
  makeup_pending: 'calendar.stateMakeupPending',
  makeup_not_needed: 'calendar.stateMakeupNotNeeded',
  settled: 'calendar.stateSettled',
  no_collection: 'calendar.stateNoCollection',
  outside: 'calendar.statePending', // never shown (outside days are blank, no legend entry)
};

/** Lump-sum loans call the 'missed' state "Overdue" instead of "Missed" (matches InstallmentStatusChip). */
export function stateLabelKey(state: CalendarDayState, paymentType: PaymentType): TranslationKey {
  if (state === 'missed' && paymentType === 'lump_sum') return 'calendar.stateMissedLumpSum';
  return STATE_LABEL[state];
}

/** States worth a legend entry (outside days are blank and never explained). */
export const LEGEND_STATES: CalendarDayState[] = [
  'paid',
  'recovered',
  'advance',
  'partial',
  'pending',
  'missed',
  'makeup_pending',
  'makeup_not_needed',
  'settled',
  'no_collection',
];
