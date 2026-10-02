import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { SegmentedControl } from '@/components/SegmentedControl';
import { resetDatabase } from '@/db/migrations';
import { t, type TranslationKey } from '@/i18n';
import {
  clearAppLockSettings,
  getAppLockSettings,
  getLockStatus,
  LOCK_GRACE_OPTIONS,
  setAppLockEnabled,
  setLockGraceSeconds,
  unlockWithDevice,
  useAppLockSettings,
} from '@/lib/appLock';
import { showError } from '@/lib/errors';
import { useThemeColors } from '@/lib/theme';
import { CURRENCIES, resetAppState, useAppState } from '@/store/app-state';

const GRACE_LABELS: Record<(typeof LOCK_GRACE_OPTIONS)[number], TranslationKey> = {
  0: 'settings.lockAfterImmediately',
  30: 'settings.lockAfter30s',
  60: 'settings.lockAfter1m',
  300: 'settings.lockAfter5m',
};

function confirmReset(db: SQLiteDatabase) {
  Alert.alert(
    'Reset the app?',
    'This will permanently erase ALL borrowers, loans, and schedules, plus your business profile and settings, and take you back to the start (onboarding and setup).',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          // With App Lock on, only the phone's owner may wipe the data.
          const { enabled } = getAppLockSettings();
          if (enabled && (await getLockStatus()).hasScreenLock) {
            if ((await unlockWithDevice()) !== 'success') {
              Alert.alert(t('settings.resetAuthFailedTitle'), t('settings.resetAuthFailedMessage'));
              return;
            }
          }
          try {
            // Wipe the database first: if that fails, the profile is kept and nothing changes.
            await resetDatabase(db);
          } catch (error) {
            showError('Could not reset (your data was not changed)', error);
            return;
          }
          // Next launch decides App Lock again, like a fresh install.
          clearAppLockSettings();
          // No router.replace needed: the root layout guards close (tabs) and send the user
          // back to onboarding as soon as the profile is cleared, removing tabs from history.
          resetAppState();
        },
      },
    ],
  );
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const { profile } = useAppState();
  const lock = useAppLockSettings();
  const [hasScreenLock, setHasScreenLock] = useState<boolean | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  // Re-check every time Settings is shown: the user may have changed the phone's screen lock.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLockStatus().then((s) => active && setHasScreenLock(s.hasScreenLock));
      return () => {
        active = false;
      };
    }, []),
  );

  if (!profile) return null;

  const symbol = CURRENCIES.find((c) => c.code === profile.currency)?.symbol ?? '';
  const lockEnabled = lock.enabled === true;

  const onToggleLock = async (turnOn: boolean) => {
    if (lockBusy) return;
    setLockBusy(true);
    try {
      const status = await getLockStatus();
      setHasScreenLock(status.hasScreenLock);

      if (turnOn) {
        if (!status.hasScreenLock) {
          Alert.alert(t('settings.noScreenLockTitle'), t('settings.noScreenLockMessage'));
          return;
        }
        // Test it once before relying on it, so nobody locks themselves out.
        if ((await unlockWithDevice()) === 'success') setAppLockEnabled(true);
        else Alert.alert(t('settings.enableFailedTitle'), t('settings.authFailedMessage'));
        return;
      }

      // Turning off needs the owner too, unless the phone has no lock left to check with.
      if (!status.hasScreenLock || (await unlockWithDevice()) === 'success') {
        setAppLockEnabled(false);
      } else {
        Alert.alert(t('settings.disableFailedTitle'), t('settings.authFailedMessage'));
      }
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerClassName="gap-6 p-6">
      <Section title="Business Profile">
        <Row label="Name" value={profile.businessName} />
        <Row label="Currency" value={`${symbol} ${profile.currency}`} />
        <Row
          label="Balda Penalty"
          value={
            profile.baldaPenaltyEnabled
              ? `${symbol}${profile.baldaPenaltyAmount.toFixed(2)} / day`
              : 'Off'
          }
        />
      </Section>

      <Section title={t('settings.appLockSection')}>
        {lockEnabled && hasScreenLock === false && (
          <View className="flex-row gap-3 rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
            <Ionicons name="warning" size={22} color="#d97706" />
            <Text className="flex-1 text-base text-amber-900 dark:text-amber-100">
              {t('settings.screenLockRemovedBanner')}
            </Text>
          </View>
        )}

        <View className="min-h-12 flex-row items-center justify-between gap-4">
          <View className="flex-1 gap-1">
            <Text className="text-base text-slate-900 dark:text-white">
              {t('settings.requireUnlock')}
            </Text>
            <Text className="text-sm text-slate-600 dark:text-slate-400">
              {t('settings.requireUnlockHint')}
            </Text>
          </View>
          <Switch
            value={lockEnabled}
            onValueChange={onToggleLock}
            disabled={lockBusy}
            trackColor={{ true: colors.primary, false: '#cbd5e1' }}
            thumbColor="#ffffff"
          />
        </View>

        {lockEnabled && (
          <View className="gap-2">
            <SegmentedControl
              label={t('settings.lockAfter')}
              value={String(lock.graceSeconds)}
              onChange={(v) => setLockGraceSeconds(Number(v))}
              options={LOCK_GRACE_OPTIONS.map((seconds) => ({
                value: String(seconds),
                label: t(GRACE_LABELS[seconds]),
              }))}
            />
            <Text className="text-sm text-slate-600 dark:text-slate-400">
              {t('settings.lockAfterHint')}
            </Text>
          </View>
        )}
      </Section>

      <Section title="App">
        <Pressable
          onPress={() => router.push('/intro')}
          accessibilityRole="button"
          className="min-h-12 flex-row items-center gap-3 active:opacity-60">
          <Ionicons name="book-outline" size={22} color={colors.primary} />
          <View className="flex-1 gap-1">
            <Text className="text-base text-slate-900 dark:text-white">
              {t('settings.viewIntroAgain')}
            </Text>
            <Text className="text-sm text-slate-600 dark:text-slate-400">
              {t('settings.viewIntroAgainHint')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </Section>

      <Pressable
        onPress={() => confirmReset(db)}
        className="items-center rounded-2xl border border-red-300 bg-white py-4 active:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:active:bg-red-950">
        <Text className="text-base font-semibold text-red-600 dark:text-red-400">Reset app</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">
        {title}
      </Text>
      <View className="gap-4 rounded-2xl bg-white p-5 dark:bg-slate-900">{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-base text-slate-600 dark:text-slate-300">{label}</Text>
      <Text className="flex-shrink text-right text-base font-semibold text-slate-900 dark:text-white">
        {value}
      </Text>
    </View>
  );
}
