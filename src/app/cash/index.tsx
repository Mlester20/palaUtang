import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CashSetupCard } from '@/components/cash/CashSetupCard';
import { cashErrorText, kindLabel } from '@/components/cash/cash-text';
import { LedgerItemRow } from '@/components/cash/LedgerItemRow';
import { DateField } from '@/components/DateField';
import { VoidPaymentModal } from '@/components/payments/VoidPaymentModal';
import { SegmentedControl } from '@/components/SegmentedControl';
import { getCashLedger, getCashSummary, voidCashEntry, type CashLedger, type CashSummary } from '@/db/cash';
import { t, type TranslationKey } from '@/i18n';
import { confirmOwner } from '@/lib/appLock';
import { computeCashOnHand, partsFromLedger, type CashEntry, type LedgerItem } from '@/lib/cash';
import { showError } from '@/lib/errors';
import { formatDisplayDate, formatShortDate, todayYmd } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { monthRange, validateCustomRange, weekRange, type DateRange } from '@/lib/ranges';
import { useThemeColors } from '@/lib/theme';

type Preset = 'today' | 'thisWeek' | 'thisMonth' | 'custom';

const PRESETS: { value: Preset; label: TranslationKey }[] = [
  { value: 'today', label: 'cash.presetToday' },
  { value: 'thisWeek', label: 'cash.presetThisWeek' },
  { value: 'thisMonth', label: 'cash.presetThisMonth' },
  { value: 'custom', label: 'cash.presetCustom' },
];

function rangeFor(preset: Preset, custom: DateRange, today: string): DateRange {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'thisWeek') return weekRange(today);
  if (preset === 'thisMonth') return monthRange(today);
  return custom;
}

