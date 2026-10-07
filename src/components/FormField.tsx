import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { useThemeColors } from '@/lib/theme';

type FormFieldProps = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Text shown inside the field before the value, e.g. "₱" or after it, e.g. "%". */
  prefix?: string;
  suffix?: string;
};

/** Labelled text input with big tap target, optional ₱/% adornments and an inline error. */
export function FormField({
  label,
  hint,
  error,
  prefix,
  suffix,
  multiline,
  ...inputProps
}: FormFieldProps) {
  const colors = useThemeColors();
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-baseline gap-x-2">
        <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">{label}</Text>
        {hint && <Text className="text-sm text-slate-500 dark:text-slate-400">{hint}</Text>}
      </View>
      <View
        className={
          error
            ? 'min-h-14 flex-row items-center rounded-xl border-2 border-red-500 bg-white px-4 dark:bg-slate-900'
            : 'min-h-14 flex-row items-center rounded-xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-900'
        }>
        {prefix && (
          <Text className="pr-2 text-xl font-semibold text-slate-500 dark:text-slate-400">
            {prefix}
          </Text>
        )}
        <TextInput
          {...inputProps}
          multiline={multiline}
          placeholderTextColor={colors.textMuted}
          textAlignVertical={multiline ? 'top' : 'center'}
          className="flex-1 py-3 text-xl text-slate-900 dark:text-white"
          style={multiline ? { minHeight: 80 } : undefined}
        />
        {suffix && (
          <Text className="pl-2 text-xl font-semibold text-slate-500 dark:text-slate-400">
            {suffix}
          </Text>
        )}
      </View>
      {error && <Text className="text-sm font-medium text-red-600 dark:text-red-400">{error}</Text>}
    </View>
  );
}
