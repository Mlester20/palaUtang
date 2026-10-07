import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DateField';
import { SkeletonBlock } from '@/components/dashboard';
import { EodView, EOD_WIDTH_DP } from '@/components/eod/EodView';
import { getCashCollectedTotal } from '@/db/cash-collected';
import { getCashLedger, getCashSetup, getLoanReleases } from '@/db/cash';
import {
  getDayPaymentsSummary,
  getDayRegularAllocations,
  getDaySettlements,
  getMissedThatDay,
  getPaidBorrowersForDay,
} from '@/db/eod';
import { getFlaggedBorrowers } from '@/db/flags';
import { getProfitSummary } from '@/db/reports';
import { t } from '@/i18n';
import { confirmOwner } from '@/lib/appLock';
import { computeNetProfit } from '@/lib/cash';
import { buildCashLines, hasNoActivity, type EodReportData } from '@/lib/eodReport';
import { showError } from '@/lib/errors';
import { addDays, formatDisplayDate, todayYmd } from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';
import { computeAppliedBreakdown } from '@/lib/receipt';
import { useThemeColors } from '@/lib/theme';
import { copyEodAsText, shareEodAsText, shareEodPng } from '@/services/eod';
import { getAppStateSnapshot } from '@/store/app-state';
import { getEodCount, setEodCount, useEodOptions, setEodOption } from '@/store/eodPrefs';
import { useFlagThresholds } from '@/store/flag-settings';

const TARGET_PNG_WIDTH = 1080;

async function loadReport(
  db: ReturnType<typeof useSQLiteContext>,
  date: string,
  today: string,
  businessName: string,
  options: ReturnType<typeof useEodOptions>,
  thresholds: Parameters<typeof getFlaggedBorrowers>[2]['thresholds'],
): Promise<EodReportData> {
  const [cashCollected, daySummary, allocations, settlements, missed, releases, setup] =
    await Promise.all([
      getCashCollectedTotal(db, date, date),
      getDayPaymentsSummary(db, date),
      getDayRegularAllocations(db, date),
      getDaySettlements(db, date),
      getMissedThatDay(db, date),
      getLoanReleases(db, date, date),
      getCashSetup(db),
    ]);

  const cashAvailable =
    setup.isSetUp && setup.ledgerStartDate !== null && date >= setup.ledgerStartDate;

  const [ledger, profit, flagged, paidBorrowers] = await Promise.all([
    cashAvailable ? getCashLedger(db, date, date, today) : Promise.resolve(null),
    options.includeProfit ? getProfitSummary(db, date, date) : Promise.resolve(null),
    date === today
      ? getFlaggedBorrowers(db, today, { thresholds, minSeverity: 'flagged' })
      : Promise.resolve(null),
    options.includeBorrowerLists ? getPaidBorrowersForDay(db, date) : Promise.resolve([]),
  ]);

  const cash: EodReportData['cash'] = !setup.isSetUp
    ? { available: false, reason: 'notSetUp' }
    : !cashAvailable
      ? { available: false, reason: 'beforeStart' }
      : { available: true, ...buildCashLines(ledger!.balanceBefore, ledger!.days[0]) };

  const expensesThatDay = cash.available ? cash.parts.expenses : 0;

  return {
    date,
    generatedAt: new Date(),
    businessName,
    collection: {
      cashCollected,
      paymentCount: daySummary.count,
      distinctBorrowers: daySummary.distinctBorrowers,
      appliedBreakdown: computeAppliedBreakdown(allocations, date),
      earlyPayoffCount: settlements.cashSettlementCount,
      earlyPayoffAmount: settlements.cashSettlementAmount,
      discountGiven: settlements.discountGiven,
      nettedCount: settlements.nettedCount,
      nettedAmount: settlements.nettedAmount,
      missedLoanCount: missed.loanCount,
      missedAmount: missed.unpaidAmount,
    },
    newLoans: {
      count: releases.length,
      principal: releases.reduce((sum, r) => sum + r.principal, 0),
      cashReleased: releases.reduce((sum, r) => sum + r.amount, 0),
    },
    cash,
    counted: { amount: getEodCount(date) },
    profit: profit
      ? {
          interestEarned: profit.interestEarned,
          principalReturned: profit.principalReturned,
          netOfExpenses: computeNetProfit(profit.interestEarned, expensesThatDay),
        }
      : null,
    flaggedCount: flagged === null ? null : flagged.length,
    borrowerLists: options.includeBorrowerLists
      ? {
          paid: paidBorrowers.map((p) => ({ name: p.borrowerName, amount: p.amount })),
          missed: missed.loans.map((m) => ({ name: m.borrowerName, amount: m.unpaidAmount })),
        }
      : null,
  };
}

