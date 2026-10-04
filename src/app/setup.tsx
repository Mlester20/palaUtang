import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CURRENCIES, saveProfile, type CurrencyCode } from '@/store/app-state';

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const [businessName, setBusinessName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('PHP');
  const [penaltyEnabled, setPenaltyEnabled] = useState(false);
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? '';
  const parsedPenalty = Number(penaltyAmount);

  const nameError = businessName.trim() === '' ? 'Enter your business or lender name.' : null;
  const penaltyError =
    penaltyEnabled && !(parsedPenalty > 0) ? 'Enter a penalty amount greater than 0.' : null;

  const onSave = () => {
    setSubmitted(true);
    if (nameError || penaltyError) return;

    // Root layout guards redirect to (tabs) once the profile is saved.
    saveProfile({
      businessName: businessName.trim(),
      currency,
      baldaPenaltyEnabled: penaltyEnabled,
      baldaPenaltyAmount: penaltyEnabled ? parsedPenalty : 0,
      settlementMode: 'full',
    });
  };

  return (
    // A plain View (not SafeAreaView): NativeWind only applies className to React Native core
    // components, so safe-area padding comes from the insets instead.
    <View
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="gap-6 p-6" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text className="text-3xl font-bold text-slate-900 dark:text-white">
              Set up your business
            </Text>
            <Text className="text-base text-slate-600 dark:text-slate-300">
              You can change these later.
            </Text>
          </View>

          {/* Business / lender name */}
          <View className="gap-2">
            <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Business / Lender Name
            </Text>
            <TextInput
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Aling Nena Lending"
              placeholderTextColor="#94a3b8"
              autoCapitalize="words"
              returnKeyType="done"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            {submitted && nameError && <Text className="text-sm text-red-600">{nameError}</Text>}
          </View>

          {/* Currency */}
          <View className="gap-2">
            <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Currency
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {CURRENCIES.map((c) => {
                const selected = c.code === currency;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => setCurrency(c.code)}
                    className={
                      selected
                        ? 'flex-row items-center gap-2 rounded-xl border-2 border-teal-700 bg-teal-50 px-4 py-3 dark:border-teal-400 dark:bg-teal-950'
                        : 'flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900'
                    }>
                    <Text className="text-xl font-bold text-teal-700 dark:text-teal-300">
                      {c.symbol}
                    </Text>
                    <Text className="text-base text-slate-900 dark:text-white">
                      {c.code} · {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Balda penalty rule */}
          <View className="gap-4 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold text-slate-900 dark:text-white">
                  Balda Penalty
                </Text>
                <Text className="text-sm text-slate-600 dark:text-slate-400">
                  Default fine for each missed payment day. (Optional)
                </Text>
              </View>
              <Switch
                value={penaltyEnabled}
                onValueChange={setPenaltyEnabled}
                trackColor={{ true: '#0f766e', false: '#cbd5e1' }}
                thumbColor="#ffffff"
              />
            </View>

            {penaltyEnabled && (
              <View className="gap-2">
                <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Penalty per balda day
                </Text>
                <View className="flex-row items-center rounded-xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950">
                  <Text className="text-base text-slate-500">{symbol}</Text>
                  <TextInput
                    value={penaltyAmount}
                    onChangeText={setPenaltyAmount}
                    placeholder="0.00"
                    placeholderTextColor="#94a3b8"
                    keyboardType="decimal-pad"
                    className="flex-1 px-2 py-3 text-base text-slate-900 dark:text-white"
                  />
                </View>
                {submitted && penaltyError && (
                  <Text className="text-sm text-red-600">{penaltyError}</Text>
                )}
              </View>
            )}
          </View>

          <Pressable
            onPress={onSave}
            className="items-center rounded-2xl bg-teal-700 py-4 active:bg-teal-800 dark:bg-teal-500">
            <Text className="text-lg font-semibold text-white">Save and Continue</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
