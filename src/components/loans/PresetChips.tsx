import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '@/i18n';
import type { LoanPreset } from '@/lib/presets';

type PresetChipsProps = {
  presets: LoanPreset[];
  /** null = no preset applied (either never tapped one, or the user edited a field since). */
  selectedId: number | null;
  onSelect: (preset: LoanPreset) => void;
  customLabel: string;
};

/** New Loan: tap a chip to fill the form; shows "Using: X" or "Custom" underneath. */
export function PresetChips({ presets, selectedId, onSelect, customLabel }: PresetChipsProps) {
  const selected = presets.find((p) => p.id === selectedId) ?? null;

  return (
    <View className="gap-2">
      <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
        {t('presets.label')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {presets.map((preset) => {
          const isSelected = preset.id === selectedId;
          return (
            <Pressable
              key={preset.id}
              onPress={() => onSelect(preset)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              className={
                isSelected
                  ? 'min-h-11 justify-center rounded-full bg-teal-700 px-4 dark:bg-teal-500'
                  : 'min-h-11 justify-center rounded-full border border-slate-300 bg-white px-4 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
              }>
              <Text
                className={
                  isSelected
                    ? 'text-base font-bold text-white'
                    : 'text-base font-semibold text-slate-700 dark:text-slate-200'
                }
                numberOfLines={1}>
                {preset.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text className="text-sm text-slate-500 dark:text-slate-400">
        {selected ? t('presets.using', { name: selected.name }) : customLabel}
      </Text>
    </View>
  );
}
