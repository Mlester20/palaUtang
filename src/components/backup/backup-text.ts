import { t } from '@/i18n';
import { daysSince, localStamp, type BackupCounts } from '@/lib/backup';

export function countsText(c: BackupCounts): string {
  return t('backup.countsLine', {
    borrowers: c.borrowers,
    loans: c.loans,
    payments: c.payments,
    cash: c.cashEntries,
  });
}

export function lastBackupText(lastBackupAt: number | null, now = new Date()): string {
  if (lastBackupAt === null) return t('backup.neverBackedUp');
  const days = daysSince(lastBackupAt, now)!;
  const ago =
    days === 0 ? t('backup.today') : days === 1 ? t('backup.yesterday') : t('backup.daysAgo', { count: days });
  return t('backup.lastExported', { date: localStamp(new Date(lastBackupAt)), ago });
}
