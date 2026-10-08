import { Pressable, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import type { DueTodayItem } from '@/types/dashboard';

import { InitialsAvatar } from './InitialsAvatar';
import { StatusChip } from './StatusChip';

type DueTodayRowProps = Omit<DueTodayItem, 'id'> & {
  onPress?: () => void;
};

export function DueTodayRow({
  borrowerName,
  amountDueCentavos,
  chipLabel,
  chipTone,
  onPress,
}: DueTodayRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      className="min-h-16 flex-row items-center gap-3 py-3 active:opacity-70">
      <InitialsAvatar name={borrowerName} />
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold text-slate-900 dark:text-white" numberOfLines={1}>
          {borrowerName}
        </Text>
        <Money
          value={amountDueCentavos}
          kind="borrower"
          className="text-lg font-bold text-slate-700 dark:text-slate-200"
        />
      </View>
      <StatusChip label={chipLabel} tone={chipTone} size="sm" />
    </Pressable>
  );
}
