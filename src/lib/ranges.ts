/**
 * Date ranges for the dashboard and reports. Pure; local 'YYYY-MM-DD' strings only, and
 * `today` is always a parameter (the app can stay open across midnight).
 */

import { addDays, daysBetween, parseYmd, toYmd } from './loan';

export interface DateRange {
  from: string;
  to: string;
}

/** Monday of the week containing `day` (weeks run Monday–Sunday). */
export function startOfWeek(day: string): string {
  const weekday = (parseYmd(day).getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  return addDays(day, -weekday);
}

export function weekRange(day: string): DateRange {
  const from = startOfWeek(day);
  return { from, to: addDays(from, 6) };
}

export function monthRange(day: string): DateRange {
  const d = parseYmd(day);
  return {
    from: toYmd(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

export function lastMonthRange(day: string): DateRange {
  const d = parseYmd(day);
  return monthRange(toYmd(new Date(d.getFullYear(), d.getMonth() - 1, 1)));
}

/** Every date from `from` to `to`, inclusive, oldest first ([] if from > to). */
export function datesInRange({ from, to }: DateRange): string[] {
  const count = daysBetween(from, to) + 1;
  const dates: string[] = [];
  for (let i = 0; i < count; i++) dates.push(addDays(from, i));
  return dates;
}

/** Smallest range covering both (the dashboard loads this week and this month in one go). */
export function unionRange(a: DateRange, b: DateRange): DateRange {
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

export type ReportPreset = 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

export function presetRange(preset: Exclude<ReportPreset, 'custom'>, today: string): DateRange {
  switch (preset) {
    case 'thisWeek':
      return weekRange(today);
    case 'thisMonth':
      return monthRange(today);
    default:
      return lastMonthRange(today);
  }
}

export type CustomRangeError = 'fromAfterTo' | 'futureDate';

/** Custom report range: from ≤ to, and `to` not after today. */
export function validateCustomRange({ from, to }: DateRange, today: string): CustomRangeError | null {
  if (to > today) return 'futureDate';
  if (from > to) return 'fromAfterTo';
  return null;
}
