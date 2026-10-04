import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CollectedDayView } from '@/components/collection/CollectedDayView';
import { CollectionCashStrip } from '@/components/collection/CollectionCashStrip';
import { CollectionRowItem } from '@/components/collection/CollectionRowItem';
import { CollectionSummaryCard } from '@/components/collection/CollectionSummaryCard';
import { CollectSheet } from '@/components/collection/CollectSheet';
import { RowActionsSheet } from '@/components/collection/RowActionsSheet';
import { UndoSnackbar } from '@/components/collection/UndoSnackbar';
import { EmptyState } from '@/components/empty-state';
import { VoidPaymentModal } from '@/components/payments/VoidPaymentModal';
import { SegmentedControl } from '@/components/SegmentedControl';
import { getCashSummary, type CashSummary } from '@/db/cash';
import {
  countActiveLoans,
  getCollectionList,
  getPaymentsByDate,
  type DatedPayment,
} from '@/db/collection';
import {
  previewPayment,
  reconcileAllActiveLoans,
  recordPayment,
  VoidBlockedError,
  voidPayment,
} from '@/db/payments';
import { t, type TranslationKey } from '@/i18n';
import {
  groupCollection,
  summarizeCollection,
  type ClassifiedRow,
  type CollectionFilter,
} from '@/lib/collection';
import { showError } from '@/lib/errors';
import { addDays, formatDisplayDate, todayYmd } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import type { PaymentPreview } from '@/lib/payments';
import { useThemeColors } from '@/lib/theme';
import { setCollectionBadge } from '@/store/collection-badge';
import { useFlagThresholds } from '@/store/flag-settings';

type Segment = 'collect' | 'collected';
type SectionKey = 'overdue' | 'dueToday' | 'paid';

const FILTERS: { value: CollectionFilter; label: TranslationKey }[] = [
  { value: 'all', label: 'collection.filterAll' },
  { value: 'overdue', label: 'collection.filterOverdue' },
  { value: 'daily', label: 'collection.filterDaily' },
  { value: 'lump_sum', label: 'collection.filterLump' },
];

const SECTION_TITLE: Record<SectionKey, TranslationKey> = {
  overdue: 'collection.sectionOverdue',
  dueToday: 'collection.sectionDueToday',
  paid: 'collection.sectionPaid',
};

type Snack = { key: number; text: string; canUndo: boolean; paymentId?: number };

