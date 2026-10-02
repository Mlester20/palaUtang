import { Text, View } from 'react-native';

import type { DailyEarning } from '@/types/dashboard';

type WeeklyBarChartProps = {
  days: DailyEarning[];
  /** Index into `days` to highlight (e.g. today). */
  highlightIndex?: number;
};

const CHART_HEIGHT = 128;

/** Plain-View bar chart: each bar's height is its share of the week's highest day. */
export function WeeklyBarChart({ days, highlightIndex }: WeeklyBarChartProps) {
  const max = Math.max(1, ...days.map((d) => d.amountCentavos));

  return (
    <View className="flex-row items-end justify-between gap-2">
      {days.map((d, i) => {
        const highlighted = i === highlightIndex;
        // Keep a sliver visible for ₱0 days so the bar slot doesn't look missing.
        const height = Math.max(4, Math.round((d.amountCentavos / max) * CHART_HEIGHT));
        return (
          <View key={d.day} className="flex-1 items-center gap-2">
            <View className="w-full justify-end" style={{ height: CHART_HEIGHT }}>
              <View
                className={
                  highlighted
                    ? 'w-full rounded-t-lg rounded-b-sm bg-teal-600 dark:bg-teal-400'
                    : 'w-full rounded-t-lg rounded-b-sm bg-slate-200 dark:bg-slate-700'
                }
                style={{ height }}
              />
            </View>
            <Text
              className={
                highlighted
                  ? 'text-sm font-bold text-teal-700 dark:text-teal-300'
                  : 'text-sm text-slate-500 dark:text-slate-400'
              }>
              {d.day}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
