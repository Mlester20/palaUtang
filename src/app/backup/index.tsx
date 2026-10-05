import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dataErrorText, runBackupFlow } from '@/components/backup/backup-actions';
import { countsText, lastBackupText } from '@/components/backup/backup-text';
import { SegmentedControl } from '@/components/SegmentedControl';
import { t } from '@/i18n';
import { localStamp, REMINDER_DAY_OPTIONS } from '@/lib/backup';
import { useThemeColors } from '@/lib/theme';
import {
  canSaveToFolder,
  deleteSafetyBackup,
  listSafetyBackups,
  shareSafetyBackup,
  type SafetyBackupInfo,
} from '@/services/backup';
import { setReminderDays, useBackupStatus, useDataOperation } from '@/store/backup-state';

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Settings → Backup & data. */
export default function BackupScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const status = useBackupStatus();
  const operation = useDataOperation();
  const busy = operation !== null;
  const [safety, setSafety] = useState<SafetyBackupInfo[]>([]);

  const loadSafety = useCallback(() => {
    try {
      setSafety(listSafetyBackups());
    } catch (error) {
      console.error('[List safety backups failed]', error);
    }
  }, []);

  useFocusEffect(loadSafety);

  const backUp = async (target: 'share' | 'folder') => {
    if (busy) return;
    await runBackupFlow(db, target);
  };

  const removeSafety = (item: SafetyBackupInfo) =>
    Alert.alert(t('backup.deleteSafetyTitle'), t('backup.deleteSafetyMessage', { name: item.name }), [
      { text: t('backup.cancel'), style: 'cancel' },
      {
        text: t('backup.delete'),
        style: 'destructive',
        onPress: () => {
          deleteSafetyBackup(item.name);
          loadSafety();
        },
      },
    ]);

  const share = async (item: SafetyBackupInfo) => {
    try {
      await shareSafetyBackup(item.uri);
    } catch (error) {
      Alert.alert(t('backup.failedTitle'), dataErrorText(error));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerClassName="gap-5 p-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      {/* Status */}
      <View className="gap-2 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          {t('backup.lastBackupLabel')}
        </Text>
        <Text
          className={
            status.lastBackupAt === null
              ? 'text-lg font-bold text-amber-700 dark:text-amber-300'
              : 'text-lg font-bold text-slate-900 dark:text-white'
          }>
          {lastBackupText(status.lastBackupAt)}
        </Text>
        {status.lastBackupCounts && (
          <Text className="text-sm text-slate-600 dark:text-slate-400">
            {countsText(status.lastBackupCounts)}
          </Text>
        )}
        <Text className="text-xs text-slate-500 dark:text-slate-400">{t('backup.honestyNote')}</Text>
      </View>

      <View className="gap-3">
        <BigButton
          icon="cloud-upload-outline"
          label={t('backup.backUpNow')}
          hint={t('backup.backUpNowHint')}
          onPress={() => backUp('share')}
          busy={operation === 'backup'}
          disabled={busy}
          primary
        />
        {canSaveToFolder && (
          <BigButton
            icon="folder-open-outline"
            label={t('backup.saveToFolder')}
            hint={t('backup.saveToFolderHint')}
            onPress={() => backUp('folder')}
            disabled={busy}
          />
        )}
        <BigButton
          icon="refresh-circle-outline"
          label={t('backup.restoreButton')}
          hint={t('backup.restoreHint')}
          onPress={() => router.push('/backup/restore')}
          disabled={busy}
        />
        <BigButton
          icon="document-text-outline"
          label={t('backup.exportCsv')}
          hint={t('backup.exportCsvHint')}
          onPress={() => router.push('/backup/export')}
          disabled={busy}
        />
      </View>

      {/* Reminder */}
      <View className="gap-3 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <SegmentedControl
          label={t('backup.reminderLabel')}
          value={String(status.reminderDays)}
          onChange={(v) => setReminderDays(Number(v))}
          options={REMINDER_DAY_OPTIONS.map((d) => ({
            value: String(d),
            label: d === 0 ? t('backup.reminderOff') : t('backup.reminderDays', { count: d }),
          }))}
        />
        <Text className="text-sm text-slate-600 dark:text-slate-400">{t('backup.reminderHint')}</Text>
      </View>

      {/* Safety backups */}
      <View className="gap-3">
        <Text className="px-1 text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">
          {t('backup.safetyTitle')}
        </Text>
        <Text className="px-1 text-sm text-slate-600 dark:text-slate-400">{t('backup.safetyHint')}</Text>
        {safety.length === 0 ? (
          <Text className="rounded-2xl bg-white p-4 text-base text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            {t('backup.safetyNone')}
          </Text>
        ) : (
          safety.map((item) => (
            <View key={item.name} className="gap-2 rounded-2xl bg-white p-4 dark:bg-slate-900">
              <Text className="text-base font-semibold text-slate-900 dark:text-white" numberOfLines={1}>
                {item.modifiedAt ? localStamp(new Date(item.modifiedAt)) : item.name}
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">{sizeText(item.size)}</Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => share(item)}
                  disabled={busy}
                  accessibilityRole="button"
                  className="min-h-12 flex-1 items-center justify-center rounded-xl border border-teal-700 active:opacity-70 dark:border-teal-400">
                  <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
                    {t('backup.share')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => removeSafety(item)}
                  disabled={busy}
                  accessibilityRole="button"
                  className="min-h-12 flex-1 items-center justify-center rounded-xl border border-red-300 active:opacity-70 dark:border-red-900">
                  <Text className="text-base font-semibold text-red-600 dark:text-red-400">
                    {t('backup.delete')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function BigButton({
  icon,
  label,
  hint,
  onPress,
  disabled,
  busy,
  primary,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      className={`min-h-16 flex-row items-center gap-3 rounded-2xl px-4 py-3 ${
        primary ? 'bg-teal-700 dark:bg-teal-600' : 'bg-white dark:bg-slate-900'
      } ${disabled ? 'opacity-50' : 'active:opacity-70'}`}>
      {busy ? (
        <ActivityIndicator color={primary ? '#ffffff' : colors.primary} />
      ) : (
        <Ionicons name={icon} size={26} color={primary ? '#ffffff' : colors.primary} />
      )}
      <View className="flex-1 gap-0.5">
        <Text className={primary ? 'text-lg font-bold text-white' : 'text-lg font-bold text-slate-900 dark:text-white'}>
          {label}
        </Text>
        <Text className={primary ? 'text-sm text-teal-50' : 'text-sm text-slate-600 dark:text-slate-400'}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}
