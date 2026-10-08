import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CashSetupCard } from '@/components/cash/CashSetupCard';
import { categoryLabel } from '@/components/cash/cash-text';
import { DateField } from '@/components/DateField';
import { Money, useMoneyText } from '@/components/Money';
import { PrivacyToggle } from '@/components/PrivacyToggle';
import { DailyReportRow } from '@/components/reports/DailyReportRow';
import { ReportStatCard } from '@/components/reports/ReportStatCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  getCashSummary,
  getExpensesAndWithdrawals,
  type CashSummary,
  type CategoryTotal,
  type OutflowTotals,
} from '@/db/cash';
import { getFlaggedBorrowers } from '@/db/flags';
import { getProfitSummary } from '@/db/reports';
import { t, type TranslationKey } from '@/i18n';
import { computeNetProfit, type CashKind } from '@/lib/cash';
import { formatDisplayDate, todayYmd } from '@/lib/loan';
import type { ProfitSummary } from '@/lib/profit';
import {
  monthRange,
  presetRange,
  validateCustomRange,
  type DateRange,
  type ReportPreset,
} from '@/lib/ranges';
import { useThemeColors } from '@/lib/theme';
import { useFlagThresholds } from '@/store/flag-settings';

const PRESETS: { value: ReportPreset; label: TranslationKey }[] = [
  { value: 'thisWeek', label: 'reports.presetThisWeek' },
  { value: 'thisMonth', label: 'reports.presetThisMonth' },
  { value: 'lastMonth', label: 'reports.presetLastMonth' },
  { value: 'custom', label: 'reports.presetCustom' },
];

function loansText(count: number) {
  return count === 1 ? t('reports.oneLoan') : t('reports.loans', { count });
}

