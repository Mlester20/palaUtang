import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { confirmOwner } from '@/lib/appLock';
import type { BackupProblem } from '@/lib/backup';
import { createAndExportBackup, RestoreError, type BackupTarget } from '@/services/backup';
import { OperationBusyError, runDataOperation } from '@/store/backup-state';

/** The privacy reminder (shown before every backup and export); resolves true on Continue. */
export function confirmPrivacy(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t('backup.privacyTitle'),
      t('backup.privacyMessage'),
      [
        { text: t('backup.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('backup.continue'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Owner check (App Lock helper); shows why nothing happened when it fails. */
export async function confirmOwnerOrExplain(): Promise<boolean> {
  if (await confirmOwner()) return true;
  Alert.alert(t('backup.authFailedTitle'), t('backup.authFailedMessage'));
  return false;
}

const PROBLEM: Record<BackupProblem, TranslationKey> = {
  notSqlite: 'backup.errNotSqlite',
  corrupt: 'backup.errCorrupt',
  foreignKeys: 'backup.errCorrupt',
  notPeraHiram: 'backup.errNotPeraHiram',
  unsupportedFormat: 'backup.errNewerVersion',
  newerVersion: 'backup.errNewerVersion',
  missingTables: 'backup.errMissingTables',
};

/** Friendly text for any backup / restore / export error (never shows database contents). */
export function dataErrorText(error: unknown): string {
  if (error instanceof OperationBusyError) return t('backup.errBusy');
  if (error instanceof RestoreError) {
    if (error.reason === 'rolledBack') return t('backup.errRolledBack');
    if (error.reason === 'rollbackFailed') return t('backup.errRollbackFailed');
    return t(PROBLEM[error.reason]);
  }
  return t('backup.errGeneric');
}

/** Privacy reminder → owner check → make and share/save the backup. */
export async function runBackupFlow(db: SQLiteDatabase, target: BackupTarget): Promise<boolean> {
  if (!(await confirmPrivacy())) return false;
  if (!(await confirmOwnerOrExplain())) return false;
  try {
    const { result } = await runDataOperation('backup', () => createAndExportBackup(db, target));
    if (result === 'done') {
      Alert.alert(t('backup.doneTitle'), t('backup.doneMessage'));
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Backup failed]', error instanceof Error ? error.message : 'unknown');
    Alert.alert(t('backup.failedTitle'), dataErrorText(error));
    return false;
  }
}
