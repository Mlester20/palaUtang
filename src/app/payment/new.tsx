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

import { BottomSheet } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { ReceiptSheet } from '@/components/receipts/ReceiptSheet';
import { getLoanById } from '@/db/loans';
import {
  getLoanBalanceSummary,
  PaymentValidationError,
  previewPayment,
  recordPayment,
} from '@/db/payments';
import { t, type TranslationKey } from '@/i18n';
import { showError } from '@/lib/errors';
import { formatDisplayDate, formatShortDate, todayYmd } from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';
import type { PaymentError, PaymentPreview, PreviewLineKind } from '@/lib/payments';
import type { LoanSummary } from '@/types/loan';

const PREVIEW_DEBOUNCE_MS = 150;

const LINE_KIND: Record<PreviewLineKind, TranslationKey> = {
  recovered: 'payments.lineRecovered',
  overdue: 'payments.lineOverdue',
  today: 'payments.lineToday',
  advance: 'payments.lineAdvance',
};

export default function NewPaymentScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    loanId: string;
    amount?: string;
    from?: string;
    paidOn?: string;
  }>();
  const loanId = Number(params.loanId);
  // Optional prefill (centavos) when opened from the Collection tab's "Custom amount".
  const prefillCentavos = params.amount ? Number(params.amount) : null;
  const fromCollection = params.from === 'collection';
  const today = todayYmd();
  // Optional prefill from the loan calendar's day sheet; a future date is never used (clamped
  // to today), matching "a prefilled date = the tapped date when not in the future".
  const initialPaidOn = params.paidOn && params.paidOn <= today ? params.paidOn : today;

  const [loan, setLoan] = useState<LoanSummary | null | undefined>(undefined);
  const [balance, setBalance] = useState(0);
  const [amountText, setAmountText] = useState(() =>
    prefillCentavos !== null && Number.isSafeInteger(prefillCentavos) && prefillCentavos > 0
      ? String(prefillCentavos / 100)
      : '',
  );
  const [paidOn, setPaidOn] = useState(initialPaidOn);
  const [note, setNote] = useState('');
  // Tagged with the inputs it was computed for, so a stale preview is never shown or saved.
  const [previewState, setPreviewState] = useState<{
    amount: number;
    paidOn: string;
    result: PaymentPreview;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const previewRequest = useRef(0);
  // After a successful save: the success sheet shows until "Done" (or the receipt sheet closes).
  const [savedPaymentId, setSavedPaymentId] = useState<number | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    Promise.all([getLoanById(db, loanId), getLoanBalanceSummary(db, loanId, today)])
      .then(([l, summary]) => {
        setLoan(l);
        setBalance(summary?.balance ?? 0);
      })
      .catch((error) => {
        console.error('[Load loan failed]', error);
        setLoan(null);
      });
  }, [db, loanId, today]);

  const amount = parsePesoToCentavos(amountText);

  // Live allocation preview from the database (nothing is saved).
  useEffect(() => {
    if (amount === null || amount <= 0) return;
    const request = ++previewRequest.current;
    const timer = setTimeout(() => {
      previewPayment(db, loanId, amount, paidOn, today)
        .then((result) => {
          if (result && request === previewRequest.current)
            setPreviewState({ amount, paidOn, result });
        })
        .catch((error) => console.error('[Payment preview failed]', error));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [db, loanId, amount, paidOn, today]);

  const preview =
    previewState && previewState.amount === amount && previewState.paidOn === paidOn
      ? previewState.result
      : null;

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
          {t('payments.loanNotFound')}
        </Text>
      </View>
    );
  }

  const errorText = (code: PaymentError) =>
    ({
      notActive: t('payments.errorNotActive'),
      amountRequired: t('payments.errorAmountRequired'),
      overBalance: t('payments.errorOverBalance', { amount: formatPeso(balance) }),
      futureDate: t('payments.errorFutureDate'),
      beforeStart: t('payments.errorBeforeStart', { date: formatDisplayDate(loan.startDate) }),
    })[code];

  const quickFills = [
    ...(loan.paymentType === 'daily'
      ? [
          {
            label: t('payments.quickRegular', { amount: formatPeso(loan.installmentAmount) }),
            value: loan.installmentAmount,
          },
          {
            label: t('payments.quickDouble', { amount: formatPeso(loan.installmentAmount * 2) }),
            value: loan.installmentAmount * 2,
          },
        ]
      : []),
    { label: t('payments.quickFull'), value: balance },
  ].filter((q) => q.value > 0 && q.value <= balance);

  const errors =
    amountText.trim() !== '' && amount === null
      ? (['amountRequired'] as PaymentError[])
      : (preview?.errors ?? []);
  const canSave = amount !== null && amount > 0 && preview !== null && preview.errors.length === 0;

  const save = async () => {
    try {
      const paymentId = await recordPayment(
        db,
        { loanId, amount: amount!, paidOn, note: note.trim() || null },
        today,
      );
      setSavedMessage(
        preview!.completesLoan
          ? t('payments.savedCompleted', { amount: formatPeso(amount!) })
          : t('payments.savedMessage', {
              amount: formatPeso(amount!),
              balance: formatPeso(preview!.balanceAfter),
            }),
      );
      // Stays "busy" (Save can't be tapped again) until the success sheet is dismissed.
      setSavedPaymentId(paymentId);
    } catch (error) {
      if (error instanceof PaymentValidationError) {
        Alert.alert(t('payments.saveFailed'), error.errors.map(errorText).join('\n'));
      } else {
        showError(t('payments.saveFailed'), error);
      }
      busy.current = false;
      setSaving(false);
    }
  };

  /** Return to where the user came from (it reloads on focus), so Back can't reopen this form. */
  const finish = () => {
    busy.current = false;
    setSaving(false);
    setSavedPaymentId(null);
    setReceiptOpen(false);
    if (fromCollection) router.dismissTo('/collection');
    else router.back();
  };

  const onPressSave = () => {
    if (!canSave || busy.current) return;
    busy.current = true;
    setSaving(true);
    Alert.alert(
      t('payments.confirmTitle'),
      t('payments.confirmMessage', {
        amount: formatPeso(amount!),
        name: loan.borrowerName,
        date: formatDisplayDate(paidOn),
        balance: formatPeso(preview!.balanceAfter),
      }),
      [
        {
          text: t('payments.cancel'),
          style: 'cancel',
          onPress: () => {
            busy.current = false;
            setSaving(false);
          },
        },
        { text: t('payments.confirm'), onPress: save },
      ],
      { cancelable: false },
    );
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="gap-5 p-5" style={{ paddingBottom: insets.bottom + 24 }}>
          {/* Who + balance */}
          <View className="gap-1 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <Text className="text-lg font-bold text-slate-900 dark:text-white">
              {loan.borrowerName}
            </Text>
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {t('payments.balance')}: {formatPeso(balance)}
            </Text>
          </View>

          <FormField
            label={t('payments.amountLabel')}
            hint={t('payments.maxAllowed', { amount: formatPeso(balance) })}
            prefix="₱"
            value={amountText}
            onChangeText={setAmountText}
            placeholder={loan.paymentType === 'daily' ? String(loan.installmentAmount / 100) : '0'}
            keyboardType="decimal-pad"
            error={errors.length > 0 ? errors.map(errorText).join('\n') : null}
          />

          {quickFills.length > 0 && (
            <View className="flex-row flex-wrap gap-2">
              {quickFills.map((q) => (
                <Pressable
                  key={q.label}
                  onPress={() => setAmountText(String(q.value / 100))}
                  accessibilityRole="button"
                  className="min-h-12 justify-center rounded-full border-2 border-teal-600 bg-white px-4 active:bg-teal-50 dark:border-teal-400 dark:bg-slate-900 dark:active:bg-teal-950">
                  <Text className="text-base font-bold text-teal-800 dark:text-teal-200">
                    {q.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <DateField
            label={t('payments.dateLabel')}
            value={paidOn}
            onChange={setPaidOn}
            minDate={loan.startDate}
            maxDate={today}
          />

          <FormField
            label={t('payments.noteLabel')}
            hint={t('payments.notePlaceholder')}
            value={note}
            onChangeText={setNote}
            multiline
          />

          {/* Live allocation preview */}
          <View className="gap-3 rounded-2xl border-2 border-teal-600 bg-teal-50 p-5 dark:border-teal-500 dark:bg-teal-950">
            <Text className="text-sm font-bold uppercase text-teal-800 dark:text-teal-200">
              {t('payments.previewTitle')}
            </Text>
            {preview && preview.lines.length > 0 ? (
              <>
                {preview.lines.map((line) => (
                  <View
                    key={line.installmentId}
                    className="flex-row items-center justify-between gap-3">
                    <Text className="flex-1 text-base text-slate-800 dark:text-slate-100">
                      #{line.installmentNumber} · {formatShortDate(line.dueDate)}{' '}
                      <Text
                        className={
                          line.kind === 'recovered'
                            ? 'font-bold text-red-700 dark:text-red-300'
                            : line.kind === 'advance'
                              ? 'font-bold text-sky-700 dark:text-sky-300'
                              : 'text-slate-500 dark:text-slate-400'
                        }>
                        ({t(LINE_KIND[line.kind])})
                      </Text>
                    </Text>
                    <Text className="text-base font-bold text-slate-900 dark:text-white">
                      {formatPeso(line.amount)}
                    </Text>
                  </View>
                ))}
                <View className="flex-row justify-between border-t border-teal-200 pt-3 dark:border-teal-800">
                  <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                    {t('payments.balanceAfter')}
                  </Text>
                  <Text className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {formatPeso(preview.balanceAfter)}
                  </Text>
                </View>
                {preview.recoveredCount > 0 && (
                  <Text className="text-sm text-slate-700 dark:text-slate-300">
                    {t('payments.recoveredNote', {
                      count: preview.recoveredCount,
                      date: formatDisplayDate(preview.endDateAfter),
                    })}
                  </Text>
                )}
                {preview.completesLoan && (
                  <Text className="text-base font-bold text-green-700 dark:text-green-300">
                    {t('payments.completesLoan')}
                  </Text>
                )}
              </>
            ) : (
              <Text className="text-base text-slate-500 dark:text-slate-400">
                {t('payments.previewEmpty')}
              </Text>
            )}
          </View>

          <Pressable
            onPress={onPressSave}
            disabled={saving || !canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || !canSave, busy: saving }}
            className={
              saving || !canSave
                ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 opacity-50 dark:bg-teal-500'
                : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 active:bg-teal-800 dark:bg-teal-500'
            }>
            {saving && <ActivityIndicator color="#ffffff" />}
            <Text className="text-lg font-bold text-white">
              {saving ? t('payments.saving') : t('payments.save')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <BottomSheet visible={savedPaymentId !== null && !receiptOpen} onClose={finish}>
        <View className="gap-4 py-1">
          <View className="items-center gap-1">
            <Text className="text-xl font-bold text-slate-900 dark:text-white">
              {t('receipts.savedTitle')}
            </Text>
            <Text className="text-center text-base text-slate-600 dark:text-slate-300">
              {savedMessage}
            </Text>
          </View>
          <Pressable
            onPress={() => setReceiptOpen(true)}
            accessibilityRole="button"
            className="min-h-14 items-center justify-center rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
            <Text className="text-lg font-bold text-white">{t('receipts.shareReceipt')}</Text>
          </Pressable>
          <Pressable
            onPress={finish}
            accessibilityRole="button"
            className="min-h-14 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
            <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
              {t('receipts.done')}
            </Text>
          </Pressable>
        </View>
      </BottomSheet>
      <ReceiptSheet paymentId={receiptOpen ? savedPaymentId : null} onClose={finish} />
    </KeyboardAvoidingView>
  );
}