export default function CollectionScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const thresholds = useFlagThresholds();

  const [segment, setSegment] = useState<Segment>('collect');
  // `today` is recomputed on every load, so the screen follows midnight while the app stays open.
  const [today, setToday] = useState(todayYmd);
  const [rows, setRows] = useState<ClassifiedRow[] | null>(null);
  const [activeLoans, setActiveLoans] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [cash, setCash] = useState<CashSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [paidExpanded, setPaidExpanded] = useState(false);

  // Collect flow
  const [sheet, setSheet] = useState<{ row: ClassifiedRow; amount: number } | null>(null);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // a fast double tap must never record two payments
  const previewRequest = useRef(0);
  const [actionsRow, setActionsRow] = useState<ClassifiedRow | null>(null);
  const [snack, setSnack] = useState<Snack | null>(null);
  const [undoing, setUndoing] = useState(false);

  // Collected segment
  const [collectedDate, setCollectedDate] = useState<string | null>(null); // null = today
  const [dayPayments, setDayPayments] = useState<DatedPayment[]>([]);
  const [voiding, setVoiding] = useState<DatedPayment | null>(null);
  const shownDate = collectedDate ?? today;

  const load = useCallback(async () => {
    const now = todayYmd();
    try {
      await reconcileAllActiveLoans(db, now);
      const [list, active, payments, cashSummary] = await Promise.all([
        getCollectionList(db, now),
        countActiveLoans(db),
        getPaymentsByDate(db, collectedDate ?? now),
        getCashSummary(db, now),
      ]);
      setCash(cashSummary);
      setToday(now);
      setRows(list);
      setActiveLoans(active);
      setDayPayments(payments);
      setLoadError(false);
      setCollectionBadge(summarizeCollection(list).toCollectCount);
    } catch (error) {
      console.error('[Load collection failed]', error);
      setLoadError(true);
    }
  }, [db, collectedDate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => subscription.remove();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ── Collect ──
  const openCollect = useCallback(
    (row: ClassifiedRow, amount: number = row.toCollect) => {
      if (savingRef.current) return;
      setActionsRow(null);
      setSheet({ row, amount });
      setPreview(null);
      const request = ++previewRequest.current;
      const now = todayYmd();
      previewPayment(db, row.loanId, amount, now, now)
        .then((p) => request === previewRequest.current && setPreview(p))
        .catch((error) => console.error('[Collect preview failed]', error));
    },
    [db],
  );

  const confirmCollect = async () => {
    if (!sheet || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const { row, amount } = sheet;
    try {
      const now = todayYmd();
      const paymentId = await recordPayment(
        db,
        { loanId: row.loanId, amount, paidOn: now, note: null },
        now,
      );
      setSheet(null);
      setSnack({
        key: Date.now(),
        text: t('collection.recordedToast', { amount: formatPeso(amount), name: row.borrowerName }),
        canUndo: true,
        paymentId,
      });
      await load();
    } catch (error) {
      showError(t('collection.recordFailed'), error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!snack?.paymentId || undoing) return;
    setUndoing(true);
    try {
      await voidPayment(db, snack.paymentId, t('collection.undoReason'), todayYmd());
      setSnack({ key: Date.now(), text: t('collection.undoneToast'), canUndo: false });
      await load();
    } catch (error) {
      showError(t('collection.undoFailed'), error);
    } finally {
      setUndoing(false);
    }
  };
  const hideSnack = useCallback(() => setSnack(null), []);

  // ── Row actions ──
  const openLoan = useCallback((loanId: number) => {
    router.push({ pathname: '/loan/[id]', params: { id: String(loanId) } });
  }, []);
  const onOpenRow = useCallback((row: ClassifiedRow) => openLoan(row.loanId), [openLoan]);
  const onMore = useCallback((row: ClassifiedRow) => setActionsRow(row), []);
  const onCollect = useCallback((row: ClassifiedRow) => openCollect(row), [openCollect]);

  const callBorrower = async (row: ClassifiedRow) => {
    setActionsRow(null);
    if (!row.phone) return;
    try {
      await Linking.openURL(`tel:${row.phone}`);
    } catch (error) {
      showError(t('collection.actionCall', { phone: row.phone }), error);
    }
  };

  const customAmount = (row: ClassifiedRow) => {
    setActionsRow(null);
    router.push({
      pathname: '/payment/new',
      params: { loanId: String(row.loanId), amount: String(row.toCollect), from: 'collection' },
    });
  };

  // ── Void (Collected segment) ──
  const confirmVoid = async (reason: string) => {
    if (!voiding) return;
    try {
      await voidPayment(db, voiding.id, reason, todayYmd());
      setVoiding(null);
      await load();
      Alert.alert(t('payments.voidedTitle'), t('payments.voidedMessage'));
    } catch (error) {
      if (error instanceof VoidBlockedError) {
        setVoiding(null);
        Alert.alert(t('settlement.voidBlockedTitle'), t(`settlement.${error.rule}`));
      } else {
        showError(t('payments.voidFailed'), error);
      }
    }
  };

  // ── Derived ──
  const summary = summarizeCollection(rows ?? []);
  const groups = groupCollection(rows ?? [], filter, query);
  const searching = query.trim() !== '' || filter !== 'all';
  const sections = (
    [
      { key: 'overdue' as const, rows: groups.overdue },
      { key: 'dueToday' as const, rows: groups.dueToday },
      { key: 'paid' as const, rows: groups.paid },
    ] satisfies { key: SectionKey; rows: ClassifiedRow[] }[]
  )
    .filter((s) => s.rows.length > 0)
    .map((s) => ({
      key: s.key,
      count: s.rows.length,
      data: s.key === 'paid' && !paidExpanded ? [] : s.rows,
    }));
  const nothingToCollect = groups.overdue.length === 0 && groups.dueToday.length === 0;

  const header = (
    <View className="gap-4 pb-1 pt-4">
      <Text className="text-base font-semibold text-slate-600 dark:text-slate-300">
        {formatDisplayDate(today)}
      </Text>
      <CollectionSummaryCard summary={summary} />
      {cash && (
        <CollectionCashStrip
          cashOnHand={cash.cashOnHand}
          outToday={cash.withdrawalsToday + cash.expensesToday}
          onWithdraw={() => router.push('/cash/new')}
          onOpenCash={() => router.push('/cash')}
          onSetup={() => router.push('/cash/setup')}
        />
      )}
      <SegmentedControl
        value={segment}
        onChange={setSegment}
        options={[
          { value: 'collect', label: t('collection.segToCollect') },
          { value: 'collected', label: t('collection.segCollected') },
        ]}
      />
    </View>
  );

  if (rows === null && !loadError) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      {segment === 'collected' ? (
        <CollectedDayView
          header={header}
          date={shownDate}
          canGoNext={shownDate < today}
          onPrev={() => setCollectedDate(addDays(shownDate, -1))}
          onNext={() => {
            const next = addDays(shownDate, 1);
            setCollectedDate(next >= today ? null : next);
          }}
          payments={dayPayments}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onVoid={setVoiding}
          onOpenLoan={openLoan}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.loanId)}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerClassName="gap-3 px-5 pb-28"
          initialNumToRender={12}
          windowSize={9}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={
            <View className="gap-3">
              {header}
              {loadError && (
                <View className="rounded-xl bg-red-50 p-4 dark:bg-red-950">
                  <Text className="text-base text-red-700 dark:text-red-300">
                    {t('collection.loadFailed')}
                  </Text>
                </View>
              )}
              {activeLoans > 0 && (
                <>
                  <View className="min-h-14 flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
                    <Ionicons name="search" size={20} color={colors.textMuted} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder={t('collection.searchPlaceholder')}
                      placeholderTextColor="#94a3b8"
                      autoCorrect={false}
                      className="flex-1 py-3 text-lg text-slate-900 dark:text-white"
                    />
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {FILTERS.map((f) => {
                      const selected = f.value === filter;
                      return (
                        <Pressable
                          key={f.value}
                          onPress={() => setFilter(f.value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          className={
                            selected
                              ? 'min-h-12 justify-center rounded-full bg-teal-700 px-4 dark:bg-teal-500'
                              : 'min-h-12 justify-center rounded-full border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-900'
                          }>
                          <Text
                            className={
                              selected
                                ? 'text-base font-bold text-white'
                                : 'text-base font-semibold text-slate-700 dark:text-slate-200'
                            }>
                            {t(f.label)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {nothingToCollect && !searching && (
                    <View className="items-center gap-1 rounded-2xl bg-green-50 p-5 dark:bg-green-950">
                      <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                      <Text className="text-xl font-bold text-green-800 dark:text-green-200">
                        {t('collection.allDoneTitle')}
                      </Text>
                      <Text className="text-base text-green-900 dark:text-green-100">
                        {t('collection.allDoneMessage', {
                          amount: formatPeso(summary.collectedToday),
                        })}
                      </Text>
                    </View>
                  )}
                  {searching && sections.length === 0 && (
                    <Text className="py-6 text-center text-base text-slate-500 dark:text-slate-400">
                      {t('collection.noMatches')}
                    </Text>
                  )}
                </>
              )}
              {activeLoans === 0 && !loadError && (
                <View className="gap-4">
                  <EmptyState
                    icon="cash-outline"
                    title={t('collection.emptyNoLoansTitle')}
                    description={t('collection.emptyNoLoansMessage')}
                  />
                  <Pressable
                    onPress={() => router.push('/loan/new')}
                    accessibilityRole="button"
                    className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
                    <Ionicons name="add-circle-outline" size={24} color="#ffffff" />
                    <Text className="text-lg font-bold text-white">
                      {t('collection.emptyNoLoansButton')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-center justify-between pt-3">
              <Text className="text-lg font-bold text-slate-900 dark:text-white">
                {t(SECTION_TITLE[section.key])} ({section.count})
              </Text>
              {section.key === 'paid' && (
                <Pressable
                  onPress={() => setPaidExpanded((v) => !v)}
                  accessibilityRole="button"
                  hitSlop={8}
                  className="min-h-12 flex-row items-center gap-1 px-2 active:opacity-60">
                  <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
                    {paidExpanded ? t('collection.hide') : t('collection.show')}
                  </Text>
                  <Ionicons
                    name={paidExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.primary}
                  />
                </Pressable>
              )}
            </View>
          )}
          renderItem={({ item }) => (
            <CollectionRowItem
              row={item}
              busy={saving}
              onCollect={onCollect}
              onMore={onMore}
              onOpen={onOpenRow}
              today={today}
              thresholds={thresholds}
            />
          )}
        />
      )}

      <CollectSheet
        visible={sheet !== null}
        borrowerName={sheet?.row.borrowerName ?? ''}
        amount={sheet?.amount ?? 0}
        preview={preview}
        saving={saving}
        onCancel={() => setSheet(null)}
        onConfirm={confirmCollect}
      />
      <RowActionsSheet
        row={actionsRow}
        onClose={() => setActionsRow(null)}
        onTodayAmount={(row, amount) => openCollect(row, amount)}
        onCustom={customAmount}
        onCall={callBorrower}
        onOpenLoan={(row) => {
          setActionsRow(null);
          openLoan(row.loanId);
        }}
      />
      <VoidPaymentModal
        visible={voiding !== null}
        amountText={voiding ? formatPeso(voiding.amount) : ''}
        dateText={formatDisplayDate(shownDate)}
        warning={voiding?.type === 'settlement' ? t('settlement.voidSettlementWarning') : undefined}
        onCancel={() => setVoiding(null)}
        onConfirm={confirmVoid}
      />
      <UndoSnackbar message={snack} undoing={undoing} onUndo={undo} onHide={hideSnack} />
    </View>
  );
}
