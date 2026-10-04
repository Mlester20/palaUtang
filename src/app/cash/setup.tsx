import { router, Stack, useLocalSearchParams } from 'expo-router';
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

import { cashErrorText } from '@/components/cash/cash-text';
import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { adjustOpening, getCashSetup, setupCash } from '@/db/cash';
import { t } from '@/i18n';
import { confirmOwner } from '@/lib/appLock';
import { MAX_CASH_AMOUNT } from '@/lib/cash';
import { showError } from '@/lib/errors';
import { todayYmd } from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';

/**
 * First-time cash setup (opening cash + ledger start date), or with ?mode=adjust the
 * "Adjust opening balance" change (needs the owner's unlock and a reason).
 */
export default function CashSetupScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const adjust = useLocalSearchParams<{ mode?: string }>().mode === 'adjust';
  const [today] = useState(todayYmd);
  const [amountText, setAmountText] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(!adjust);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Adjust mode starts from the current opening row.
  useEffect(() => {
    if (!adjust) return;
    let active = true;
    getCashSetup(db).then((setup) => {
      if (!active) return;
      if (setup.ledgerStartDate) {
        setAmountText((setup.openingAmount / 100).toFixed(2));
        setStartDate(setup.ledgerStartDate);
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [adjust, db]);

  const amount = parsePesoToCentavos(amountText);
  const amountError =
    amount === null ? t('cash.errAmountOpening') : amount > MAX_CASH_AMOUNT ? t('cash.errAmountTooLarge') : null;
  const reasonError = adjust && !note.trim() ? t('cash.errReasonRequired') : null;

  const save = async () => {
    setSubmitted(true);
    if (savingRef.current || amount === null || amountError || reasonError) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (adjust) {
        if (!(await confirmOwner())) {
          Alert.alert(t('cash.authFailedTitle'), t('cash.authFailedMessage'));
          return;
        }
        await adjustOpening(db, amount, startDate, note, todayYmd());
      } else {
        await setupCash(db, amount, startDate, note, todayYmd());
      }
      router.back();
      Alert.alert(
        adjust ? t('cash.adjustedTitle') : t('cash.setupDoneTitle'),
        t('cash.setupDoneMessage', { amount: formatPeso(amount) }),
      );
    } catch (error) {
      const text = cashErrorText(error);
      if (text) Alert.alert(t('cash.saveFailed'), text);
      else showError(t('cash.saveFailed'), error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: adjust ? t('cash.adjustTitle') : t('cash.setupTitle') }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Text className="text-base text-slate-700 dark:text-slate-200">
          {adjust ? t('cash.adjustIntro') : t('cash.setupIntro')}
        </Text>
        <FormField
          label={t('cash.openingLabel')}
          hint={t('cash.openingHint')}
          prefix="₱"
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={submitted ? amountError : null}
        />
        <View className="gap-2">
          <DateField
            label={t('cash.startDateLabel')}
            value={startDate}
            maxDate={today}
            onChange={setStartDate}
          />
          <Text className="text-sm text-slate-600 dark:text-slate-400">{t('cash.startDateHint')}</Text>
        </View>
        <FormField
          label={adjust ? t('cash.reasonLabel') : t('cash.noteLabel')}
          value={note}
          onChangeText={setNote}
          placeholder={adjust ? t('cash.reasonPlaceholder') : t('cash.notePlaceholder')}
          multiline
          error={submitted ? reasonError : null}
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
            {adjust ? t('cash.adjustSave') : t('cash.setupSave')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
