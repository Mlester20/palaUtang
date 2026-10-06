import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lastBackupText } from '@/components/backup/backup-text';
import { CashSetupCard } from '@/components/cash/CashSetupCard';
import { collectionChip } from '@/components/collection/collection-chip';
import {
  BackupReminderCard,
  CashCard,
  DueTodayRow,
  FlaggedBorrowerRow,
  HeroCollectionCard,
  InitialsAvatar,
  QuickActionButton,
  SectionHeader,
  SkeletonBlock,
  StatCard,
  WeeklyEarningsCard,
} from '@/components/dashboard';
import { flagChipLabel, lastPaidText } from '@/components/flags/flag-text';
import type { DashboardSnapshot } from '@/db/dashboard';
import { useDashboard } from '@/hooks/use-dashboard';
import { t, type TranslationKey } from '@/i18n';
import { REMINDER_SNOOZE_MS, shouldShowBackupReminder } from '@/lib/backup';
import { callPhone } from '@/lib/call';
import { groupCollection, progressPercent } from '@/lib/collection';
import { formatLongDate, mondayFirstDayIndex } from '@/lib/date';
import type { FlagThresholds } from '@/lib/flags';
import { parseYmd, todayYmd } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';
import { useAppState } from '@/store/app-state';
import { dismissReminderUntil, useBackupStatus } from '@/store/backup-state';
import type { DailyEarning, DueTodayItem } from '@/types/dashboard';

const ATTENTION_LIMIT = 5;
const DUE_TODAY_LIMIT = 5;
const WEEKDAY_KEYS: TranslationKey[] = [
  'dashboard.weekdays.mon',
  'dashboard.weekdays.tue',
  'dashboard.weekdays.wed',
  'dashboard.weekdays.thu',
  'dashboard.weekdays.fri',
  'dashboard.weekdays.sat',
  'dashboard.weekdays.sun',
];

const openFlaggedBorrowers = () =>
  router.navigate({ pathname: '/borrowers', params: { filter: 'flagged' } });

/** Overdue first (most overdue on top), then due today / partial — the Collection tab order. */
function dueTodayItems(data: DashboardSnapshot, thresholds: FlagThresholds): DueTodayItem[] {
  const { overdue, dueToday } = groupCollection(data.collection);
  return [...overdue, ...dueToday].slice(0, DUE_TODAY_LIMIT).map((row) => {
    const chip = collectionChip(row, data.today, thresholds);
    return {
      id: String(row.loanId),
      borrowerName: row.borrowerName,
      amountDueCentavos: row.toCollect,
      chipLabel: chip.label,
      chipTone: chip.tone,
    };
  });
}

function weekBars(data: DashboardSnapshot): DailyEarning[] {
  return data.week.map((d, i) => ({ day: t(WEEKDAY_KEYS[i]!), amountCentavos: d.cashCollected }));
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { profile } = useAppState();
  const { data, error, refreshing, refresh, thresholds } = useDashboard();
  if (!profile) return null;

  const today = parseYmd(data?.today ?? todayYmd());

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
          progressViewOffset={insets.top}
        />
      }>
      {/* The tab header is hidden on Home, so the greeting clears the status bar itself. */}
      <View className="gap-7 px-5 pb-10" style={{ paddingTop: insets.top + 16 }}>
        {/* 1. Header */}
        <View className="flex-row items-center gap-4">
          <View className="flex-1 gap-1">
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {formatLongDate(today)}
            </Text>
            <Text className="text-2xl font-bold text-slate-900 dark:text-white" numberOfLines={2}>
              {t('dashboard.greeting', { name: profile.businessName })}
            </Text>
          </View>
          <InitialsAvatar name={profile.businessName} size="lg" />
        </View>

        {error && (
          <View className="rounded-xl bg-red-50 p-4 dark:bg-red-950">
            <Text className="text-base text-red-700 dark:text-red-300">
              {t('dashboard.loadFailed')}
            </Text>
          </View>
        )}

        {data === null ? (
          !error && <DashboardSkeleton />
        ) : (
          <Dashboard data={data} thresholds={thresholds} highlightIndex={mondayFirstDayIndex(today)} />
        )}
      </View>
    </ScrollView>
  );
}

