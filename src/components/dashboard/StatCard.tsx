import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Text, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

type StatCardProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  /** `danger` highlights the card in red (e.g. Balda / overdue). */
  tone?: 'default' | 'danger';
};

export function StatCard({ icon, label, value, tone = 'default' }: StatCardProps) {
  const colors = useThemeColors();
  const danger = tone === 'danger';

  return (
    <View
      className={
        danger
          ? 'flex-1 gap-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950'
          : 'flex-1 gap-3 rounded-2xl border-2 border-transparent bg-white p-4 dark:bg-slate-900'
      }>
      <View
        className={
          danger
            ? 'h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900'
            : 'h-10 w-10 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950'
        }>
        <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      </View>
      <Text
        className={
          danger
            ? 'text-sm font-semibold text-red-700 dark:text-red-300'
            : 'text-sm font-semibold text-slate-600 dark:text-slate-300'
        }>
        {label}
      </Text>
      <Text
        className={
          danger
            ? 'text-2xl font-extrabold text-red-700 dark:text-red-300'
            : 'text-2xl font-extrabold text-slate-900 dark:text-white'
        }
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}
