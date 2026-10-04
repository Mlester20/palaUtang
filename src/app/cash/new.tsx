import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
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

import { CashSetupCard } from '@/components/cash/CashSetupCard';
import { categoryLabel, cashErrorText, entryErrorText } from '@/components/cash/cash-text';
import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { addCashEntry, getCashSummary, type CashSummary } from '@/db/cash';
import { t } from '@/i18n';
import { confirmOwner } from '@/lib/appLock';
import { categoriesFor, validateCashEntry, type CashKind } from '@/lib/cash';
import { showError } from '@/lib/errors';
import { todayYmd } from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';

type FormKind = Extract<CashKind, 'withdrawal' | 'expense' | 'capital_in'>;

const HINT: Record<FormKind, Parameters<typeof t>[0]> = {
  withdrawal: 'cash.hintWithdrawal',
  expense: 'cash.hintExpense',
  capital_in: 'cash.hintCapitalIn',
};

/** Withdrawal / Expense / Add capital. Opened with ?kind=capital_in from "Add capital". */
export default function NewCashEntryScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const param = useLocalSearchParams<{ kind?: string }>().kind;
  const [kind, setKind] = useState<FormKind>(
    param === 'expense' || param === 'capital_in' ? param : 'withdrawal',
  );
  const [category, setCategory] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [today] = useState(todayYmd);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [cash, setCash] = useState<CashSummary | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // a double tap must never save twice

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCashSummary(db, todayYmd())
        .then((s) => active && setCash(s))
        .catch((error) => console.error('[Load cash failed]', error));
      return () => {
        active = false;
      };
    }, [db]),
  );

  const categories = categoriesFor(kind);
  const amount = parsePesoToCentavos(amountText) ?? 0;
  const input = { kind, category: categories.length > 0 ? category : null, amount, entryDate: date, note };
  const errors = cash ? validateCashEntry(input, cash.setup.ledgerStartDate, today) : [];
  const fieldError = (...codes: typeof errors) => {
    const hit = errors.find((e) => codes.includes(e));
    return submitted && hit ? entryErrorText(hit) : null;
  };

  const changeKind = (next: FormKind) => {
    setKind(next);
    setCategory(null);
  };

  const persist = async () => {
    savingRef.current = true;
    setSaving(true);
    try {
      // With App Lock on, only the owner may take money out (or add capital).
      if (!(await confirmOwner())) {
        Alert.alert(t('cash.authFailedTitle'), t('cash.authFailedMessage'));
        return;
      }
      await addCashEntry(db, input, todayYmd());
      router.back();
    } catch (error) {
      const text = cashErrorText(error);
      if (text) Alert.alert(t('cash.saveFailed'), text);
      else showError(t('cash.saveFailed'), error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const save = () => {
    setSubmitted(true);
    if (savingRef.current || !cash || errors.length > 0) return;
    // More out than the app thinks is on hand: allowed (personal money, cash kept elsewhere).
    if (kind !== 'capital_in' && cash.cashOnHand !== null && amount > cash.cashOnHand) {
      Alert.alert(
        t('cash.overdrawTitle'),
        t('cash.overdrawMessage', {
          amount: formatPeso(amount),
          onHand: formatPeso(cash.cashOnHand),
        }),
        [
          { text: t('cash.cancel'), style: 'cancel' },
          { text: t('cash.saveAnyway'), style: 'destructive', onPress: persist },
        ],
      );
      return;
    }
    persist();
  };

  if (cash === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!cash.setup.isSetUp) {
    return (
      <View className="flex-1 bg-slate-50 p-5 dark:bg-slate-950">
        <CashSetupCard />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <SegmentedControl
          value={kind}
          onChange={changeKind}
          options={[
            { value: 'withdrawal', label: t('cash.kindWithdrawal') },
            { value: 'expense', label: t('cash.kindExpense') },
            { value: 'capital_in', label: t('cash.kindCapitalIn') },
          ]}
        />
        <Text className="text-sm text-slate-600 dark:text-slate-400">{t(HINT[kind])}</Text>

        {categories.length > 0 && (
          <View className="gap-2">
            <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {t('cash.categoryLabel')}
            </Text>
            <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
              {categories.map((c) => {
                const selected = c === category;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    className={
                      selected
                        ? 'min-h-12 justify-center rounded-full bg-teal-700 px-4 dark:bg-teal-500'
                        : 'min-h-12 justify-center rounded-full border border-slate-300 bg-white px-4 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
                    }>
                    <Text
                      className={
                        selected
                          ? 'text-base font-bold text-white'
                          : 'text-base font-semibold text-slate-700 dark:text-slate-200'
                      }>
                      {categoryLabel(kind, c)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {fieldError('categoryInvalid') && (
              <Text className="text-sm font-medium text-red-600 dark:text-red-400">
                {fieldError('categoryInvalid')}
              </Text>
            )}
          </View>
        )}

        <FormField
          label={t('cash.amountLabel')}
          prefix="₱"
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={fieldError('amountInvalid', 'amountTooLarge')}
        />
        {cash.cashOnHand !== null && (
          <Text className="-mt-3 text-sm text-slate-600 dark:text-slate-400">
            {t('cash.onHandNow', { amount: formatPeso(cash.cashOnHand) })}
          </Text>
        )}

        <View className="gap-2">
          <DateField
            label={t('cash.dateLabel')}
            value={date}
            minDate={cash.setup.ledgerStartDate ?? undefined}
            maxDate={today}
            onChange={setDate}
          />
          {fieldError('beforeStart', 'futureDate') && (
            <Text className="text-sm font-medium text-red-600 dark:text-red-400">
              {fieldError('beforeStart', 'futureDate')}
            </Text>
          )}
        </View>

        <FormField
          label={t('cash.noteLabel')}
          value={note}
          onChangeText={setNote}
          placeholder={t('cash.notePlaceholder')}
          multiline
        />

        <Pressable
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          className={
            saving
              ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-60 dark:bg-teal-500'
              : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
          }>
          {saving && <ActivityIndicator color="#ffffff" />}
          <Text className="text-lg font-bold text-white">
            {amount > 0 ? t('cash.saveAmount', { amount: formatPeso(amount) }) : t('cash.save')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
