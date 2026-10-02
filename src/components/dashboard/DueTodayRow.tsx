import { Text, View } from 'react-native';

import { formatPeso } from '@/lib/money';
import type { DueTodayItem } from '@/types/dashboard';

import { InitialsAvatar } from './InitialsAvatar';
import { StatusChip } from './StatusChip';

type DueTodayRowProps = Pick<DueTodayItem, 'borrowerName' | 'amountDueCentavos' | 'status'>;

export function DueTodayRow({ borrowerName, amountDueCentavos, status }: DueTodayRowProps) {
  return (
    <View className="min-h-16 flex-row items-center gap-3 py-3">
      <InitialsAvatar name={borrowerName} />
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold text-slate-900 dark:text-white" numberOfLines={1}>
          {borrowerName}
        </Text>
        <Text className="text-lg font-bold text-slate-700 dark:text-slate-200">
          {formatPeso(amountDueCentavos)}
        </Text>
      </View>
      <StatusChip status={status} />
    </View>
  );
}
