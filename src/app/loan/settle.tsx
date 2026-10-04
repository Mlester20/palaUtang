import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { getLoanById } from '@/db/loans';
import { getLoanBalanceSummary } from '@/db/payments';
import { settleErrorText, settlementErrorLines } from '@/components/loans/settlement-messages';
import { previewSettlement, settleLoan, type SettlementPreview } from '@/db/settlement';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import { formatDisplayDate, todayYmd } from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';
import type { LoanBalanceSummary } from '@/lib/payments';
import { useThemeColors } from '@/lib/theme';
import { useAppState } from '@/store/app-state';
import type { LoanSummary, SettlementMode } from '@/types/loan';

const MODES: {
  mode: SettlementMode;
  title: 'modeFull' | 'modeProrata' | 'modeDiscount';
  hint: 'modeFullHint' | 'modeProrataHint' | 'modeDiscountHint';
}[] = [
  { mode: 'full', title: 'modeFull', hint: 'modeFullHint' },
  { mode: 'prorata', title: 'modeProrata', hint: 'modeProrataHint' },
  { mode: 'discount', title: 'modeDiscount', hint: 'modeDiscountHint' },
];

export default function SettleLoanScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const loanId = Number(useLocalSearchParams<{ loanId: string }>().loanId);
  const { profile } = useAppState();
  const today = todayYmd();

  const [loan, setLoan] = useState<LoanSummary | null | undefined>(undefined);
  const [summary, setSummary] = useState<LoanBalanceSummary | null>(null);
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<SettlementMode>(profile?.settlementMode ?? 'full');
  const [discountText, setDiscountText] = useState('');
  const [note, setNote] = useState('');
  const [previews, setPreviews] = useState<Partial<Record<SettlementMode, SettlementPreview>>>({});
  const [previewKey, setPreviewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const request = useRef(0);

  const discount = parsePesoToCentavos(discountText);

  useEffect(() => {
    Promise.all([getLoanById(db, loanId), getLoanBalanceSummary(db, loanId, today)])
      .then(([l, s]) => {
        setLoan(l);
        setSummary(s);
      })
      .catch((error) => {
        console.error('[Load loan failed]', error);
        setLoan(null);
      });
  }, [db, loanId, today]);

  // Live amounts for all three modes (nothing is saved).
  useEffect(() => {
    const current = ++request.current;
    const key = `${date}|${discount ?? ''}`;
    Promise.all(
      MODES.map(({ mode: m }) =>
        m === 'discount' && discount === null
          ? Promise.resolve(null)
          : previewSettlement(
              db,
              { loanId, settlementDate: date, mode: m, discount: discount ?? 0 },
              today,
            ),
      ),
    )
      .then((results) => {
        if (current !== request.current) return;
        const next: Partial<Record<SettlementMode, SettlementPreview>> = {};
        MODES.forEach(({ mode: m }, i) => {
          if (results[i]) next[m] = results[i]!;
        });
        setPreviews(next);
        setPreviewKey(key);
      })
      .catch((error) => console.error('[Settlement preview failed]', error));
  }, [db, loanId, date, discount, today]);

  if (loan === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (loan === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          {t('settlement.notFound')}
        </Text>
      </View>
    );
  }

  // Only trust previews computed for the current date/discount.
  const fresh = previewKey === `${date}|${discount ?? ''}`;
  const chosen = fresh ? previews[mode] : undefined;
  const dateErrors = chosen?.dateErrors ?? [];
  const messageCtx = {
    startDate: loan.startDate,
    latestPaymentDate: chosen?.latestPaymentDate ?? null,
    balance: chosen?.remainingBalance ?? summary?.balance ?? 0,
  };
  const errorLines = [
    ...settlementErrorLines(dateErrors, chosen?.errors ?? [], messageCtx),
    ...(mode === 'discount' && discountText.trim() !== '' && discount === null
      ? [t('settlement.errorDiscount', { amount: formatPeso(messageCtx.balance) })]
      : []),
  ];
  const canSave = chosen !== undefined && errorLines.length === 0 && chosen.settlementAmount > 0;

  const settleOptions = () => ({
    loanId,
    settlementDate: date,
    mode,
    discount: mode === 'discount' ? (discount ?? 0) : undefined,
    note: note.trim() || null,
  });

  const doSettle = async () => {
    try {
      await settleLoan(
        db,
        { ...settleOptions(), expectedAmount: chosen!.settlementAmount },
        todayYmd(),
      );
      router.replace({ pathname: '/loan/[id]', params: { id: String(loanId) } });
      Alert.alert(
        t('settlement.savedTitle'),
        t('settlement.savedMessage', { amount: formatPeso(chosen!.settlementAmount) }),
      );
    } catch (error) {
      const text = settleErrorText(error, messageCtx);
      if (text) Alert.alert(t('settlement.saveFailed'), text);
      else showError(t('settlement.saveFailed'), error);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const release = () => {
    busy.current = false;
    setSaving(false);
  };

  /** Loss check: a second, explicit confirmation when the lender would end up below principal. */
  const confirmLossThen = (next: () => void) => {
    if (!chosen || chosen.lenderLoss <= 0) return next();
    Alert.alert(
      t('settlement.lossConfirmTitle'),
      t('settlement.lossConfirmMessage', { amount: formatPeso(chosen.lenderLoss) }),
      [
        { text: t('settlement.cancel'), style: 'cancel', onPress: release },
        { text: t('settlement.lossConfirm'), style: 'destructive', onPress: next },
      ],
      { cancelable: false },
    );
  };

  const onSettle = () => {
    if (!canSave || busy.current) return;
    busy.current = true;
    setSaving(true);
    Alert.alert(
      t('settlement.confirmTitle'),
      t('settlement.confirmMessage', {
        amount: formatPeso(chosen.settlementAmount),
        name: loan.borrowerName,
        date: formatDisplayDate(date),
        discount: formatPeso(chosen.discountAmount),
      }),
      [
        { text: t('settlement.cancel'), style: 'cancel', onPress: release },
        { text: t('settlement.confirm'), onPress: () => confirmLossThen(doSettle) },
      ],
      { cancelable: false },
    );
  };

  const onSettleAndRenew = () => {
    if (!canSave || busy.current) return;
    // Nothing is saved yet: the renewal form saves both in one transaction.
    const go = () =>
      router.push({
        pathname: '/loan/new',
        params: {
          borrowerId: String(loan.borrowerId),
          renewedFromLoanId: String(loanId),
          settleDate: date,
          settleMode: mode,
          settleDiscount: mode === 'discount' ? String(discount ?? 0) : '',
          settleNote: note.trim(),
        },
      });
    confirmLossThen(go);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="gap-5 p-5" style={{ paddingBottom: insets.bottom + 24 }}>
          {/* Loan summary */}
          <View className="gap-3 rounded-2xl bg-white p-5 dark:bg-slate-900">
            <Text className="text-xl font-bold text-slate-900 dark:text-white" numberOfLines={1}>
              {loan.borrowerName}
            </Text>
            <Row label={t('settlement.principal')} value={formatPeso(loan.principal)} />
            <Row label={t('settlement.totalPayable')} value={formatPeso(loan.totalPayable)} />
            <Row label={t('settlement.paidSoFar')} value={formatPeso(loan.amountPaid)} />
            <Row label={t('settlement.balance')} value={formatPeso(summary?.balance ?? 0)} strong />
            {(summary?.overdueAmount ?? 0) > 0 && (
              <Row
                label={t('settlement.overdue')}
                value={`${formatPeso(summary!.overdueAmount)}${
                  summary!.baldaDays > 0
                    ? ` · ${summary!.baldaDays} ${t('settlement.baldaDays').toLowerCase()}`
                    : ''
                }`}
                danger
              />
            )}
          </View>

          <DateField
            label={t('settlement.dateLabel')}
            value={date}
            onChange={setDate}
            minDate={loan.startDate}
            maxDate={today}
          />

          {/* Mode cards, side by side */}
          <View className="gap-2">
            <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {t('settlement.modeTitle')}
            </Text>
            <View className="flex-row gap-2">
              {MODES.map(({ mode: m, title, hint }) => {
                const selected = m === mode;
                const p = fresh ? previews[m] : undefined;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    className={
                      selected
                        ? 'min-h-28 flex-1 gap-1 rounded-2xl border-2 border-teal-600 bg-teal-50 p-3 dark:border-teal-400 dark:bg-teal-950'
                        : 'min-h-28 flex-1 gap-1 rounded-2xl border border-slate-300 bg-white p-3 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
                    }>
                    <Text className="text-base font-bold text-slate-900 dark:text-white">
                      {t(`settlement.${title}`)}
                    </Text>
                    <Text
                      className="text-lg font-extrabold text-teal-800 dark:text-teal-200"
                      numberOfLines={1}
                      adjustsFontSizeToFit>
                      {p && p.errors.length === 0 ? formatPeso(p.settlementAmount) : '—'}
                    </Text>
                    <Text className="text-xs text-slate-600 dark:text-slate-400">
                      {t(`settlement.${hint}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {mode === 'discount' && (
            <FormField
              label={t('settlement.discountLabel')}
              prefix="₱"
              value={discountText}
              onChangeText={setDiscountText}
              placeholder="300"
              keyboardType="decimal-pad"
            />
          )}

          {errorLines.length > 0 && (
            <View className="gap-1 rounded-xl bg-red-50 p-4 dark:bg-red-950">
              {errorLines.map((line) => (
                <Text key={line} className="text-base font-medium text-red-700 dark:text-red-300">
                  • {line}
                </Text>
              ))}
            </View>
          )}

          {/* Breakdown */}
          {chosen && chosen.errors.length === 0 && (
            <View className="gap-3 rounded-2xl border-2 border-teal-600 bg-white p-5 dark:border-teal-500 dark:bg-slate-900">
              <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
                {t('settlement.breakdownTitle')}
              </Text>
              <Row
                label={t('settlement.remainingBalance')}
                value={formatPeso(chosen.remainingBalance)}
              />
              {mode === 'prorata' && (
                <Row
                  label={t('settlement.unearnedInterest')}
                  value={formatPeso(chosen.unearnedInterest)}
                />
              )}
              <Row
                label={t('settlement.discount')}
                value={`− ${formatPeso(chosen.discountAmount)}`}
              />
              <View className="gap-1 border-t border-slate-200 pt-3 dark:border-slate-700">
                <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  {t('settlement.amountToCollect')}
                </Text>
                <Text
                  className="text-4xl font-extrabold text-slate-900 dark:text-white"
                  numberOfLines={1}
                  adjustsFontSizeToFit>
                  {formatPeso(chosen.settlementAmount)}
                </Text>
              </View>
              <Row
                label={t('settlement.resultingProfit')}
                value={formatPeso(chosen.resultingProfit)}
                danger={chosen.resultingProfit < 0}
              />
            </View>
          )}

          {chosen && chosen.lenderLoss > 0 && (
            <View className="flex-row gap-3 rounded-2xl border-2 border-red-400 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950">
              <Ionicons name="warning" size={24} color={colors.danger} />
              <View className="flex-1 gap-1">
                <Text className="text-base font-bold text-red-800 dark:text-red-200">
                  {t('settlement.lossTitle')}
                </Text>
                <Text className="text-base text-red-800 dark:text-red-200">
                  {t('settlement.lossMessage', {
                    amount: formatPeso(chosen.lenderLoss),
                    profit: formatPeso(chosen.resultingProfit),
                  })}
                </Text>
              </View>
            </View>
          )}

          <FormField
            label={t('settlement.noteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('settlement.notePlaceholder')}
            multiline
          />

          <View className="gap-3">
            <Pressable
              onPress={onSettle}
              disabled={!canSave || saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave || saving, busy: saving }}
              className={
                canSave && !saving
                  ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
                  : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-50 dark:bg-teal-500'
              }>
              {saving && <ActivityIndicator color="#ffffff" />}
              <Text className="text-lg font-bold text-white">
                {saving ? t('settlement.saving') : t('settlement.settle')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onSettleAndRenew}
              disabled={!canSave || saving}
              accessibilityRole="button"
              className={
                canSave && !saving
                  ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-teal-700 bg-white active:opacity-70 dark:border-teal-400 dark:bg-slate-900'
                  : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-teal-700 bg-white opacity-50 dark:border-teal-400 dark:bg-slate-900'
              }>
              <Ionicons name="refresh" size={22} color={colors.primary} />
              <Text className="text-lg font-bold text-teal-800 dark:text-teal-200">
                {t('settlement.settleAndRenew')}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({
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
    <View className="flex-row items-baseline justify-between gap-4">
      <Text className="text-base text-slate-600 dark:text-slate-300">{label}</Text>
      <Text
        className={
          danger
            ? 'text-base font-bold text-red-600 dark:text-red-400'
            : strong
              ? 'text-lg font-extrabold text-slate-900 dark:text-white'
              : 'text-base font-semibold text-slate-900 dark:text-white'
        }>
        {value}
      </Text>
    </View>
  );
}
