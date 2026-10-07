import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmOwnerOrExplain, dataErrorText } from '@/components/backup/backup-actions';
import { t } from '@/i18n';
import { hasData, isRestoreConfirmed, RESTORE_CONFIRM_WORD, type BackupCounts } from '@/lib/backup';
import { useThemeColors } from '@/lib/theme';
import {
  applyRestore,
  discardCandidate,
  inspectCandidate,
  pickBackupFile,
  type RestoreCandidate,
} from '@/services/backup';
import { runDataOperation, useDataOperation } from '@/store/backup-state';

/**
 * Restore from a backup file (Settings, onboarding, setup). Nothing changes until the final
 * button: pick → validate (temp copy) → preview → typed RESTORE if this phone has data →
 * owner check → restore (safety backup, swap, migrate; automatic rollback on failure).
 */
export default function RestoreScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const operation = useDataOperation();
  const [checking, setChecking] = useState(false);
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
  const [typed, setTyped] = useState('');
  const startedRef = useRef(false); // double-tap guard for the restore button

  // Leaving without restoring deletes the picked temp copy.
  useEffect(() => () => discardCandidate(), []);

  const choose = async () => {
    if (checking || operation !== null) return;
    setChecking(true);
    try {
      const file = await pickBackupFile();
      if (!file) return; // picker cancelled
      setCandidate(await inspectCandidate(db, file));
      setTyped('');
    } catch (error) {
      discardCandidate();
      Alert.alert(t('backup.cannotRestoreTitle'), dataErrorText(error));
    } finally {
      setChecking(false);
    }
  };

  const cancel = () => {
    discardCandidate();
    setCandidate(null);
    setTyped('');
  };

  const mustType = candidate ? hasData(candidate.currentCounts) : false;
  const canRestore = candidate !== null && (!mustType || isRestoreConfirmed(typed));

  const restore = async () => {
    if (!candidate || !canRestore || startedRef.current || operation !== null) return;
    startedRef.current = true;
    try {
      // App Lock owner check (skipped on a fresh install: no lock setting exists yet).
      if (!(await confirmOwnerOrExplain())) return;
      await runDataOperation('restore', () => applyRestore(db, candidate));
      router.replace('/');
      Alert.alert(t('backup.restoredTitle'), t('backup.restoredMessage'));
    } catch (error) {
      console.error('[Restore failed]', error instanceof Error ? error.message : 'unknown');
      router.replace('/');
      Alert.alert(t('backup.restoreFailedTitle'), dataErrorText(error));
    } finally {
      startedRef.current = false;
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {candidate === null ? (
          <>
            <View className="gap-3 rounded-2xl bg-white p-5 dark:bg-slate-900">
              <Ionicons name="refresh-circle-outline" size={36} color={colors.primary} />
              <Text className="text-lg font-bold text-slate-900 dark:text-white">
                {t('backup.restoreIntroTitle')}
              </Text>
              <Text className="text-base text-slate-700 dark:text-slate-200">
                {t('backup.restoreIntro')}
              </Text>
            </View>
            <Pressable
              onPress={choose}
              disabled={checking}
              accessibilityRole="button"
              className={`min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 dark:bg-teal-500 ${
                checking ? 'opacity-60' : 'active:bg-teal-800'
              }`}>
              {checking && <ActivityIndicator color="#ffffff" />}
              <Text className="text-lg font-bold text-white">
                {checking ? t('backup.checkingFile') : t('backup.chooseFile')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* Preview */}
            <View className="gap-3 rounded-2xl bg-white p-5 dark:bg-slate-900">
              <Text className="text-lg font-bold text-slate-900 dark:text-white">
                {t('backup.previewTitle')}
              </Text>
              <Text className="text-base text-slate-700 dark:text-slate-200">
                {t('backup.previewMade', {
                  date: candidate.meta.createdAt,
                  version: candidate.meta.appVersion,
                })}
              </Text>
              <CountsTable backup={candidate.meta.counts} current={candidate.currentCounts} />
            </View>

            <View className="flex-row gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <Ionicons name="warning" size={26} color={colors.danger} />
              <Text className="flex-1 text-base font-semibold text-red-800 dark:text-red-100">
                {t('backup.replaceWarning')}
              </Text>
            </View>

            {mustType && (
              <View className="gap-2">
                <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  {t('backup.typeToConfirm', { word: RESTORE_CONFIRM_WORD })}
                </Text>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={RESTORE_CONFIRM_WORD}
                  placeholderTextColor={colors.textMuted}
                  className="min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-xl text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </View>
            )}

            <View className="flex-row gap-3">
              <Pressable
                onPress={cancel}
                accessibilityRole="button"
                className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
                <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                  {t('backup.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={restore}
                disabled={!canRestore || operation !== null}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canRestore }}
                className={`min-h-14 flex-1 items-center justify-center rounded-2xl bg-red-600 ${
                  canRestore ? 'active:bg-red-700' : 'opacity-40'
                }`}>
                <Text className="text-lg font-bold text-white">{t('backup.restoreConfirm')}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CountsTable({ backup, current }: { backup: BackupCounts; current: BackupCounts }) {
  const rows: [string, number, number][] = [
    [t('backup.countBorrowers'), backup.borrowers, current.borrowers],
    [t('backup.countLoans'), backup.loans, current.loans],
    [t('backup.countPayments'), backup.payments, current.payments],
    [t('backup.countCash'), backup.cashEntries, current.cashEntries],
  ];
  return (
    <View className="gap-2">
      <View className="flex-row">
        <Text className="flex-1 text-sm text-slate-500 dark:text-slate-400"> </Text>
        <Text className="w-24 text-right text-sm font-semibold text-slate-600 dark:text-slate-300">
          {t('backup.inBackup')}
        </Text>
        <Text className="w-24 text-right text-sm font-semibold text-slate-600 dark:text-slate-300">
          {t('backup.onThisPhone')}
        </Text>
      </View>
      {rows.map(([label, inBackup, onPhone]) => (
        <View key={label} className="flex-row">
          <Text className="flex-1 text-base text-slate-700 dark:text-slate-200">{label}</Text>
          <Text className="w-24 text-right text-base font-bold text-slate-900 dark:text-white">{inBackup}</Text>
          <Text className="w-24 text-right text-base text-slate-600 dark:text-slate-300">{onPhone}</Text>
        </View>
      ))}
    </View>
  );
}
