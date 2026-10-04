import { t } from '@/i18n';
import type { BorrowerFlag, Severity } from '@/lib/flags';

export function severityLabel(severity: Exclude<Severity, 'none'>): string {
  return t(`flags.${severity}`);
}

export function daysBehindText(days: number): string {
  return days === 1 ? t('flags.oneDayBehind') : t('flags.daysBehind', { count: days });
}

/** "Flagged · 4 days behind". */
export function flagChipLabel(flag: Pick<BorrowerFlag, 'severity' | 'daysBehind'>): string {
  if (flag.severity === 'none') return daysBehindText(flag.daysBehind);
  return t('flags.chip', {
    severity: severityLabel(flag.severity),
    days: daysBehindText(flag.daysBehind),
  });
}

/** "Last paid 3 days ago" / "No payments yet" (informational; never the basis of a flag). */
export function lastPaidText(daysSinceLastPayment: number | null): string {
  if (daysSinceLastPayment === null) return t('flags.noPaymentsYet');
  if (daysSinceLastPayment === 0) return t('flags.lastPaidToday');
  if (daysSinceLastPayment === 1) return t('flags.lastPaidYesterday');
  return t('flags.lastPaidDaysAgo', { count: daysSinceLastPayment });
}
