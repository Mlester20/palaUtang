import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

type StatCardProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  /** Small line under the value (e.g. principal still out). */
  secondary?: string;
  /** `warning` highlights the card in orange (e.g. flagged borrowers / Balda). */
  tone?: 'default' | 'warning';
  /** Makes the whole card tappable. */
  onPress?: () => void;
};

const STYLES = {
  default: {
    card: 'flex-1 gap-3 rounded-2xl border-2 border-transparent bg-white p-4 dark:bg-slate-900',
    iconBox: 'h-10 w-10 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950',
    label: 'text-sm font-semibold text-slate-600 dark:text-slate-300',
    value: 'text-2xl font-extrabold text-slate-900 dark:text-white',
    secondary: 'text-xs text-slate-500 dark:text-slate-400',
  },
  warning: {
    card: 'flex-1 gap-3 rounded-2xl border-2 border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950',
    iconBox: 'h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900',
    label: 'text-sm font-semibold text-orange-800 dark:text-orange-200',
    value: 'text-2xl font-extrabold text-orange-800 dark:text-orange-200',
    secondary: 'text-xs text-orange-800 dark:text-orange-200',
  },
} as const;

export function StatCard({
  icon,
  label,
  value,
  secondary,
  tone = 'default',
  onPress,
}: StatCardProps) {
  const colors = useThemeColors();
  const s = STYLES[tone];
  const iconColor = tone === 'warning' ? colors.warning : colors.primary;

  const body: ReactNode = (
    <>
      <View className="flex-row items-center justify-between">
        <View className={s.iconBox}>
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        {onPress && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
      </View>
      <Text className={s.label}>{label}</Text>
      <View className="gap-0.5">
        <Text className={s.value} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {secondary ? (
          <Text className={s.secondary} numberOfLines={1} adjustsFontSizeToFit>
            {secondary}
          </Text>
        ) : null}
      </View>
    </>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className={`${s.card} active:opacity-70`}>
      {body}
    </Pressable>
  ) : (
    <View className={s.card}>{body}</View>
  );
}
