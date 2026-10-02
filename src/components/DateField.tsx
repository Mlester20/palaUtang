import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, Text, View } from 'react-native';

import { formatDisplayDate, parseYmd, toYmd } from '@/lib/loan';
import { useThemeColors } from '@/lib/theme';

type DateFieldProps = {
  label: string;
  /** 'YYYY-MM-DD' */
  value: string;
  onChange: (ymd: string) => void;
};

/** Date input that keeps values as local 'YYYY-MM-DD' strings (no UTC conversion). */
export function DateField({ label, value, onChange }: DateFieldProps) {
  const colors = useThemeColors();

  const openAndroid = () =>
    DateTimePickerAndroid.open({
      value: parseYmd(value),
      mode: 'date',
      onChange: (event, date) => {
        if (event.type === 'set' && date) onChange(toYmd(date));
      },
    });

  return (
    <View className="gap-2">
      <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">{label}</Text>
      {Platform.OS === 'ios' ? (
        <View className="min-h-14 flex-row items-center rounded-xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
          <DateTimePicker
            value={parseYmd(value)}
            mode="date"
            display="compact"
            onChange={(_, date) => date && onChange(toYmd(date))}
          />
        </View>
      ) : (
        <Pressable
          onPress={openAndroid}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${formatDisplayDate(value)}. Tap to change.`}
          className="min-h-14 flex-row items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 active:opacity-70 dark:border-slate-700 dark:bg-slate-900">
          <Ionicons name="calendar" size={22} color={colors.primary} />
          <Text className="flex-1 text-lg text-slate-900 dark:text-white">
            {formatDisplayDate(value)}
          </Text>
          <Text className="text-sm font-semibold text-teal-700 dark:text-teal-300">Change</Text>
        </Pressable>
      )}
    </View>
  );
}
