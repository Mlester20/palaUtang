import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '@/components/FormField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import type { LoanInputMode, PaymentType } from '@/lib/loan';
import { money } from '@/lib/csv';
import { validatePresetInput, type PresetInput } from '@/lib/presets';
import { useThemeColors } from '@/lib/theme';

export interface PresetFormInitialValues {
  name: string;
  paymentType: PaymentType;
  inputMode: LoanInputMode;
  principal: number | null;
  interestRate: number | null;
  installmentAmount: number | null;
  numberOfInstallments: number;
  skipSundays: boolean;
}

type PresetFormProps = {
  initialValues?: PresetFormInitialValues;
  submitLabel: string;
  onSubmit: (input: PresetInput) => Promise<void>;
};

/** Add / edit a loan preset. Validation reuses computeLoanPreview via validatePresetInput — the
 * exact rules the loan form itself uses — so a saved preset can never fail there. */
export function PresetForm({ initialValues, submitLabel, onSubmit }: PresetFormProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [paymentType, setPaymentType] = useState<PaymentType>(initialValues?.paymentType ?? 'daily');
  const [inputMode, setInputMode] = useState<LoanInputMode>(initialValues?.inputMode ?? 'rate');
  const [includePrincipal, setIncludePrincipal] = useState(initialValues?.principal !== null);
  const [principalText, setPrincipalText] = useState(
    initialValues?.principal != null ? money(initialValues.principal)!.csvNumber : '',
  );
  const [rateText, setRateText] = useState(
    initialValues?.interestRate != null ? String(initialValues.interestRate) : '',
  );
  const [amountText, setAmountText] = useState(
    initialValues?.installmentAmount != null ? money(initialValues.installmentAmount)!.csvNumber : '',
  );
  const [termText, setTermText] = useState(
    initialValues ? String(initialValues.numberOfInstallments) : '',
  );
  const [skipSundays, setSkipSundays] = useState(initialValues?.skipSundays ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const isDaily = paymentType === 'daily';
  const parsePeso = (text: string) => {
    const n = Number(text.replace(/[₱,\s]/g, ''));
    return text.trim() !== '' && Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const principal = includePrincipal ? parsePeso(principalText) : null;
  const rate = /^\d+(\.\d+)?$/.test(rateText.trim()) ? Number(rateText.trim()) : null;
  const amount = parsePeso(amountText);
  const term = /^\d+$/.test(termText.trim()) ? Number(termText.trim()) : null;

  const input: PresetInput = {
    name,
    paymentType,
    inputMode,
    principal,
    interestRate: inputMode === 'rate' ? rate : null,
    installmentAmount: inputMode === 'installment' ? amount : null,
    numberOfInstallments: term ?? 0,
    skipSundays: isDaily && skipSundays,
  };
  const { nameError, previewErrors } = validatePresetInput(input);
  const termError = term === null ? t('presets.errTerm') : null;
  const fieldError =
    inputMode === 'rate'
      ? rate === null
        ? t('presets.errRate')
        : null
      : amount === null
        ? t('presets.errAmount')
        : null;

  const save = async () => {
    setSubmitted(true);
    if (nameError || termError || fieldError || previewErrors.length > 0 || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await onSubmit(input);
    } catch (error) {
      showError(t('presets.saveFailed'), error);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="gap-5 p-5" style={{ paddingBottom: insets.bottom + 24 }}>
          <FormField
            label={t('presets.nameLabel')}
            value={name}
            onChangeText={setName}
            placeholder={t('presets.namePlaceholder')}
            error={submitted ? nameError : null}
          />

          <SegmentedControl
            label={t('presets.paymentTypeLabel')}
            value={paymentType}
            onChange={setPaymentType}
            options={[
              { value: 'daily', label: t('presets.daily') },
              { value: 'lump_sum', label: t('presets.lumpSum') },
            ]}
          />

          <SegmentedControl
            label={t('presets.inputModeLabel')}
            value={inputMode}
            onChange={setInputMode}
            options={[
              { value: 'rate', label: t('presets.byRate') },
              { value: 'installment', label: isDaily ? t('presets.byDailyAmount') : t('presets.byAmount') },
            ]}
          />

          <View className="min-h-12 flex-row items-center justify-between gap-4">
            <View className="flex-1 gap-0.5">
              <Text className="text-base font-semibold text-slate-900 dark:text-white">
                {t('presets.includePrincipal')}
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">
                {t('presets.includePrincipalHint')}
              </Text>
            </View>
            <Switch
              value={includePrincipal}
              onValueChange={setIncludePrincipal}
              trackColor={{ true: colors.primary, false: '#cbd5e1' }}
              thumbColor="#ffffff"
            />
          </View>
          {includePrincipal && (
            <FormField
              label={t('presets.principalLabel')}
              prefix="₱"
              value={principalText}
              onChangeText={setPrincipalText}
              placeholder="5000"
              keyboardType="decimal-pad"
            />
          )}

          {inputMode === 'rate' ? (
            <FormField
              label={t('presets.rateLabel')}
              suffix="%"
              value={rateText}
              onChangeText={setRateText}
              placeholder="20"
              keyboardType="decimal-pad"
              error={submitted ? fieldError : null}
            />
          ) : (
            <FormField
              label={isDaily ? t('presets.dailyAmountLabel') : t('presets.amountLabel')}
              prefix="₱"
              value={amountText}
              onChangeText={setAmountText}
              placeholder={isDaily ? '150' : '5500'}
              keyboardType="decimal-pad"
              error={submitted ? fieldError : null}
            />
          )}

          <FormField
            label={isDaily ? t('presets.termDailyLabel') : t('presets.termLumpLabel')}
            suffix={t('presets.days')}
            value={termText}
            onChangeText={setTermText}
            placeholder={isDaily ? '40' : '30'}
            keyboardType="number-pad"
            error={submitted ? termError : null}
          />

          {isDaily && (
            <View className="min-h-14 flex-row items-center justify-between gap-4 rounded-2xl bg-white px-4 py-3 dark:bg-slate-900">
              <Text className="flex-1 text-base font-semibold text-slate-900 dark:text-white">
                {t('presets.skipSundays')}
              </Text>
              <Switch
                value={skipSundays}
                onValueChange={setSkipSundays}
                trackColor={{ true: colors.primary, false: '#cbd5e1' }}
                thumbColor="#ffffff"
              />
            </View>
          )}

          {submitted && previewErrors.length > 0 && (
            <View className="gap-1 rounded-xl bg-red-50 p-4 dark:bg-red-950">
              {previewErrors.map((e) => (
                <Text key={e} className="text-base font-medium text-red-700 dark:text-red-300">
                  • {e}
                </Text>
              ))}
            </View>
          )}

          <Pressable
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
            className={
              saving
                ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 opacity-60 dark:bg-teal-500'
                : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 active:bg-teal-800 dark:bg-teal-500'
            }>
            {saving && <ActivityIndicator color="#ffffff" />}
            <Text className="text-lg font-bold text-white">
              {saving ? t('presets.saving') : submitLabel}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
