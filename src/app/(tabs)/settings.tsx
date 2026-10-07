import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { lastBackupText } from '@/components/backup/backup-text';
import { FormField } from '@/components/FormField';
import { useTabBarInset } from '@/components/navigation/FloatingTabBar';
import { ReceiptSheet } from '@/components/receipts/ReceiptSheet';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Stepper } from '@/components/Stepper';
import { countRows } from '@/db/backup';
import { getCashSetup, type CashSetup } from '@/db/cash';
import { getLatestActivePaymentId } from '@/db/documents';
import { resetDatabase } from '@/db/migrations';
import { t, type TranslationKey } from '@/i18n';
import {
  clearAppLockSettings,
  confirmOwner,
  getLockStatus,
  LOCK_GRACE_OPTIONS,
  setAppLockEnabled,
  setLockGraceSeconds,
  unlockWithDevice,
  useAppLockSettings,
} from '@/lib/appLock';
import { hasData, isBackupStale } from '@/lib/backup';
import { showError } from '@/lib/errors';
import { formatDisplayDate } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { FLAG_THRESHOLD_LIMITS, validateThresholds, type FlagThresholds } from '@/lib/flags';
import { sampleReceiptData } from '@/lib/receipt';
import { useThemeColors } from '@/lib/theme';
import {
  CURRENCIES,
  resetAppState,
  setDefaultSettlementMode,
  useAppState,
  type DefaultSettlementMode,
} from '@/store/app-state';
import { wipeBackupFiles } from '@/services/backup';
import { clearAreaOrder } from '@/store/area-order';
import { clearBackupState, getBackupStatus, useBackupStatus } from '@/store/backup-state';
import { clearCollectionPrefs } from '@/store/collection-prefs';
import { clearEodPrefs } from '@/store/eodPrefs';
import {
  clearDocumentSettings,
  FOOTER_NOTE_MAX_LENGTH,
  setBusinessAddress,
  setBusinessPhone,
  setFooterNote,
  setShowBalance,
  useDocumentSettings,
} from '@/store/document-settings';
import {
  clearAppearanceSetting,
  setAppearanceSetting,
  useAppearanceSetting,
  type AppearanceSetting,
} from '@/store/appearance';
import { clearFlagSettings, setFlagThresholds, useFlagThresholds } from '@/store/flag-settings';
import { clearLoanViewPref } from '@/store/loan-view-prefs';

const GRACE_LABELS: Record<(typeof LOCK_GRACE_OPTIONS)[number], TranslationKey> = {
  0: 'settings.lockAfterImmediately',
  30: 'settings.lockAfter30s',
  60: 'settings.lockAfter1m',
  300: 'settings.lockAfter5m',
};

/**
 * Reset entry point: with data on the phone and no recent backup, warn first and offer
 * "Back up first" before the usual confirmation.
 */