export default function ReportsScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const moneyText = useMoneyText();
  const thresholds = useFlagThresholds();

  const [preset, setPreset] = useState<ReportPreset>('thisMonth');
  const [custom, setCustom] = useState<DateRange>(() => ({
    from: monthRange(todayYmd()).from,
    to: todayYmd(),
  }));
  const [today, setToday] = useState(todayYmd);
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [flaggedCount, setFlaggedCount] = useState<number | null>(null);
  const [outflows, setOutflows] = useState<OutflowTotals | null>(null);
  const [cashAtEnd, setCashAtEnd] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestId = useRef(0);

  const customError = preset === 'custom' ? validateCustomRange(custom, today) : null;

  const load = useCallback(async () => {
    const current = ++requestId.current;
    const now = todayYmd();
    const range = preset === 'custom' ? custom : presetRange(preset, now);
    setToday(now);
    if (preset === 'custom' && validateCustomRange(range, now) !== null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profit, flagged, out, cash] = await Promise.all([
        getProfitSummary(db, range.from, range.to),
        getFlaggedBorrowers(db, now, { thresholds, minSeverity: 'flagged' }),
        getExpensesAndWithdrawals(db, range.from, range.to),
        // Cash on hand at the end of the range (never past today).
        getCashSummary(db, range.to > now ? now : range.to),
      ]);
      if (current !== requestId.current) return;
      setSummary(profit);
      setFlaggedCount(flagged.length);
      setOutflows(out);
      setCashAtEnd(cash);
      setLoadError(false);
    } catch (error) {
      console.error('[Load report failed]', error);
      if (current === requestId.current) setLoadError(true);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [db, preset, custom, thresholds]);

  // Reloads when shown again (e.g. after voiding a payment) and when the range changes.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Newest first, for the per-day list.
  const days = useMemo(() => (summary ? [...summary.days].reverse() : []), [summary]);
  const maxCash = useMemo(() => Math.max(0, ...days.map((d) => d.cashCollected)), [days]);
  const hasActivity = days.some((d) => d.cashCollected > 0 || d.interestEarned > 0);
  const showData = summary !== null && customError === null;

  const header = (
    <View className="gap-5 pb-3">
      <SegmentedControl
        options={PRESETS.map((p) => ({ value: p.value, label: t(p.label) }))}
        value={preset}
        onChange={setPreset}
      />

      {preset === 'custom' && (
        <View className="gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
          <DateField
            label={t('reports.from')}
            value={custom.from}
            maxDate={today}
            onChange={(from) => setCustom((c) => ({ ...c, from }))}
          />
          <DateField
            label={t('reports.to')}
            value={custom.to}
            maxDate={today}
            onChange={(to) => setCustom((c) => ({ ...c, to }))}
          />
          {customError && (
            <Text className="text-base font-semibold text-red-600 dark:text-red-400">
              {customError === 'futureDate'
                ? t('reports.errorFuture')
                : t('reports.errorFromAfterTo')}
            </Text>
          )}
        </View>
      )}

      {showData && (
        <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
          {t('reports.rangeLabel', {
            from: formatDisplayDate(summary.fromDate),
            to: formatDisplayDate(summary.toDate),
          })}
        </Text>
      )}

      {loadError && (
        <View className="rounded-xl bg-red-50 p-4 dark:bg-red-950">
          <Text className="text-base text-red-700 dark:text-red-300">{t('reports.loadFailed')}</Text>
        </View>
      )}

      {showData && (
        <View className={loading ? 'gap-3 opacity-60' : 'gap-3'}>
          {outflows && (
            <ReportStatCard
              tone={computeNetProfit(summary.interestEarned, outflows.expensesTotal) < 0 ? 'danger' : 'primary'}
              label={t('reports.netProfit')}
              value={moneyText(computeNetProfit(summary.interestEarned, outflows.expensesTotal), 'total')}
              hint={t('reports.netProfitHint')}
            />
          )}
          <ReportStatCard
            label={t('reports.interestEarned')}
            value={moneyText(summary.interestEarned, 'total')}
            hint={t('reports.interestEarnedHint')}
          />
          {outflows && (
            <>
              <CategoryCard
                title={t('reports.businessExpenses')}
                hint={t('reports.businessExpensesHint')}
                kind="expense"
                total={outflows.expensesTotal}
                lines={outflows.expenses}
              />
              <CategoryCard
                title={t('reports.ownerWithdrawals')}
                hint={t('reports.ownerWithdrawalsHint')}
                kind="withdrawal"
                total={outflows.withdrawalsTotal}
                lines={outflows.withdrawals}
              />
            </>
          )}
          {cashAtEnd &&
            (cashAtEnd.cashOnHand === null ? (
              <CashSetupCard compact />
            ) : (
              <ReportStatCard
                label={t('reports.cashAtEnd', { date: formatDisplayDate(cashAtEnd.asOfDate) })}
                value={moneyText(cashAtEnd.cashOnHand, 'total')}
                tone={cashAtEnd.cashOnHand < 0 ? 'danger' : 'default'}
              />
            ))}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <ReportStatCard
                label={t('reports.cashCollected')}
                value={moneyText(summary.cashCollected, 'total')}
              />
            </View>
            <View className="flex-1">
              <ReportStatCard
                label={t('reports.principalReturned')}
                value={moneyText(summary.principalReturned, 'total')}
              />
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <ReportStatCard
                label={t('reports.discountsGiven')}
                value={moneyText(summary.discountsGiven, 'total')}
              />
            </View>
            <View className="flex-1">
              <ReportStatCard
                label={t('reports.netted')}
                value={moneyText(summary.nettedSettlements, 'total')}
                hint={t('reports.nettedHint')}
              />
            </View>
          </View>
          {summary.unrecoveredPrincipal > 0 && (
            <ReportStatCard
              tone="danger"
              label={t('reports.unrecovered')}
              value={`-${moneyText(summary.unrecoveredPrincipal, 'total')}`}
              hint={t('reports.unrecoveredHint')}
            />
          )}
          <ReportStatCard
            label={t('reports.newLoans')}
            value={moneyText(summary.newLoansReleased.amount, 'total')}
            hint={loansText(summary.newLoansReleased.count)}
          />
        </View>
      )}

      <Pressable
        onPress={() => router.push('/eod')}
        accessibilityRole="button"
        className="min-h-16 flex-row items-center gap-3 rounded-2xl bg-white p-4 active:opacity-70 dark:bg-slate-900">
        <Ionicons name="document-text-outline" size={26} color={colors.primary} />
        <Text className="flex-1 text-base font-semibold text-slate-900 dark:text-white">
          {t('eod.entryReports')}
        </Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>

      {/* Live number, not tied to the range */}
      <Pressable
        onPress={() => router.navigate({ pathname: '/borrowers', params: { filter: 'flagged' } })}
        accessibilityRole="button"
        className="min-h-16 flex-row items-center gap-3 rounded-2xl bg-white p-4 active:opacity-70 dark:bg-slate-900">
        <Ionicons name="alert-circle" size={26} color={colors.warning} />
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-semibold text-slate-900 dark:text-white">
            {t('reports.flaggedNow')}
          </Text>
          <Text className="text-sm text-slate-600 dark:text-slate-400">
            {flaggedCount === null
              ? ' '
              : flaggedCount === 0
                ? t('reports.flaggedNowNone')
                : t('reports.flaggedNowCount', { count: flaggedCount })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>

      <View className="gap-1 rounded-xl bg-slate-100 p-4 dark:bg-slate-900">
        <Text className="text-sm text-slate-600 dark:text-slate-300">{t('reports.cashBasisNote')}</Text>
      </View>

      {showData && (
        <Text className="pt-2 text-xl font-bold text-slate-900 dark:text-white">
          {t('reports.perDay')}
        </Text>
      )}
      {showData && !hasActivity && !loading && (
        <Text className="text-base text-slate-600 dark:text-slate-400">{t('reports.noActivity')}</Text>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <Stack.Screen options={{ headerRight: () => <PrivacyToggle /> }} />
      <FlatList
        data={showData && hasActivity ? days : []}
        keyExtractor={(d) => d.date}
        contentContainerClassName="gap-2 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          summary === null && loading && !loadError ? (
            <ActivityIndicator size="large" className="mt-6" />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        renderItem={({ item }) => (
          <DailyReportRow
            date={item.date}
            cashCollected={item.cashCollected}
            interestEarned={item.interestEarned}
            maxCash={maxCash}
          />
        )}
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
}

/** Expenses or withdrawals for the range, one line per category. */
function CategoryCard({
  title,
  hint,
  kind,
  total,
  lines,
}: {
  title: string;
  hint: string;
  kind: CashKind;
  total: number;
  lines: CategoryTotal[];
}) {
  return (
    <View className="gap-2 rounded-2xl bg-white p-4 dark:bg-slate-900">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</Text>
        <Money value={total} kind="total" className="text-2xl font-extrabold text-slate-900 dark:text-white" />
      </View>
      <Text className="text-xs text-slate-500 dark:text-slate-400">{hint}</Text>
      {lines.map((line) => (
        <View key={line.category} className="flex-row justify-between gap-3">
          <Text className="text-base text-slate-700 dark:text-slate-200">
            {categoryLabel(kind, line.category)}
          </Text>
          <Money
            value={line.amount}
            kind="total"
            className="text-base font-semibold text-slate-900 dark:text-white"
          />
        </View>
      ))}
    </View>
  );
}
