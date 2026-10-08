import { Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { t } from '@/i18n';
import type { WeeklyEarnings } from '@/types/dashboard';

import { WeeklyLineChart } from './WeeklyLineChart';

type WeeklyEarningsCardProps = WeeklyEarnings & {
  highlightIndex?: number;
};

export function WeeklyEarningsCard({
  days,
  monthInterestCentavos,
  highlightIndex,
}: WeeklyEarningsCardProps) {
  const weekTotal = days.reduce((sum, d) => sum + d.amountCentavos, 0);

  return (
    <View className="gap-5 rounded-2xl bg-white p-5 dark:bg-slate-900">
      <View className="gap-1">
        <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          {t('dashboard.weekTotal')}
        </Text>
        <Money
          value={weekTotal}
          kind="total"
          className="text-3xl font-extrabold text-slate-900 dark:text-white"
          numberOfLines={1}
          adjustsFontSizeToFit
        />
      </View>

      <WeeklyLineChart days={days} highlightIndex={highlightIndex} />

      <View className="flex-row items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
        <Text className="flex-1 text-sm text-slate-600 dark:text-slate-300">
          {t('dashboard.monthInterest')}
        </Text>
        <Money
          value={monthInterestCentavos}
          kind="total"
          className="text-base font-bold text-teal-700 dark:text-teal-300"
        />
      </View>
    </View>
  );
}