async function startReset(db: SQLiteDatabase) {
  let needsWarning = false;
  try {
    const status = getBackupStatus();
    needsWarning =
      hasData(await countRows(db)) && isBackupStale(status.lastBackupAt, status.reminderDays, new Date());
  } catch (error) {
    console.error('[Reset pre-check failed]', error);
    needsWarning = true;
  }
  if (!needsWarning) {
    confirmReset(db);
    return;
  }
  Alert.alert(t('backup.resetWarnTitle'), t('backup.resetWarnMessage'), [
    { text: t('backup.cancel'), style: 'cancel' },
    { text: t('backup.backUpFirst'), onPress: () => router.push('/backup') },
    { text: t('backup.resetAnyway'), style: 'destructive', onPress: () => confirmReset(db) },
  ]);
}

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
          if (!(await confirmOwner())) {
            Alert.alert(t('settings.resetAuthFailedTitle'), t('settings.resetAuthFailedMessage'));
            return;
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
          // Balda flag thresholds back to the defaults (3 and 7 days).
          clearFlagSettings();
          // Last-backup info, reminder, restore marker, safety backups and temp files.
          clearBackupState();
          wipeBackupFiles();
          // Collection tab's Group by / Within an area preferences (not part of any backup).
          clearCollectionPrefs();
          // Route order (area order is whitelisted in backups, but Reset wipes it like everything else).
          clearAreaOrder();
          // End of Day report options and remembered counted-cash values (not part of any backup).
          clearEodPrefs();
          // Receipt/statement settings (footer note, business phone/address, toggles, paper size).
          clearDocumentSettings();
          // Loan detail's Schedule|Calendar preference (not part of any backup).
          clearLoanViewPref();
          // Appearance (Light/Dark/System) back to the default, Light (not part of any backup).
          clearAppearanceSetting();
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
  const tabBarInset = useTabBarInset();
  const { profile } = useAppState();
  const lock = useAppLockSettings();
  const [hasScreenLock, setHasScreenLock] = useState<boolean | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [cashSetup, setCashSetup] = useState<CashSetup | null>(null);

  // Re-check every time Settings is shown: the user may have changed the phone's screen lock.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLockStatus().then((s) => active && setHasScreenLock(s.hasScreenLock));
      getCashSetup(db)
        .then((c) => active && setCashSetup(c))
        .catch((error) => console.error('[Load cash setup failed]', error));
      return () => {
        active = false;
      };
    }, [db]),
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
      contentContainerClassName="gap-6 p-6"
      contentContainerStyle={{ paddingBottom: tabBarInset }}>
      <Section title={t('settings.appearanceSection')}>
        <AppearanceSettingsRows />
      </Section>

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
            <Ionicons name="warning" size={22} color={colors.warning} />
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
            trackColor={{ true: colors.primary, false: colors.switchTrackOff }}
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

      <Section title={t('settlement.settingsSection')}>
        <Text className="text-sm text-slate-600 dark:text-slate-400">
          {t('settlement.settingsHint')}
        </Text>
        {(
          [
            { mode: 'full', title: 'settlement.settingsFull', hint: 'settlement.settingsFullHint' },
            {
              mode: 'prorata',
              title: 'settlement.settingsProrata',
              hint: 'settlement.settingsProrataHint',
            },
          ] as const satisfies readonly {
            mode: DefaultSettlementMode;
            title: TranslationKey;
            hint: TranslationKey;
          }[]
        ).map((option) => {
          const selected = profile.settlementMode === option.mode;
          return (
            <Pressable
              key={option.mode}
              onPress={() => setDefaultSettlementMode(option.mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="min-h-14 flex-row items-start gap-3 active:opacity-70">
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={24}
                color={selected ? colors.primary : colors.textMuted}
                style={{ marginTop: 1 }}
              />
              <View className="flex-1 gap-0.5">
                <Text className="text-base font-semibold text-slate-900 dark:text-white">
                  {t(option.title)}
                </Text>
                <Text className="text-sm text-slate-600 dark:text-slate-400">{t(option.hint)}</Text>
              </View>
            </Pressable>
          );
        })}
      </Section>

      <Section title={t('cash.settingsSection')}>
        {cashSetup === null ? null : cashSetup.isSetUp ? (
          <>
            <Row label={t('cash.settingsStatus')} value={t('cash.settingsOn')} />
            <Row label={t('cash.openingLabel')} value={formatPeso(cashSetup.openingAmount)} />
            <Row
              label={t('cash.startDateLabel')}
              value={formatDisplayDate(cashSetup.ledgerStartDate!)}
            />
            <Pressable
              onPress={() => router.push({ pathname: '/cash/setup', params: { mode: 'adjust' } })}
              accessibilityRole="button"
              className="min-h-12 flex-row items-center gap-3 active:opacity-60">
              <Ionicons name="create-outline" size={22} color={colors.primary} />
              <Text className="flex-1 text-base text-slate-900 dark:text-white">
                {t('cash.adjustTitle')}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/cash')}
              accessibilityRole="button"
              className="min-h-12 flex-row items-center gap-3 active:opacity-60">
              <Ionicons name="wallet-outline" size={22} color={colors.primary} />
              <Text className="flex-1 text-base text-slate-900 dark:text-white">
                {t('cash.openCash')}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
          </>
        ) : (
          <>
            <Row label={t('cash.settingsStatus')} value={t('cash.settingsOff')} />
            <Pressable
              onPress={() => router.push('/cash/setup')}
              accessibilityRole="button"
              className="min-h-12 items-center justify-center rounded-xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
              <Text className="text-base font-bold text-white">{t('cash.setupButton')}</Text>
            </Pressable>
          </>
        )}
      </Section>

      <Section title={t('flags.settingsSection')}>
        <BaldaFlagSettings />
      </Section>

      <Section title={t('backup.settingsSection')}>
        <BackupSettingsRows />
      </Section>

      <Section title={t('areas.settingsSection')}>
        <Pressable
          onPress={() => router.push('/areas')}
          accessibilityRole="button"
          className="min-h-12 flex-row items-center gap-3 active:opacity-60">
          <Ionicons name="map-outline" size={22} color={colors.primary} />
          <View className="flex-1 gap-1">
            <Text className="text-base text-slate-900 dark:text-white">{t('areas.manage')}</Text>
            <Text className="text-sm text-slate-600 dark:text-slate-400">{t('areas.manageHint')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </Section>

      <Section title={t('presets.settingsSection')}>
        <Pressable
          onPress={() => router.push('/presets')}
          accessibilityRole="button"
          className="min-h-12 flex-row items-center gap-3 active:opacity-60">
          <Ionicons name="bookmark-outline" size={22} color={colors.primary} />
          <View className="flex-1 gap-1">
            <Text className="text-base text-slate-900 dark:text-white">{t('presets.manage')}</Text>
            <Text className="text-sm text-slate-600 dark:text-slate-400">{t('presets.manageHint')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </Section>

      <Section title={t('receipts.settingsSection')}>
        <ReceiptSettingsRows />
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
        onPress={() => startReset(db)}
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

function daysText(count: number) {
  return count === 1 ? t('flags.oneDay') : t('flags.days', { count });
}

const APPEARANCE_OPTIONS: {
  value: AppearanceSetting;
  label: TranslationKey;
  swatch: readonly [string, string];
}[] = [
  { value: 'light', label: 'settings.appearanceLight', swatch: ['#ffffff', '#0f172a'] },
  { value: 'dark', label: 'settings.appearanceDark', swatch: ['#0f172a', '#ffffff'] },
  { value: 'system', label: 'settings.appearanceSystem', swatch: ['#ffffff', '#0f172a'] },
];

/** Applies instantly (src/store/appearance.ts); each option shows a small background/text swatch. */
function AppearanceSettingsRows() {
  const active = useAppearanceSetting();

  return (
    <View className="flex-row gap-3">
      {APPEARANCE_OPTIONS.map((option) => {
        const selected = active === option.value;
        const [swatchBg, swatchFg] = option.swatch;
        return (
          <Pressable
            key={option.value}
            onPress={() => setAppearanceSetting(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            className={
              selected
                ? 'flex-1 items-center gap-2 rounded-2xl border-2 border-teal-600 bg-teal-50 p-3 dark:border-teal-400 dark:bg-teal-950'
                : 'flex-1 items-center gap-2 rounded-2xl border border-slate-200 p-3 active:opacity-70 dark:border-slate-700'
            }>
            {option.value === 'system' ? (
              <View className="h-10 w-10 flex-row overflow-hidden rounded-full border border-slate-300 dark:border-slate-600">
                <View className="flex-1" style={{ backgroundColor: '#ffffff' }} />
                <View className="flex-1" style={{ backgroundColor: '#0f172a' }} />
              </View>
            ) : (
              <View
                className="h-10 w-10 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600"
                style={{ backgroundColor: swatchBg }}>
                <View className="h-3 w-3 rounded-full" style={{ backgroundColor: swatchFg }} />
              </View>
            )}
            <Text
              className={
                selected
                  ? 'text-sm font-bold text-teal-800 dark:text-teal-200'
                  : 'text-sm font-semibold text-slate-700 dark:text-slate-200'
              }>
              {t(option.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Two steppers. A change is saved right away when the pair is valid (1 ≤ flag < critical ≤ 60);
 * otherwise the draft stays on screen with an inline error and nothing is saved.
 */
function BaldaFlagSettings() {
  const saved = useFlagThresholds();
  const [draft, setDraft] = useState<FlagThresholds>(saved);
  const error = validateThresholds(draft);

  const change = (next: FlagThresholds) => {
    setDraft(next);
    setFlagThresholds(next); // ignored (returns false) while invalid
  };

  return (
    <>
      <Text className="text-sm text-slate-600 dark:text-slate-400">{t('flags.settingsHint')}</Text>
      <Stepper
        label={t('flags.flagAfter')}
        value={draft.flagAfter}
        valueText={daysText(draft.flagAfter)}
        min={FLAG_THRESHOLD_LIMITS.min}
        max={FLAG_THRESHOLD_LIMITS.max}
        invalid={error !== null}
        onChange={(flagAfter) => change({ ...draft, flagAfter })}
      />
      <Stepper
        label={t('flags.criticalAfter')}
        value={draft.criticalAfter}
        valueText={daysText(draft.criticalAfter)}
        min={FLAG_THRESHOLD_LIMITS.min}
        max={FLAG_THRESHOLD_LIMITS.max}
        invalid={error !== null}
        onChange={(criticalAfter) => change({ ...draft, criticalAfter })}
      />
      {error && (
        <Text className="text-base font-semibold text-red-600 dark:text-red-400">
          {error === 'order' ? t('flags.errorOrder') : t('flags.errorRange')}
        </Text>
      )}
      <Text className="text-sm text-slate-600 dark:text-slate-400">
        {t('flags.settingsSummary', {
          late: daysText(1),
          flag: daysText(saved.flagAfter),
          critical: daysText(saved.criticalAfter),
        })}
      </Text>
    </>
  );
}

function BackupSettingsRows() {
  const colors = useThemeColors();
  const status = useBackupStatus();
  return (
    <>
      <View className="gap-1">
        <Text className="text-base text-slate-600 dark:text-slate-300">{t('backup.lastBackupLabel')}</Text>
        <Text
          className={
            status.lastBackupAt === null
              ? 'text-base font-semibold text-amber-700 dark:text-amber-300'
              : 'text-base font-semibold text-slate-900 dark:text-white'
          }>
          {lastBackupText(status.lastBackupAt)}
        </Text>
      </View>
      {(
        [
          { icon: 'cloud-upload-outline', label: 'backup.openBackup', href: '/backup' },
          { icon: 'refresh-circle-outline', label: 'backup.restoreButton', href: '/backup/restore' },
          { icon: 'document-text-outline', label: 'backup.exportCsv', href: '/backup/export' },
        ] as const
      ).map((row) => (
        <Pressable
          key={row.href}
          onPress={() => router.push(row.href)}
          accessibilityRole="button"
          className="min-h-12 flex-row items-center gap-3 active:opacity-60">
          <Ionicons name={row.icon} size={22} color={colors.primary} />
          <Text className="flex-1 text-base text-slate-900 dark:text-white">{t(row.label)}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      ))}
    </>
  );
}

/**
 * Footer note / business phone / business address are edited as local drafts and saved onBlur
 * (not on every keystroke): saving mid-typing would trim/slice the value under the user's cursor.
 */
function ReceiptSettingsRows() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const { profile } = useAppState();
  const settings = useDocumentSettings();
  const [footerDraft, setFooterDraft] = useState(settings.footerNote ?? '');
  const [phoneDraft, setPhoneDraft] = useState(settings.businessPhone ?? '');
  const [addressDraft, setAddressDraft] = useState(settings.businessAddress ?? '');
  const [previewPaymentId, setPreviewPaymentId] = useState<number | null>(null);
  const [previewSample, setPreviewSample] = useState<ReturnType<typeof sampleReceiptData> | null>(
    null,
  );

  const openPreview = async () => {
    try {
      const latest = await getLatestActivePaymentId(db);
      if (latest) setPreviewPaymentId(latest);
      else setPreviewSample(sampleReceiptData(profile?.businessName ?? ''));
    } catch (error) {
      showError(t('receipts.generateFailed'), error);
    }
  };

  return (
    <>
      <FormField
        label={t('receipts.footerNoteLabel')}
        hint={t('receipts.footerNoteHint')}
        value={footerDraft}
        onChangeText={setFooterDraft}
        onBlur={() => setFooterNote(footerDraft)}
        maxLength={FOOTER_NOTE_MAX_LENGTH}
        multiline
      />
      <FormField
        label={t('receipts.businessPhoneLabel')}
        value={phoneDraft}
        onChangeText={setPhoneDraft}
        onBlur={() => setBusinessPhone(phoneDraft)}
        keyboardType="phone-pad"
      />
      <FormField
        label={t('receipts.businessAddressLabel')}
        value={addressDraft}
        onChangeText={setAddressDraft}
        onBlur={() => setBusinessAddress(addressDraft)}
        multiline
      />
      <View className="min-h-12 flex-row items-center justify-between gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-base text-slate-900 dark:text-white">
            {t('receipts.showBalanceLabel')}
          </Text>
          <Text className="text-sm text-slate-600 dark:text-slate-400">
            {t('receipts.showBalanceHint')}
          </Text>
        </View>
        <Switch
          value={settings.showBalance}
          onValueChange={setShowBalance}
          trackColor={{ true: colors.primary, false: colors.switchTrackOff }}
          thumbColor="#ffffff"
        />
      </View>
      <Pressable
        onPress={openPreview}
        accessibilityRole="button"
        className="min-h-12 items-center justify-center rounded-xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
        <Text className="text-base font-bold text-white">{t('receipts.preview')}</Text>
      </Pressable>
      <ReceiptSheet
        paymentId={previewPaymentId}
        sampleData={previewSample}
        onClose={() => {
          setPreviewPaymentId(null);
          setPreviewSample(null);
        }}
      />
    </>
  );
}