export default function CashScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [preset, setPreset] = useState<Preset>('today');
  const [today, setToday] = useState(todayYmd);
  const [custom, setCustom] = useState<DateRange>(() => ({
    from: monthRange(todayYmd()).from,
    to: todayYmd(),
  }));
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [ledger, setLedger] = useState<CashLedger | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [voiding, setVoiding] = useState<CashEntry | null>(null);
  const requestId = useRef(0);

  const customError = preset === 'custom' ? validateCustomRange(custom, today) : null;

  const load = useCallback(async () => {
    const current = ++requestId.current;
    const now = todayYmd();
    const range = rangeFor(preset, custom, now);
    try {
      const [s, l] = await Promise.all([
        getCashSummary(db, now),
        preset === 'custom' && validateCustomRange(range, now) !== null
          ? Promise.resolve(null)
          : getCashLedger(db, range.from, range.to, now),
      ]);
      if (current !== requestId.current) return;
      setToday(now);
      setSummary(s);
      setLedger(l);
      setLoadError(false);
    } catch (error) {
      console.error('[Load cash failed]', error);
      if (current === requestId.current) setLoadError(true);
    }
  }, [db, preset, custom]);

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

  const sections = useMemo(
    () => (ledger?.days ?? []).map((d) => ({ day: d, data: d.items })),
    [ledger],
  );
  const rangeParts = useMemo(() => partsFromLedger(ledger?.days ?? []), [ledger]);

  const confirmVoid = async (reason: string) => {
    if (!voiding) return;
    // Owner check first: cancelled or failed → nothing changes.
    if (!(await confirmOwner())) {
      Alert.alert(t('cash.authFailedTitle'), t('cash.authFailedMessage'));
      return;
    }
    try {
      await voidCashEntry(db, voiding.id, reason);
      setVoiding(null);
      await load();
    } catch (error) {
      const text = cashErrorText(error);
      if (text) Alert.alert(t('cash.voidFailed'), text);
      else showError(t('cash.voidFailed'), error);
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: LedgerItem }) => (
      <LedgerItemRow
        item={item}
        onOpenCollection={() => router.navigate('/collection')}
        onOpenLoan={(id) => router.push({ pathname: '/loan/[id]', params: { id: String(id) } })}
        onVoid={setVoiding}
      />
    ),
    [],
  );

  if (summary === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        {loadError ? (
          <Text className="px-6 text-center text-base text-red-700 dark:text-red-300">
            {t('cash.loadFailed')}
          </Text>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  if (summary.cashOnHand === null) {
    return (
      <View className="flex-1 bg-slate-50 p-5 dark:bg-slate-950">
        <CashSetupCard />
      </View>
    );
  }

  const header = (
    <View className="gap-4 pb-2">
      {/* Cash on hand now */}
      <View className="gap-3 rounded-3xl bg-teal-700 p-5 dark:bg-teal-800">
        <Text className="text-base font-semibold text-teal-50">{t('cash.cashOnHandNow')}</Text>
        <Text className="text-4xl font-extrabold text-white" numberOfLines={1} adjustsFontSizeToFit>
          {formatPeso(summary.cashOnHand)}
        </Text>
        <Text className="text-sm text-teal-50">
          {t('cash.sinceStart', { date: formatDisplayDate(summary.setup.ledgerStartDate!) })}
        </Text>
      </View>

      <View className="flex-row gap-2">
        <ActionButton icon="remove-circle-outline" label={t('cash.withdrawExpense')} onPress={() => router.push('/cash/new')} />
        <ActionButton
          icon="add-circle-outline"
          label={t('cash.addCapital')}
          onPress={() => router.push({ pathname: '/cash/new', params: { kind: 'capital_in' } })}
        />
        <ActionButton icon="calculator-outline" label={t('cash.countCash')} onPress={() => router.push('/cash/count')} />
      </View>

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
              {customError === 'futureDate' ? t('reports.errorFuture') : t('reports.errorFromAfterTo')}
            </Text>
          )}
        </View>
      )}

      {/* What moved in the selected range */}
      {ledger && (
        <View className="gap-2 rounded-2xl bg-white p-4 dark:bg-slate-900">
          <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            {ledger.fromDate === ledger.toDate
              ? formatDisplayDate(ledger.fromDate)
              : t('reports.rangeLabel', {
                  from: formatShortDate(ledger.fromDate),
                  to: formatShortDate(ledger.toDate),
                })}
          </Text>
          <PartLine label={t('cash.partStart')} value={ledger.balanceBefore} />
          {rangeParts.opening > 0 && <PartLine label={kindLabel('opening')} value={rangeParts.opening} sign="+" />}
          <PartLine label={t('cash.partCollected')} value={rangeParts.collected} sign="+" />
          {rangeParts.capitalIn > 0 && <PartLine label={t('cash.kindCapitalIn')} value={rangeParts.capitalIn} sign="+" />}
          <PartLine label={t('cash.partReleased')} value={rangeParts.released} sign="−" />
          <PartLine label={t('cash.partWithdrawals')} value={rangeParts.withdrawals} sign="−" />
          <PartLine label={t('cash.partExpenses')} value={rangeParts.expenses} sign="−" />
          {(rangeParts.adjustmentsIn > 0 || rangeParts.adjustmentsOut > 0) && (
            <PartLine
              label={t('cash.partAdjustments')}
              value={rangeParts.adjustmentsIn - rangeParts.adjustmentsOut}
              sign={rangeParts.adjustmentsIn >= rangeParts.adjustmentsOut ? '+' : '−'}
            />
          )}
          <View className="h-px bg-slate-200 dark:bg-slate-800" />
          <PartLine
            label={t('cash.partEnd')}
            value={ledger.balanceBefore + computeCashOnHand(rangeParts)}
            bold
          />
        </View>
      )}

      {ledger && sections.length === 0 && (
        <Text className="py-4 text-center text-base text-slate-600 dark:text-slate-400">
          {t('cash.noMovements')}
        </Text>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        contentContainerClassName="gap-2 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-center gap-3 bg-slate-50 py-2 dark:bg-slate-950">
            <View className="flex-1">
              <Text className="text-base font-bold text-slate-900 dark:text-white">
                {formatShortDate(section.day.date)}
              </Text>
              <Text className="text-xs text-slate-600 dark:text-slate-400">
                {t('cash.dayLine', {
                  collected: formatPeso(section.day.collected),
                  out: formatPeso(section.day.dayOut),
                })}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs text-slate-600 dark:text-slate-400">{t('cash.balance')}</Text>
              <Text
                className={
                  section.day.balance < 0
                    ? 'text-base font-bold text-red-600 dark:text-red-400'
                    : 'text-base font-bold text-slate-900 dark:text-white'
                }>
                {formatPeso(section.day.balance)}
              </Text>
            </View>
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
        initialNumToRender={15}
        windowSize={7}
      />

      <VoidPaymentModal
        visible={voiding !== null}
        amountText={voiding ? formatPeso(voiding.amount) : ''}
        dateText={voiding ? formatDisplayDate(voiding.entryDate) : ''}
        title={t('cash.voidTitle')}
        message={
          voiding
            ? t('cash.voidMessage', {
                kind: kindLabel(voiding.kind),
                amount: formatPeso(voiding.amount),
                date: formatDisplayDate(voiding.entryDate),
              })
            : ''
        }
        onCancel={() => setVoiding(null)}
        onConfirm={confirmVoid}
      />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-16 flex-1 items-center justify-center gap-1 rounded-2xl bg-white px-2 py-2 active:opacity-70 dark:bg-slate-900">
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text className="text-center text-sm font-semibold text-slate-800 dark:text-slate-100" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function PartLine({
  label,
  value,
  sign,
  bold,
}: {
  label: string;
  value: number;
  sign?: '+' | '−';
  bold?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className={bold ? 'text-base font-bold text-slate-900 dark:text-white' : 'text-base text-slate-600 dark:text-slate-300'}>
        {label}
      </Text>
      <Text className={bold ? 'text-lg font-extrabold text-slate-900 dark:text-white' : 'text-base font-semibold text-slate-900 dark:text-white'}>
        {sign ? `${sign}${formatPeso(Math.abs(value))}` : formatPeso(value)}
      </Text>
    </View>
  );
}