export default function EodScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const options = useEodOptions();
  const thresholds = useFlagThresholds();
  const businessName = getAppStateSnapshot().profile?.businessName ?? '';

  const [today, setToday] = useState(todayYmd);
  const [date, setDate] = useState(todayYmd);
  const [report, setReport] = useState<EodReportData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [countedText, setCountedText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const viewRef = useRef<View>(null);
  const size = useRef<{ width: number; height: number } | null>(null);

  const load = useCallback(() => {
    const now = todayYmd();
    setToday(now);
    loadReport(db, date, now, businessName, options, thresholds)
      .then((r) => {
        setReport(r);
        setCountedText(r.counted.amount !== null ? (r.counted.amount / 100).toFixed(2) : '');
        setLoadError(false);
      })
      .catch((error) => {
        console.error('[Load EOD report failed]', error);
        setLoadError(true);
      });
  }, [db, date, businessName, options, thresholds]);

  useFocusEffect(
    useCallback(() => {
      setReport(null);
      load();
    }, [load]),
  );

  const onCountedChange = (text: string) => {
    setCountedText(text);
    const amount = parsePesoToCentavos(text);
    if (amount !== null) setEodCount(date, amount, today);
  };

  const onLayoutView = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) size.current = { width, height };
  };

  const withAuth = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (!(await confirmOwner())) {
        Alert.alert(t('eod.authFailedTitle'), t('eod.authFailedMessage'));
        return;
      }
      await task();
    } catch (error) {
      showError(t('eod.generateFailed'), error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onShareText = () => withAuth(async () => shareEodAsText(report!));

  const onCopyText = () =>
    withAuth(async () => {
      await copyEodAsText(report!);
      Alert.alert(t('eod.title'), t('eod.copied'));
    });

  const onShareImage = () =>
    withAuth(async () => {
      if (!viewRef.current || !size.current) throw new Error('Report image is not ready yet.');
      const targetHeight = Math.round((TARGET_PNG_WIDTH / size.current.width) * size.current.height);
      const uri = await captureRef(viewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: TARGET_PNG_WIDTH,
        height: targetHeight,
      });
      await shareEodPng(uri);
    });

  const openRecordAdjustment = () => {
    if (!report || !report.cash.available || report.counted.amount === null) return;
    router.push({
      pathname: '/cash/count',
      params: { counted: (report.counted.amount / 100).toFixed(2) },
    });
  };

  const isToday = date === today;
  const counted = parsePesoToCentavos(countedText);
  const diff =
    report?.cash.available && counted !== null ? counted - report.cash.closingExpected : null;

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerClassName="gap-5 p-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      {/* Date selector */}
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => setDate((d) => addDays(d, -1))}
            accessibilityRole="button"
            accessibilityLabel={t('eod.prevDay')}
            className="h-14 w-14 items-center justify-center rounded-2xl bg-white active:opacity-60 dark:bg-slate-900">
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text className="flex-1 text-center text-lg font-bold text-slate-900 dark:text-white">
            {formatDisplayDate(date)}
          </Text>
          <Pressable
            onPress={() => setDate((d) => addDays(d, 1))}
            disabled={date >= today}
            accessibilityRole="button"
            accessibilityLabel={t('eod.nextDay')}
            accessibilityState={{ disabled: date >= today }}
            className={
              date >= today
                ? 'h-14 w-14 items-center justify-center rounded-2xl bg-white opacity-30 dark:bg-slate-900'
                : 'h-14 w-14 items-center justify-center rounded-2xl bg-white active:opacity-60 dark:bg-slate-900'
            }>
            <Ionicons name="chevron-forward" size={26} color={colors.text} />
          </Pressable>
        </View>
        <View className="flex-row gap-2">
          <Chip label={t('eod.today')} selected={date === today} onPress={() => setDate(today)} />
          <Chip
            label={t('eod.yesterday')}
            selected={date === addDays(today, -1)}
            onPress={() => setDate(addDays(today, -1))}
          />
        </View>
        <DateField label={t('eod.pickDate')} value={date} maxDate={today} onChange={setDate} />
      </View>

      {loadError && (
        <View className="rounded-xl bg-red-50 p-4 dark:bg-red-950">
          <Text className="text-base text-red-700 dark:text-red-300">{t('eod.loadFailed')}</Text>
        </View>
      )}

      {report === null && !loadError ? (
        <View className="gap-4">
          <SkeletonBlock className="h-40 rounded-3xl" />
          <SkeletonBlock className="h-32" />
          <SkeletonBlock className="h-56" />
        </View>
      ) : report ? (
        hasNoActivity(report) ? (
          <View className="items-center gap-2 rounded-2xl bg-white p-8 dark:bg-slate-900">
            <Ionicons name="moon-outline" size={32} color={colors.textMuted} />
            <Text className="text-lg font-bold text-slate-900 dark:text-white">
              {t('eod.noActivityTitle')}
            </Text>
            <Text className="text-center text-base text-slate-600 dark:text-slate-400">
              {t('eod.noActivityMessage')}
            </Text>
          </View>
        ) : (
          <>
            {/* Collection */}
            <Card title={t('eod.collectionSection')}>
              <Hero label={t('eod.cashCollected')} value={formatPeso(report.collection.cashCollected)} />
              <Line
                label={t('eod.paymentsCount', {
                  count: report.collection.paymentCount,
                  borrowers: report.collection.distinctBorrowers,
                })}
              />
              {report.collection.appliedBreakdown.map((line) => (
                <Line
                  key={line.bucket}
                  label={
                    line.bucket === 'current'
                      ? t('eod.appliedDue')
                      : line.bucket === 'missed'
                        ? t('eod.appliedRecovered')
                        : t('eod.appliedAdvance')
                  }
                  value={formatPeso(line.amount)}
                />
              ))}
              {report.collection.earlyPayoffCount > 0 && (
                <Line
                  label={t('eod.earlyPayoffs', {
                    count: report.collection.earlyPayoffCount,
                    amount: formatPeso(report.collection.earlyPayoffAmount),
                  })}
                />
              )}
              {report.collection.discountGiven > 0 && (
                <Line label={t('eod.discountGiven')} value={formatPeso(report.collection.discountGiven)} />
              )}
              {report.collection.nettedCount > 0 && (
                <Line
                  label={t('eod.appliedToRenewals', {
                    count: report.collection.nettedCount,
                    amount: formatPeso(report.collection.nettedAmount),
                  })}
                />
              )}
              <Line
                label={
                  report.collection.missedLoanCount > 0
                    ? t('eod.missedThatDay', {
                        count: report.collection.missedLoanCount,
                        amount: formatPeso(report.collection.missedAmount),
                      })
                    : t('eod.missedNone')
                }
                tone={report.collection.missedLoanCount > 0 ? 'bad' : 'default'}
              />
            </Card>

            {/* New loans */}
            <Card title={t('eod.newLoansSection')}>
              <Line
                label={
                  report.newLoans.count > 0
                    ? t('eod.newLoansLine', {
                        count: report.newLoans.count,
                        principal: formatPeso(report.newLoans.principal),
                        released: formatPeso(report.newLoans.cashReleased),
                      })
                    : t('eod.newLoansNone')
                }
              />
            </Card>

            {/* Cash */}
            {options.includeCash && (
              <Card title={t('eod.cashSection')}>
                {report.cash.available ? (
                  <>
                    <Line label={t('eod.cashOpening')} value={formatPeso(report.cash.opening)} />
                    <Line label={t('eod.cashCollected')} value={`+${formatPeso(report.cash.parts.collected)}`} />
                    {report.cash.parts.capitalIn > 0 && (
                      <Line label={t('eod.cashCapitalIn')} value={`+${formatPeso(report.cash.parts.capitalIn)}`} />
                    )}
                    <Line label={t('eod.cashReleased')} value={`-${formatPeso(report.cash.parts.released)}`} />
                    <Line label={t('eod.cashWithdrawals')} value={`-${formatPeso(report.cash.parts.withdrawals)}`} />
                    {report.cash.expensesByCategory.map((e) => (
                      <Line
                        key={e.category}
                        label={t('eod.cashExpenseCategory', { category: e.category })}
                        value={`-${formatPeso(e.amount)}`}
                      />
                    ))}
                    {(report.cash.parts.adjustmentsIn > 0 || report.cash.parts.adjustmentsOut > 0) && (
                      <Line
                        label={t('eod.cashAdjustments')}
                        value={`${report.cash.parts.adjustmentsIn >= report.cash.parts.adjustmentsOut ? '+' : '-'}${formatPeso(
                          Math.abs(report.cash.parts.adjustmentsIn - report.cash.parts.adjustmentsOut),
                        )}`}
                      />
                    )}
                    <View className="h-px bg-slate-200 dark:bg-slate-800" />
                    <Line label={t('eod.cashClosing')} value={formatPeso(report.cash.closingExpected)} bold />

                    <View className="gap-2 pt-2">
                      <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {t('eod.countedInputLabel')}
                      </Text>
                      <TextInput
                        value={countedText}
                        onChangeText={onCountedChange}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={colors.textMuted}
                        className="min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-lg text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                      {diff !== null && (
                        <Text
                          className={
                            diff === 0
                              ? 'text-base font-bold text-green-700 dark:text-green-400'
                              : 'text-base font-bold text-red-600 dark:text-red-400'
                          }>
                          {diff === 0
                            ? t('eod.cashMatches')
                            : diff > 0
                              ? t('eod.cashOver', { amount: formatPeso(diff) })
                              : t('eod.cashShort', { amount: formatPeso(-diff) })}
                        </Text>
                      )}
                      {isToday && diff !== null && diff !== 0 && (
                        <Pressable
                          onPress={openRecordAdjustment}
                          accessibilityRole="button"
                          className="min-h-12 items-center justify-center rounded-xl border border-teal-700 active:opacity-70 dark:border-teal-400">
                          <Text className="text-base font-bold text-teal-700 dark:text-teal-300">
                            {t('eod.recordAdjustment')}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </>
                ) : (
                  <Line
                    label={
                      report.cash.reason === 'notSetUp'
                        ? t('eod.cashNotSetUp')
                        : t('eod.cashBeforeStart')
                    }
                  />
                )}
              </Card>
            )}

            {/* Profit */}
            {options.includeProfit && report.profit && (
              <Card title={t('eod.profitSection')}>
                <Line label={t('eod.profitInterest')} value={formatPeso(report.profit.interestEarned)} />
                <Line label={t('eod.profitPrincipal')} value={formatPeso(report.profit.principalReturned)} />
                <Line label={t('eod.profitNet')} value={formatPeso(report.profit.netOfExpenses)} bold />
              </Card>
            )}

            {/* Attention (today only) */}
            {report.flaggedCount !== null && (
              <Card title={t('eod.attentionSection')}>
                <Line
                  label={
                    report.flaggedCount === 0
                      ? t('eod.attentionNone')
                      : t('eod.attentionCount', { count: report.flaggedCount })
                  }
                  tone={report.flaggedCount > 0 ? 'bad' : 'default'}
                />
              </Card>
            )}

            {/* Options */}
            <Card title={t('eod.optionsTitle')}>
              <ToggleRow
                label={t('eod.toggleCash')}
                value={options.includeCash}
                onChange={(v) => setEodOption('includeCash', v)}
              />
              <ToggleRow
                label={t('eod.toggleProfit')}
                value={options.includeProfit}
                onChange={(v) => setEodOption('includeProfit', v)}
              />
              <ToggleRow
                label={t('eod.toggleBorrowerLists')}
                value={options.includeBorrowerLists}
                onChange={(v) => setEodOption('includeBorrowerLists', v)}
              />
            </Card>

            <Text className="px-1 text-xs text-slate-500 dark:text-slate-400">{t('eod.liveNote')}</Text>

            {/* Share bar */}
            <View className="gap-2">
              <Pressable
                onPress={onShareImage}
                disabled={busy}
                accessibilityRole="button"
                className={
                  busy
                    ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-60 dark:bg-teal-500'
                    : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
                }>
                {busy && <ActivityIndicator color="#ffffff" />}
                <Ionicons name="image-outline" size={22} color="#ffffff" />
                <Text className="text-lg font-bold text-white">{t('eod.shareAsImage')}</Text>
              </Pressable>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={onShareText}
                  disabled={busy}
                  accessibilityRole="button"
                  className="min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
                  <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.primary} />
                  <Text className="text-base font-semibold text-slate-900 dark:text-white">
                    {t('eod.shareAsText')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onCopyText}
                  disabled={busy}
                  accessibilityRole="button"
                  className="min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
                  <Ionicons name="copy-outline" size={20} color={colors.primary} />
                  <Text className="text-base font-semibold text-slate-900 dark:text-white">
                    {t('eod.copyText')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </>
        )
      ) : null}

      {/* Off-screen: never visible, always laid out so captureRef has real pixels to read. */}
      {report && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: -9999, opacity: 0, width: EOD_WIDTH_DP }}>
          <View ref={viewRef} collapsable={false} onLayout={onLayoutView}>
            <EodView data={report} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={
        selected
          ? 'min-h-11 justify-center rounded-full bg-teal-700 px-4 dark:bg-teal-500'
          : 'min-h-11 justify-center rounded-full border border-slate-300 bg-white px-4 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
      }>
      <Text
        className={
          selected
            ? 'text-base font-bold text-white'
            : 'text-base font-semibold text-slate-700 dark:text-slate-200'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2 rounded-2xl bg-white p-4 dark:bg-slate-900">
      <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">{title}</Text>
      {children}
    </View>
  );
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center gap-1 py-2">
      <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">{label}</Text>
      <Text className="text-3xl font-extrabold text-teal-700 dark:text-teal-400">{value}</Text>
    </View>
  );
}

function Line({
  label,
  value,
  bold,
  tone = 'default',
}: {
  label: string;
  value?: string;
  bold?: boolean;
  tone?: 'default' | 'bad';
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text
        className={
          tone === 'bad'
            ? 'flex-1 text-base text-red-600 dark:text-red-400'
            : 'flex-1 text-base text-slate-700 dark:text-slate-200'
        }>
        {label}
      </Text>
      {value !== undefined && (
        <Text
          className={
            bold
              ? 'text-lg font-extrabold text-slate-900 dark:text-white'
              : tone === 'bad'
                ? 'text-base font-bold text-red-600 dark:text-red-400'
                : 'text-base font-bold text-slate-900 dark:text-white'
          }>
          {value}
        </Text>
      )}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-base text-slate-700 dark:text-slate-200">{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.switchTrackOff }}
        thumbColor="#ffffff"
      />
    </View>
  );
}
