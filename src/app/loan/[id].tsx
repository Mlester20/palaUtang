import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AdvanceMarker,
  InstallmentStatusChip,
  LoanStatusBadge,
  RenewedMarker,
} from '@/components/loans/StatusBadges';
import { ProgressBar } from '@/components/loans/ProgressBar';
import { VoidPaymentModal } from '@/components/payments/VoidPaymentModal';
import { ReceiptSheet } from '@/components/receipts/ReceiptSheet';
import { StatementOptionsSheet } from '@/components/statements/StatementOptionsSheet';
import { DayDetailSheet } from '@/components/calendar/DayDetailSheet';
import { LoanCalendar } from '@/components/calendar/LoanCalendar';
import { SegmentedControl } from '@/components/SegmentedControl';
import { canCancelLoan, cancelLoan, getInstallmentsByLoan, getLoanById } from '@/db/loans';
import { getLoanCalendarData } from '@/db/loanCalendar';
import {
  getLoanBalanceSummary,
  getPaymentsByLoan,
  recomputeLoan,
  VoidBlockedError,
  voidPayment,
} from '@/db/payments';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import {
  assessProfit,
  formatDisplayDate,
  formatMonthYear,
  formatPercent,
  formatShortDate,
  todayYmd,
} from '@/lib/loan';
import type { LoanCalendarResult } from '@/lib/loanCalendar';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';
import type { LoanBalanceSummary } from '@/lib/payments';
import { shareStatement } from '@/services/statement';
import { setLoanView, useLoanView, type LoanView } from '@/store/loan-view-prefs';
import type { Installment, LoanSummary, Payment } from '@/types/loan';

type LoadedLoan = {
  loan: LoanSummary;
  installments: Installment[];
  canCancel: boolean;
  payments: Payment[];
  summary: LoanBalanceSummary;
};

/** Groups the schedule by month for sticky month headers. */
function groupByMonth(installments: Installment[]) {
  const sections: { title: string; data: Installment[] }[] = [];
  for (const inst of installments) {
    const title = formatMonthYear(inst.dueDate);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(inst);
    else sections.push({ title, data: [inst] });
  }
  return sections;
}

