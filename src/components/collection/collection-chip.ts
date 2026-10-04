import { daysBehindText } from '@/components/flags/flag-text';
import { t } from '@/i18n';
import type { ClassifiedRow } from '@/lib/collection';
import { loanDaysBehind, severityFor, type FlagThresholds } from '@/lib/flags';
import type { ChipTone } from '@/types/dashboard';

/**
 * Chip for a collection row (Collection tab and Home "Due Today"). Overdue rows take the
 * balda severity colour (late / flagged / critical) from the flag thresholds.
 */
export function collectionChip(
  row: ClassifiedRow,
  today: string,
  thresholds: FlagThresholds,
): { label: string; tone: ChipTone } {
  switch (row.status) {
    case 'overdue': {
      const days = loanDaysBehind(row, today);
      const severity = severityFor(days, thresholds);
      return {
        label: t('collection.chipOverdue', { days: daysBehindText(Math.max(1, days)) }),
        tone: severity === 'none' ? 'late' : severity,
      };
    }
    case 'partial':
      return { label: t('collection.chipPartial'), tone: 'partial' };
    case 'paid_today':
      return { label: t('collection.chipPaid'), tone: 'success' };
    case 'paid_in_advance':
      return { label: t('collection.chipPaidAdvance'), tone: 'info' };
    default:
      return { label: t('collection.chipDueToday'), tone: 'neutral' };
  }
}
