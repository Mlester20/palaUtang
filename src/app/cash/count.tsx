import { router, useFocusEffect } from 'expo-router';
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
import { cashErrorText } from '@/components/cash/cash-text';
import { FormField } from '@/components/FormField';
import { getCashSummary, recordCashCount, type CashSummary } from '@/db/cash';
import { t } from '@/i18n';
import { confirmOwner } from '@/lib/appLock';
import { cashCountDifference } from '@/lib/cash';
import { showError } from '@/lib/errors';
import { formatDisplayDate, todayYmd } from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';

/** Count the cash in hand today; a difference becomes an adjustment (with a note). */
export default function CashCountScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const [cash, setCash] = useState<CashSummary | null>(null);
  const [countedText, setCountedText] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setCash(await getCashSummary(db, todayYmd()));
    } catch (error) {
      console.error('[Load cash failed]', error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (cash === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (cash.cashOnHand === null) {
    return (
      <View className="flex-1 bg-slate-50 p-5 dark:bg-slate-950">
        <CashSetupCard />
      </View>
    );
  }

  const expected = cash.cashOnHand;
  const counted = parsePesoToCentavos(countedText);
  const diff = counted === null ? null : cashCountDifference(expected, counted);
  const noteError = diff && diff.amount !== 0 && !note.trim() ? t('cash.errNoteRequired') : null;

  const save = async () => {
    setSubmitted(true);
    if (savingRef.current || counted === null || noteError) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (diff!.amount !== 0 && !(await confirmOwner())) {
        Alert.alert(t('cash.authFailedTitle'), t('cash.authFailedMessage'));
        return;
      }
      const result = await recordCashCount(
        db,
        { counted, date: cash.asOfDate, note, expectedSeen: expected },
        todayYmd(),
      );
      router.back();
      Alert.alert(
        t('cash.countSavedTitle'),
        result.entryId === null
          ? t('cash.countMatches', { amount: formatPeso(counted) })
          : t('cash.countAdjusted', {
              amount: formatPeso(Math.abs(result.difference)),
              direction: result.difference > 0 ? t('cash.dirIn') : t('cash.dirOut'),
            }),
      );
    } catch (error) {
      const text = cashErrorText(error);
      if (text) Alert.alert(t('cash.saveFailed'), text);
      else showError(t('cash.saveFailed'), error);
      load(); // a stale expected amount is refreshed
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Text className="text-base text-slate-700 dark:text-slate-200">
          {t('cash.countIntro', { date: formatDisplayDate(cash.asOfDate) })}
        </Text>
        <FormField
          label={t('cash.countedLabel')}
          prefix="₱"
          value={countedText}
          onChangeText={setCountedText}
          keyboardType="decimal-pad"
          placeholder="0.00"
          autoFocus
          error={submitted && counted === null ? t('cash.errAmountOpening') : null}
        />

        <View className="gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
          <Line label={t('cash.expected')} value={formatPeso(expected)} />
          <Line label={t('cash.counted')} value={counted === null ? '—' : formatPeso(counted)} />
          <View className="h-px bg-slate-200 dark:bg-slate-800" />
          <Line
            label={t('cash.difference')}
            value={
              diff === null
                ? '—'
                : diff.amount === 0
                  ? t('cash.noDifference')
                  : `${diff.difference > 0 ? '+' : '-'}${formatPeso(diff.amount)}`
            }
            tone={diff === null || diff.amount === 0 ? 'default' : diff.difference > 0 ? 'good' : 'bad'}
          />
        </View>

        {diff !== null && diff.amount !== 0 && (
          <FormField
            label={t('cash.countNoteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('cash.countNotePlaceholder')}
            multiline
            error={submitted ? noteError : null}
          />
        )}

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
            {diff && diff.amount !== 0 ? t('cash.countSaveAdjust') : t('cash.countSave')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Line({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-base text-slate-600 dark:text-slate-300">{label}</Text>
      <Text
        className={
          tone === 'bad'
            ? 'text-xl font-bold text-red-600 dark:text-red-400'
            : tone === 'good'
              ? 'text-xl font-bold text-green-700 dark:text-green-400'
              : 'text-xl font-bold text-slate-900 dark:text-white'
        }>
        {value}
      </Text>
    </View>
  );
}
