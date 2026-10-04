import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

type StepperProps = {
  label: string;
  value: number;
  /** Shown next to the number, e.g. "days". */
  valueText: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
  invalid?: boolean;
};

/** − value + with big (48dp) buttons. */
export function Stepper({ label, value, valueText, min, max, onChange, invalid }: StepperProps) {
  const colors = useThemeColors();
  const button = (icon: 'remove' | 'add', next: number, disabled: boolean, a11y: string) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      className={
        disabled
          ? 'h-12 w-12 items-center justify-center rounded-xl bg-slate-100 opacity-40 dark:bg-slate-800'
          : 'h-12 w-12 items-center justify-center rounded-xl bg-slate-100 active:opacity-60 dark:bg-slate-800'
      }>
      <Ionicons name={icon} size={24} color={colors.text} />
    </Pressable>
  );

  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-base text-slate-900 dark:text-white">{label}</Text>
      <View className="flex-row items-center gap-2">
        {button('remove', value - 1, value <= min, t('flags.decrease', { label }))}
        <Text
          className={
            invalid
              ? 'min-w-20 text-center text-lg font-bold text-red-600 dark:text-red-400'
              : 'min-w-20 text-center text-lg font-bold text-slate-900 dark:text-white'
          }
          accessibilityLiveRegion="polite">
          {valueText}
        </Text>
        {button('add', value + 1, value >= max, t('flags.increase', { label }))}
      </View>
    </View>
  );
}