function Dashboard({
  data,
  thresholds,
  highlightIndex,
}: {
  data: DashboardSnapshot;
  thresholds: FlagThresholds;
  highlightIndex: number;
}) {
  const { summary, stats, flagged } = data;
  const dueToday = dueTodayItems(data, thresholds);
  const backup = useBackupStatus();
  const now = new Date();
  const showBackupReminder = shouldShowBackupReminder({
    now,
    hasAnyData: stats.borrowerCount > 0 || stats.loanCount > 0,
    reminderDays: backup.reminderDays,
    lastBackupAt: backup.lastBackupAt,
    dismissedUntil: backup.reminderDismissedUntil,
  });

  return (
    <>
      {stats.loanCount === 0 && <GetStartedCard hasBorrowers={stats.borrowerCount > 0} />}

      {showBackupReminder && (
        <BackupReminderCard
          message={lastBackupText(backup.lastBackupAt, now)}
          onBackup={() => router.push('/backup')}
          onDismiss={() => dismissReminderUntil(Date.now() + REMINDER_SNOOZE_MS)}
        />
      )}

      {/* 2. Today's collection — the same summary function as the Collection tab */}
      <HeroCollectionCard
        title={t('dashboard.heroTitle')}
        expectedCentavos={summary.expectedToday}
        collectedCentavos={summary.collectedToday}
        remainingCentavos={summary.remaining}
        percent={progressPercent(summary)}
        paidCount={summary.paidCount}
        totalCount={summary.totalCount}
      />

      {/* 3. Stats grid */}
      <View className="gap-3">
        <View className="flex-row gap-3">
          <StatCard
            icon="people"
            label={t('dashboard.statActiveBorrowers')}
            value={String(stats.activeBorrowers)}
          />
          <StatCard
            icon="document-text"
            label={t('dashboard.statActiveLoans')}
            value={String(stats.activeLoans)}
          />
        </View>
        <View className="flex-row gap-3">
          <StatCard
            icon="alert-circle"
            label={t('dashboard.statBalda')}
            value={String(flagged.length)}
            tone={flagged.length > 0 ? 'warning' : 'default'}
            onPress={openFlaggedBorrowers}
          />
          <StatCard
            icon="wallet"
            label={t('dashboard.statOutstanding')}
            value={formatPeso(stats.outstanding)}
            secondary={t('dashboard.statPrincipalOut', {
              amount: formatPeso(stats.principalOutstanding),
            })}
          />
        </View>
      </View>

      {/* Cash: on hand + today's money out (setup card until cash tracking starts) */}
      {data.cash.cashOnHand === null ? (
        <CashSetupCard compact />
      ) : (
        <CashCard
          cashOnHandCentavos={data.cash.cashOnHand}
          withdrawnTodayCentavos={data.cash.withdrawalsToday}
          expensesTodayCentavos={data.cash.expensesToday}
          onPress={() => router.push('/cash')}
        />
      )}

      {/* 4. Needs attention: Flagged and Critical only */}
      <View className="gap-1">
        <SectionHeader
          title={t('dashboard.needsAttention')}
          actionLabel={flagged.length > 0 ? t('dashboard.seeAll') : undefined}
          onAction={openFlaggedBorrowers}
        />
        {flagged.length === 0 ? (
          <View className="flex-row items-center gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <Ionicons name="checkmark-circle" size={28} color="#16a34a" />
            <View className="flex-1 gap-0.5">
              <Text className="text-base font-semibold text-slate-900 dark:text-white">
                {t('dashboard.noFlaggedTitle')}
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">
                {t('dashboard.noFlaggedMessage', { days: thresholds.flagAfter })}
              </Text>
            </View>
          </View>
        ) : (
          <View className="rounded-2xl bg-white px-4 dark:bg-slate-900">
            {flagged.slice(0, ATTENTION_LIMIT).map((flag, i) => {
              const phone = flag.phone;
              return (
                <View
                  key={flag.borrowerId}
                  className={i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : undefined}>
                  <FlaggedBorrowerRow
                    name={flag.borrowerName}
                    nickname={flag.nickname}
                    area={flag.area}
                    phone={phone}
                    chipLabel={flagChipLabel(flag)}
                    chipTone={flag.severity === 'critical' ? 'critical' : 'flagged'}
                    totalOverdueCentavos={flag.totalOverdue}
                    lastPaidText={lastPaidText(flag.daysSinceLastPayment)}
                    onPress={() =>
                      router.push({
                        pathname: '/borrower/[id]',
                        params: { id: String(flag.borrowerId) },
                      })
                    }
                    onCall={phone ? () => callPhone(phone) : undefined}
                  />
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* 5. Quick actions */}
      <View className="gap-3">
        <SectionHeader title={t('dashboard.quickActions')} />
        <View className="flex-row gap-2">
          <QuickActionButton
            icon="add-circle"
            label={t('dashboard.actionNewLoan')}
            onPress={() => router.push('/loan/new')}
          />
          <QuickActionButton
            icon="cash"
            label={t('dashboard.actionCollect')}
            onPress={() => router.navigate('/collection')}
          />
          <QuickActionButton
            icon="person-add"
            label={t('dashboard.actionNewBorrower')}
            onPress={() => router.push('/borrower/new')}
          />
          <QuickActionButton
            icon="bar-chart"
            label={t('dashboard.actionReports')}
            onPress={() => router.push('/reports')}
          />
        </View>
      </View>

      {/* 6. This week: cash collected per day */}
      <View className="gap-3">
        <SectionHeader
          title={t('dashboard.thisWeek')}
          actionLabel={t('dashboard.openReports')}
          onAction={() => router.push('/reports')}
        />
        <WeeklyEarningsCard
          days={weekBars(data)}
          monthInterestCentavos={data.monthInterest}
          highlightIndex={highlightIndex}
        />
      </View>

      {/* 7. Due today: overdue first, then due today */}
      <View className="gap-1">
        <SectionHeader
          title={t('dashboard.dueToday')}
          actionLabel={t('dashboard.viewAll')}
          onAction={() => router.navigate('/collection')}
        />
        <View className="rounded-2xl bg-white px-4 dark:bg-slate-900">
          {dueToday.length === 0 ? (
            <Text className="py-5 text-center text-base text-slate-600 dark:text-slate-400">
              {stats.activeLoans === 0 ? t('dashboard.dueTodayNoLoans') : t('dashboard.dueTodayEmpty')}
            </Text>
          ) : (
            dueToday.map((item, i) => (
              <View
                key={item.id}
                className={i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : undefined}>
                <DueTodayRow
                  borrowerName={item.borrowerName}
                  amountDueCentavos={item.amountDueCentavos}
                  chipLabel={item.chipLabel}
                  chipTone={item.chipTone}
                  onPress={() =>
                    router.push({ pathname: '/loan/[id]', params: { id: item.id } })
                  }
                />
              </View>
            ))
          )}
        </View>
      </View>
    </>
  );
}

/** Brand-new database: point the user at the first step. */
function GetStartedCard({ hasBorrowers }: { hasBorrowers: boolean }) {
  return (
    <View className="gap-3 rounded-2xl border border-dashed border-teal-300 bg-white p-5 dark:border-teal-800 dark:bg-slate-900">
      <Text className="text-lg font-bold text-slate-900 dark:text-white">
        {t('dashboard.getStartedTitle')}
      </Text>
      <Text className="text-base text-slate-600 dark:text-slate-300">
        {hasBorrowers ? t('dashboard.getStartedNoLoans') : t('dashboard.getStartedNoBorrowers')}
      </Text>
      <Pressable
        onPress={() => router.push(hasBorrowers ? '/loan/new' : '/borrower/new')}
        accessibilityRole="button"
        className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
        <Ionicons name={hasBorrowers ? 'add-circle-outline' : 'person-add-outline'} size={22} color="#ffffff" />
        <Text className="text-lg font-bold text-white">
          {hasBorrowers ? t('dashboard.addLoan') : t('dashboard.addBorrower')}
        </Text>
      </Pressable>
    </View>
  );
}

/** Placeholders shaped like the real sections, for the first load only. */
function DashboardSkeleton() {
  return (
    <View className="gap-7">
      <SkeletonBlock className="h-48 rounded-3xl" />
      <View className="gap-3">
        <View className="flex-row gap-3">
          <SkeletonBlock className="h-32 flex-1" />
          <SkeletonBlock className="h-32 flex-1" />
        </View>
        <View className="flex-row gap-3">
          <SkeletonBlock className="h-32 flex-1" />
          <SkeletonBlock className="h-32 flex-1" />
        </View>
      </View>
      <SkeletonBlock className="h-24" />
      <SkeletonBlock className="h-56" />
    </View>
  );
}
