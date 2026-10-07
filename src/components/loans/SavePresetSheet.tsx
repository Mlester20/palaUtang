import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { BottomSheet } from '@/components/BottomSheet';
import { PresetError, createPreset } from '@/db/presets';
import { t } from '@/i18n';
import type { LoanInputMode, PaymentType } from '@/lib/loan';
import { showError } from '@/lib/errors';
import type { LoanPreset, PresetInput } from '@/lib/presets';
import { useThemeColors } from '@/lib/theme';

export interface PresetFormValues {
  paymentType: PaymentType;
  inputMode: LoanInputMode;
  /** The loan form's CURRENT parsed values (null = not filled in / invalid right now). */
  principal: number | null;
  interestRate: number | null;
  installmentAmount: number | null;
  numberOfInstallments: number | null;
  skipSundays: boolean;
}

type SavePresetSheetProps = {
  visible: boolean;
  onClose: () => void;
  currentValues: PresetFormValues;
  onSaved: (preset: LoanPreset) => void;
};

function presetErrorText(error: unknown): string | null {
  if (!(error instanceof PresetError)) return null;
  switch (error.code) {
    case 'nameRequired':
      return t('presets.errName');
    case 'nameTooLong':
      return t('presets.errNameTooLong');
    case 'nameTaken':
      return t('presets.errNameTaken');
    case 'tooMany':
      return t('presets.errTooMany');
    case 'invalid':
      return error.previewErrors.join('\n');
    default:
      return t('presets.errGeneric');
  }
}

/** "Save as preset": asks for a name and whether to remember the principal too. */
export function SavePresetSheet({ visible, onClose, currentValues, onSaved }: SavePresetSheetProps) {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const [name, setName] = useState('');
  const [includePrincipal, setIncludePrincipal] = useState(false);
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (saving) return;
    setName('');
    setIncludePrincipal(false);
    onClose();
  };

  const save = async () => {
    if (saving || currentValues.numberOfInstallments === null) return;
    setSaving(true);
    const input: PresetInput = {
      name,
      paymentType: currentValues.paymentType,
      inputMode: currentValues.inputMode,
      principal: includePrincipal ? currentValues.principal : null,
      interestRate: currentValues.inputMode === 'rate' ? currentValues.interestRate : null,
      installmentAmount:
        currentValues.inputMode === 'installment' ? currentValues.installmentAmount : null,
      numberOfInstallments: currentValues.numberOfInstallments,
      skipSundays: currentValues.skipSundays,
    };
    try {
      const id = await createPreset(db, input);
      const saved: LoanPreset = {
        id,
        name: input.name.trim(),
        paymentType: input.paymentType,
        inputMode: input.inputMode,
        principal: input.principal,
        interestRate: input.interestRate,
        installmentAmount: input.installmentAmount,
        numberOfInstallments: input.numberOfInstallments,
        skipSundays: input.skipSundays,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      close();
      onSaved(saved);
    } catch (error) {
      const text = presetErrorText(error);
      if (text) Alert.alert(t('presets.saveFailed'), text);
      else showError(t('presets.saveFailed'), error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={close} locked={saving}>
      <Text className="text-xl font-bold text-slate-900 dark:text-white">
        {t('presets.saveAsPreset')}
      </Text>
      <View className="gap-2">
        <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
          {t('presets.nameLabel')}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('presets.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          className="min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-lg text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </View>
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
          trackColor={{ true: colors.primary, false: colors.switchTrackOff }}
          thumbColor="#ffffff"
        />
      </View>
      <View className="flex-row gap-3 pt-2">
        <Pressable
          onPress={close}
          disabled={saving}
          accessibilityRole="button"
          className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
          <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
            {t('presets.cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          className={
            saving
              ? 'min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-60 dark:bg-teal-500'
              : 'min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
          }>
          {saving && <ActivityIndicator color="#ffffff" />}
          <Text className="text-lg font-bold text-white">{t('presets.save')}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
