import { Text, View } from 'react-native';

import type { DueStatus } from '@/types/dashboard';

const CHIP: Record<DueStatus, { label: string; box: string; text: string }> = {
  paid: {
    label: 'Paid',
    box: 'rounded-full bg-green-100 px-3 py-1 dark:bg-green-950',
    text: 'text-sm font-bold text-green-800 dark:text-green-300',
  },
  unpaid: {
    label: 'Unpaid',
    box: 'rounded-full bg-slate-200 px-3 py-1 dark:bg-slate-700',
    text: 'text-sm font-bold text-slate-700 dark:text-slate-200',
  },
  balda: {
    label: 'Balda',
    box: 'rounded-full bg-red-100 px-3 py-1 dark:bg-red-950',
    text: 'text-sm font-bold text-red-700 dark:text-red-300',
  },
};

export function StatusChip({ status }: { status: DueStatus }) {
  const chip = CHIP[status];
  return (
    <View className={chip.box}>
      <Text className={chip.text}>{chip.label}</Text>
    </View>
  );
}
