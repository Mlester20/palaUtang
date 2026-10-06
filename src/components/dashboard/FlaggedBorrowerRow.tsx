import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';
import type { AttentionItem } from '@/types/dashboard';

import { InitialsAvatar } from './InitialsAvatar';
import { StatusChip } from './StatusChip';

type FlaggedBorrowerRowProps = Omit<AttentionItem, 'borrowerId'> & {
  onPress: () => void;
  /** Shown only when the borrower has a phone number. */
  onCall?: () => void;
};

/** "Needs attention" row: who, their area, how late, how much, last payment, and a Call button. */
export function FlaggedBorrowerRow({
  name,
  nickname,
  area,
  chipLabel,
  chipTone,
  totalOverdueCentavos,
  lastPaidText,
  onPress,
  onCall,
}: FlaggedBorrowerRowProps) {
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center gap-3 py-3">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        className="flex-1 flex-row items-center gap-3 active:opacity-70">
        <InitialsAvatar name={name} />
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-slate-900 dark:text-white" numberOfLines={1}>
            {name}
            {nickname ? (
              <Text className="font-normal text-slate-500 dark:text-slate-400"> “{nickname}”</Text>
            ) : null}
          </Text>
          <View className="flex-row items-center gap-2">
            <StatusChip label={chipLabel} tone={chipTone} size="sm" />
            {area && (
              <Text className="text-xs text-slate-500 dark:text-slate-400" numberOfLines={1}>
                {area}
              </Text>
            )}
          </View>
          <Text className="text-base font-bold text-slate-800 dark:text-slate-100">
            {t('flags.overdueAmount', { amount: formatPeso(totalOverdueCentavos) })}
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400">{lastPaidText}</Text>
        </View>
      </Pressable>
      {onCall && (
        <Pressable
          onPress={onCall}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('flags.callName', { name })}
          className="h-12 w-12 items-center justify-center rounded-full bg-teal-50 active:opacity-60 dark:bg-teal-950">
          <Ionicons name="call" size={22} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}