export default function LoanDetailScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id: string; view?: string }>();
  const id = Number(params.id);
  const [data, setData] = useState<LoadedLoan | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [receiptPaymentId, setReceiptPaymentId] = useState<number | null>(null);
  const [statementSheetOpen, setStatementSheetOpen] = useState(false);
  // The route's `view` param only decides the INITIAL tab; after that the user's own toggle wins.
  const [viewOverride, setViewOverride] = useState<LoanView | null>(
    params.view === 'calendar' || params.view === 'schedule' ? params.view : null,
  );
  const storedView = useLoanView();
  const [calendarData, setCalendarData] = useState<LoanCalendarResult | null | undefined>(undefined);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const today = todayYmd();

  const load = useCallback(async () => {
    // Bring balda/make-ups up to today before showing anything (idempotent; usually no writes).
    await recomputeLoan(db, id, today);
    const [loan, installments, canCancel, payments, summary] = await Promise.all([
      getLoanById(db, id),
      getInstallmentsByLoan(db, id),
      canCancelLoan(db, id),
      getPaymentsByLoan(db, id),
      getLoanBalanceSummary(db, id, today),
    ]);
    return loan && summary ? { loan, installments, canCancel, payments, summary } : null;
  }, [db, id, today]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load()
        .then((result) => active && setData(result))
        .catch((error) => {
          console.error('[Load loan failed]', error);
          if (active) setData(null);
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  // Daily loans default to Calendar, lump-sum to Schedule, unless the user already chose or a
  // deep link (Collection → "Open calendar") asked for one explicitly.
  const defaultView: LoanView = data?.loan.paymentType === 'daily' ? 'calendar' : 'schedule';
  const activeView: LoanView = viewOverride ?? storedView ?? defaultView;
  const changeView = (next: LoanView) => {
    setViewOverride(next);
    setLoanView(next);
  };

  // Calendar data is its own 3 queries (src/db/loanCalendar.ts), loaded only while that segment
  // is shown, and on every focus (so a payment recorded elsewhere is reflected immediately).
  // Changing the displayed MONTH never re-queries — LoanCalendar builds every month up front.
  useFocusEffect(
    useCallback(() => {
      if (!data?.loan || activeView !== 'calendar') return;
      let active = true;
      getLoanCalendarData(db, id, today)
        .then((result) => active && setCalendarData(result))
        .catch((error) => {
          console.error('[Load loan calendar failed]', error);
          if (active) setCalendarData(null);
        });
      return () => {
        active = false;
      };
    }, [db, id, today, data, activeView]),
  );

  if (data === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (data === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          This loan could not be found.
        </Text>
      </View>
    );
  }

  const { loan, installments, canCancel, payments, summary } = data;
  const progress = loan.totalCount > 0 ? loan.paidCount / loan.totalCount : 0;
  const sections = groupByMonth(installments);
  // Profit per month uses the ORIGINAL schedule length (make-up days don't change the deal).
  const originalLastDue = installments
    .filter((i) => !i.isMakeup)
    .reduce((max, i) => (i.originalDueDate > max ? i.originalDueDate : max), loan.startDate);
  const profit = assessProfit(loan.principal, loan.totalPayable, loan.startDate, originalLastDue);
  const numberById = new Map(installments.map((i) => [i.id, i.installmentNumber]));
  const missedDateById = new Map(
    installments.filter((i) => !i.isMakeup).map((i) => [i.id, i.originalDueDate]),
  );
  const selectedCalendarDay = selectedDay ? calendarData?.days.get(selectedDay) ?? null : null;

  const onVoid = async (reason: string) => {
    if (!voiding) return;
    try {
      await voidPayment(db, voiding.id, reason, today);
      setVoiding(null);
      setData(await load());
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

  const settlementPayment = payments.find((p) => p.type === 'settlement' && p.status === 'active');
  const modeLabel = (mode: string | null) =>
    mode === 'prorata'
      ? t('settlement.modeProrata')
      : mode === 'discount'
        ? t('settlement.modeDiscount')
        : t('settlement.modeFull');

  const confirmCancel = () => {
    Alert.alert(
      'Cancel this loan?',
      `The ${formatPeso(loan.principal)} loan for ${loan.borrowerName} will be marked cancelled. Its schedule is kept for your records. This cannot be undone.`,
      [
        { text: 'Keep loan', style: 'cancel' },
        {
          text: 'Cancel loan',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await cancelLoan(db, loan.id);
              setData(await load());
              Alert.alert('Loan cancelled', 'The loan is now marked as cancelled.');
            } catch (error) {
              showError('Could not cancel the loan', error);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const header = (
    <View className="gap-4 pb-4">
      {/* Summary */}
      <View className="gap-4 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <View className="flex-row items-start justify-between gap-3">
          <Pressable
            onPress={() =>
              router.push({ pathname: '/borrower/[id]', params: { id: String(loan.borrowerId) } })
            }
            accessibilityRole="link"
            hitSlop={8}
            className="flex-1 active:opacity-60">
            <Text className="text-sm text-slate-500 dark:text-slate-400">Borrower</Text>
            <View className="flex-row items-center gap-1">
              <Text
                className="flex-shrink text-xl font-bold text-teal-700 dark:text-teal-300"
                numberOfLines={1}>
                {loan.borrowerName}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </View>
          </Pressable>
          <View className="items-end gap-1">
            <LoanStatusBadge status={loan.status} />
            {loan.renewedByLoanId !== null && <RenewedMarker />}
          </View>
        </View>

        <View className="gap-1">
          <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Total payable
          </Text>
          <Text
            className="text-3xl font-extrabold text-slate-900 dark:text-white"
            numberOfLines={1}
            adjustsFontSizeToFit>
            {formatPeso(loan.totalPayable)}
          </Text>
        </View>

        <View className="gap-2">
          <Row label="Principal" value={formatPeso(loan.principal)} />
          <Row
            label="Profit (tubo)"
            value={`${formatPeso(profit.profitCentavos)} · ${formatPercent(profit.ratePercent)} (≈${formatPercent(profit.monthlyRatePercent)}/mo)`}
          />
          {loan.paymentType === 'daily' ? (
            <>
              <Row
                label="Hulog"
                value={`${formatPeso(loan.installmentAmount)} × ${loan.numberOfInstallments} days`}
              />
              <Row label="Skip Sundays" value={loan.skipSundays ? 'Yes' : 'No'} />
            </>
          ) : (
            <Row label="Payment" value="Lump sum (one payment)" />
          )}
          <Row label="Start date" value={formatDisplayDate(loan.startDate)} />
          <Row
            label={loan.paymentType === 'daily' ? 'Last due date' : 'Due date'}
            value={formatDisplayDate(loan.endDate)}
          />
          {loan.notes && <Row label="Notes" value={loan.notes} />}
        </View>
      </View>

      {/* Progress */}
      <View className="gap-2 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-lg font-bold text-slate-900 dark:text-white">
            {loan.paidCount}/{loan.totalCount} paid
          </Text>
          <Text className="text-base text-slate-600 dark:text-slate-300">
            {formatPeso(loan.amountPaid)} collected
          </Text>
        </View>
        <ProgressBar value={progress} />
      </View>

      {/* Balance (always derived from active payments) */}
      <View className="gap-3 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
          {t('payments.summaryTitle')}
        </Text>
        <View className="flex-row gap-3">
          <Stat label={t('payments.paid')} value={formatPeso(summary.totalPaid)} />
          <Stat label={t('payments.balance')} value={formatPeso(summary.balance)} strong />
        </View>
        <View className="flex-row gap-3">
          <Stat
            label={t('payments.overdue')}
            value={formatPeso(summary.overdueAmount)}
            danger={summary.overdueAmount > 0}
          />
          {loan.paymentType === 'daily' ? (
            <Stat
              label={t('payments.baldaDays')}
              value={String(summary.baldaDays)}
              danger={summary.baldaDays > 0}
            />
          ) : (
            <Stat
              label={t('payments.overdue')}
              value={
                summary.daysOverdue === 0
                  ? t('payments.none')
                  : summary.daysOverdue === 1
                    ? t('payments.oneDayOverdue')
                    : t('payments.daysOverdue', { days: summary.daysOverdue })
              }
              danger={summary.daysOverdue > 0}
            />
          )}
        </View>
        <Row
          label={t('payments.nextDue')}
          value={
            summary.balance <= 0
              ? t('payments.fullyPaid')
              : summary.nextDue
                ? t('payments.nextDueValue', {
                    amount: formatPeso(summary.nextDue.amount),
                    date: formatShortDate(summary.nextDue.date),
                  })
                : t('payments.none')
          }
        />
      </View>

      {/* Closed early (settlement) */}
      {loan.status === 'closed_early' && (
        <View className="gap-3 rounded-2xl border-2 border-violet-300 bg-violet-50 p-5 dark:border-violet-800 dark:bg-violet-950">
          <Text className="text-sm font-bold uppercase text-violet-800 dark:text-violet-200">
            {t('settlement.closedTitle')}
          </Text>
          <Row
            label={t('settlement.closedOn')}
            value={loan.closedAt ? formatDisplayDate(loan.closedAt) : '—'}
          />
          {settlementPayment && (
            <Row
              label={t('settlement.settlementAmount')}
              value={`${formatPeso(settlementPayment.amount)}${
                settlementPayment.isNetted ? ` · ${t('settlement.labelNetted')}` : ''
              }`}
            />
          )}
          <Row label={t('settlement.discount')} value={formatPeso(loan.discountAmount)} />
          <Row label={t('settlement.mode')} value={modeLabel(loan.settlementMode)} />
          {loan.closedReason && <Row label={t('settlement.note')} value={loan.closedReason} />}
          {settlementPayment && (
            <Pressable
              onPress={() => setVoiding(settlementPayment)}
              accessibilityRole="button"
              className="min-h-12 items-center justify-center rounded-xl border border-red-300 bg-white active:opacity-70 dark:border-red-900 dark:bg-slate-900">
              <Text className="text-base font-bold text-red-600 dark:text-red-400">
                {t('settlement.voidSettlement')}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Renewal links */}
      {loan.renewedByLoanId !== null && (
        <LinkRow
          text={t('settlement.renewedInto', { id: loan.renewedByLoanId })}
          onPress={() =>
            router.push({ pathname: '/loan/[id]', params: { id: String(loan.renewedByLoanId) } })
          }
        />
      )}
      {loan.renewedFromLoanId !== null && (
        <LinkRow
          text={t('settlement.renewedFrom', { id: loan.renewedFromLoanId })}
          onPress={() =>
            router.push({ pathname: '/loan/[id]', params: { id: String(loan.renewedFromLoanId) } })
          }
        />
      )}

      {/* Actions */}
      {loan.status === 'active' && (
        <Pressable
          onPress={() =>
            router.push({ pathname: '/loan/settle', params: { loanId: String(loan.id) } })
          }
          accessibilityRole="button"
          className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-violet-400 bg-white active:opacity-70 dark:border-violet-700 dark:bg-slate-900">
          <Ionicons name="flag-outline" size={22} color={colors.accent} />
          <Text className="text-lg font-bold text-violet-700 dark:text-violet-300">
            {t('settlement.settleEarly')}
          </Text>
        </Pressable>
      )}
      {loan.status === 'active' && (
        <Pressable
          onPress={() =>
            router.push({ pathname: '/payment/new', params: { loanId: String(loan.id) } })
          }
          accessibilityRole="button"
          className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
          <Ionicons name="cash-outline" size={24} color="#ffffff" />
          <Text className="text-lg font-bold text-white">{t('payments.recordPayment')}</Text>
        </Pressable>
      )}
      {canCancel && (
        <Pressable
          onPress={confirmCancel}
          disabled={busy}
          accessibilityRole="button"
          className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-red-300 bg-white active:opacity-70 dark:border-red-900 dark:bg-slate-900">
          <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
          <Text className="text-lg font-bold text-red-600 dark:text-red-400">Cancel loan</Text>
        </Pressable>
      )}
      <Pressable
        onPress={() => setStatementSheetOpen(true)}
        accessibilityRole="button"
        className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-teal-700 bg-white active:opacity-70 dark:border-teal-400 dark:bg-slate-900">
        <Ionicons name="document-text-outline" size={22} color={colors.primary} />
        <Text className="text-lg font-bold text-teal-700 dark:text-teal-300">
          {t('statements.shareLoanStatement')}
        </Text>
      </Pressable>

      {/* Payment history (voided payments stay, clearly marked) */}
      <View className="gap-3">
        <Text className="pt-2 text-xl font-bold text-slate-900 dark:text-white">
          {t('payments.historyTitle')} ({payments.length})
        </Text>
        {payments.length === 0 ? (
          <Text className="text-base text-slate-500 dark:text-slate-400">
            {t('payments.noPayments')}
          </Text>
        ) : (
          <View className="rounded-2xl bg-white px-4 dark:bg-slate-900">
            {payments.map((p, i) => {
              const voided = p.status === 'voided';
              return (
                <View
                  key={p.id}
                  className={[
                    'min-h-16 flex-row items-center gap-3 py-3',
                    i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : '',
                  ].join(' ')}>
                  <View className="flex-1 gap-0.5">
                    <Text
                      className={
                        voided
                          ? 'text-lg font-bold text-slate-400 line-through dark:text-slate-500'
                          : 'text-lg font-bold text-slate-900 dark:text-white'
                      }>
                      {formatPeso(p.amount)}
                    </Text>
                    <Text className="text-sm text-slate-600 dark:text-slate-300">
                      {formatDisplayDate(p.paidOn)}
                    </Text>
                    {p.type === 'settlement' && (
                      <Text className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                        {p.isNetted
                          ? t('settlement.labelNetted')
                          : t('settlement.labelEarlyPayoff')}
                      </Text>
                    )}
                    {p.note && (
                      <Text className="text-sm text-slate-500 dark:text-slate-400">{p.note}</Text>
                    )}
                    {voided && (
                      <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
                        {t('payments.voidedReason', { reason: p.voidReason ?? '' })}
                      </Text>
                    )}
                  </View>
                  {!voided && (
                    <View className="flex-row gap-2">
                      <Pressable
                        onPress={() => setReceiptPaymentId(p.id)}
                        accessibilityRole="button"
                        className="min-h-12 justify-center rounded-xl border border-sky-300 px-4 active:opacity-70 dark:border-sky-800">
                        <Text className="text-base font-bold text-sky-700 dark:text-sky-300">
                          {t('receipts.receiptAction')}
                        </Text>
                      </Pressable>
                      {loan.status !== 'cancelled' && (
                        <Pressable
                          onPress={() => setVoiding(p)}
                          accessibilityRole="button"
                          className="min-h-12 justify-center rounded-xl border border-red-300 px-4 active:opacity-70 dark:border-red-900">
                          <Text className="text-base font-bold text-red-600 dark:text-red-400">
                            {t('payments.void')}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <SegmentedControl
        value={activeView}
        onChange={changeView}
        options={[
          { value: 'schedule', label: t('calendar.segSchedule') },
          { value: 'calendar', label: t('calendar.segCalendar') },
        ]}
      />

      {activeView === 'calendar' &&
        (calendarData === undefined ? (
          <View className="items-center py-10">
            <ActivityIndicator size="large" />
          </View>
        ) : calendarData === null ? (
          <Text className="py-6 text-center text-base text-slate-500 dark:text-slate-400">
            Could not load the calendar. Pull down to try again.
          </Text>
        ) : loan.status === 'cancelled' ? (
          <View className="items-center gap-2 rounded-2xl bg-slate-100 p-6 dark:bg-slate-800">
            <Ionicons name="ban-outline" size={28} color={colors.textMuted} />
            <Text className="text-base font-bold text-slate-600 dark:text-slate-300">
              {t('calendar.cancelledBanner')}
            </Text>
          </View>
        ) : (
          <LoanCalendar
            result={calendarData}
            paymentType={loan.paymentType}
            today={today}
            onDayPress={setSelectedDay}
          />
        ))}

      {activeView === 'schedule' && (
        <Text className="pt-2 text-xl font-bold text-slate-900 dark:text-white">
          Schedule ({installments.length})
        </Text>
      )}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: `Loan · ${loan.borrowerName}` }} />
      <SectionList
        className="flex-1 bg-slate-50 dark:bg-slate-950"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: insets.bottom + 24,
        }}
        sections={activeView === 'schedule' ? sections : []}
        keyExtractor={(item) => String(item.id)}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        initialNumToRender={20}
        windowSize={10}
        renderSectionHeader={({ section }) => (
          <View className="bg-slate-50 py-2 dark:bg-slate-950">
            <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const skipped = item.status === 'skipped';
          return (
            <View
              className={[
                'min-h-14 flex-row items-center gap-3 px-4 py-3',
                item.isMakeup ? 'bg-amber-50 dark:bg-amber-950' : 'bg-white dark:bg-slate-900',
                index === 0 ? 'rounded-t-2xl' : 'border-t border-slate-100 dark:border-slate-800',
                index === section.data.length - 1 ? 'mb-3 rounded-b-2xl' : '',
                skipped ? 'opacity-50' : '',
              ].join(' ')}>
              <Text className="w-10 text-base font-bold text-slate-500 dark:text-slate-400">
                #{item.installmentNumber}
              </Text>
              <View className="flex-1 gap-0.5">
                <Text className="text-base text-slate-900 dark:text-white">
                  {formatShortDate(item.dueDate)}
                </Text>
                {item.isMakeup && item.makeupForInstallmentId !== null && (
                  <Text className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    {t('payments.makeupFor', {
                      number: numberById.get(item.makeupForInstallmentId) ?? '?',
                    })}
                  </Text>
                )}
                {item.waivedAmount > 0 && (
                  <Text className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {t('settlement.waived', { amount: formatPeso(item.waivedAmount) })}
                  </Text>
                )}
                {item.amountPaid > 0 && item.amountPaid < item.amountDue && (
                  <Text className="text-xs text-slate-500 dark:text-slate-400">
                    {t('payments.paidOf', {
                      paid: formatPeso(item.amountPaid),
                      due: formatPeso(item.amountDue),
                    })}
                  </Text>
                )}
              </View>
              <Text
                className={
                  skipped
                    ? 'text-base font-bold text-slate-400 line-through dark:text-slate-500'
                    : 'text-base font-bold text-slate-900 dark:text-white'
                }>
                {formatPeso(item.amountDue)}
              </Text>
              <View className="items-end gap-1">
                <InstallmentStatusChip status={item.status} paymentType={loan.paymentType} />
                {item.status === 'paid' && item.dueDate > today && <AdvanceMarker />}
              </View>
            </View>
          );
        }}
      />
      <VoidPaymentModal
        visible={voiding !== null}
        amountText={voiding ? formatPeso(voiding.amount) : ''}
        dateText={voiding ? formatDisplayDate(voiding.paidOn) : ''}
        onCancel={() => setVoiding(null)}
        warning={voiding?.type === 'settlement' ? t('settlement.voidSettlementWarning') : undefined}
        onConfirm={onVoid}
      />
      <ReceiptSheet paymentId={receiptPaymentId} onClose={() => setReceiptPaymentId(null)} />
      <StatementOptionsSheet
        visible={statementSheetOpen}
        onClose={() => setStatementSheetOpen(false)}
        onGenerate={(options) => shareStatement(db, { loanId: loan.id }, options)}
      />
      <DayDetailSheet
        day={selectedCalendarDay}
        paymentType={loan.paymentType}
        skipSundays={loan.skipSundays}
        loanStatus={loan.status}
        totalCount={loan.totalCount}
        missedDateById={missedDateById}
        onClose={() => setSelectedDay(null)}
        onRecordPayment={(date) => {
          setSelectedDay(null);
          router.push({
            pathname: '/payment/new',
            params: { loanId: String(loan.id), paidOn: date },
          });
        }}
        onReceipt={(paymentId) => setReceiptPaymentId(paymentId)}
      />
    </>
  );
}

function LinkRow({ text, onPress }: { text: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      className="min-h-12 flex-row items-center justify-between rounded-2xl bg-white px-4 active:opacity-70 dark:bg-slate-900">
      <Text className="text-base font-semibold text-sky-700 dark:text-sky-300">{text}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.info} />
    </Pressable>
  );
}

function Stat({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <View className="flex-1 gap-0.5">
      <Text className="text-sm text-slate-500 dark:text-slate-400">{label}</Text>
      <Text
        className={
          danger
            ? 'text-xl font-extrabold text-red-600 dark:text-red-400'
            : strong
              ? 'text-xl font-extrabold text-slate-900 dark:text-white'
              : 'text-xl font-bold text-slate-800 dark:text-slate-100'
        }
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
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
