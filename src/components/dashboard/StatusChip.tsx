import { Text, View } from 'react-native';

import type { ChipTone } from '@/types/dashboard';

/** One colour per tone; late / flagged / critical are the balda severity colours everywhere. */
const TONES: Record<ChipTone, { box: string; text: string }> = {
  neutral: {
    box: 'bg-slate-200 dark:bg-slate-700',
    text: 'text-slate-700 dark:text-slate-200',
  },
  success: {
    box: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-800 dark:text-green-300',
  },
  info: {
    box: 'bg-sky-100 dark:bg-sky-950',
    text: 'text-sky-800 dark:text-sky-200',
  },
  partial: {
    box: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-800 dark:text-amber-300',
  },
  late: {
    box: 'bg-yellow-100 dark:bg-yellow-950',
    text: 'text-yellow-800 dark:text-yellow-200',
  },
  flagged: {
    box: 'bg-orange-100 dark:bg-orange-950',
    text: 'text-orange-800 dark:text-orange-300',
  },
  critical: {
    box: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-300',
  },
};

type StatusChipProps = {
  label: string;
  tone: ChipTone;
  /** `sm` for dense list rows. */
  size?: 'sm' | 'md';
};

export function StatusChip({ label, tone, size = 'md' }: StatusChipProps) {
  const colors = TONES[tone];
  return (
    <View
      className={`${size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1'} rounded-full ${colors.box}`}>
      <Text className={`${size === 'sm' ? 'text-xs' : 'text-sm'} font-bold ${colors.text}`}>
        {label}
      </Text>
    </View>
  );
}
