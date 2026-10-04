import { memo } from 'react';
import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { formatShortDate } from '@/lib/loan';
import { formatPeso } from '@/lib/money';

type DailyReportRowProps = {
  /** 'YYYY-MM-DD' */
  date: string;
  cashCollected: number;
  interestEarned: number;
  /** Highest daily cash in the range (bar scale); 0 → no bars. */
  maxCash: number;
};

/** One day: cash collected with a plain-View bar, and the interest part of what came in. */
function DailyReportRowBase({ date, cashCollected, interestEarned, maxCash }: DailyReportRowProps) {
  const cashShare = maxCash > 0 ? Math.min(1, Math.max(0, cashCollected / maxCash)) : 0;
  const interestShare =
    maxCash > 0 ? Math.min(1, Math.max(0, interestEarned / maxCash)) : 0;
  const empty = cashCollected === 0 && interestEarned === 0;

  return (
    <View className="gap-2 rounded-2xl bg-white px-4 py-3 dark:bg-slate-900">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-base font-semibold text-slate-900 dark:text-white">
          {formatShortDate(date)}
        </Text>
        <Text
          className={
            empty
              ? 'text-base text-slate-400 dark:text-slate-500'
              : 'text-lg font-bold text-slate-900 dark:text-white'
          }>
          {formatPeso(cashCollected)}
        </Text>
      </View>
      {!empty && (
        <>
          <View className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <View
              className="h-full rounded-full bg-teal-600 dark:bg-teal-400"
              style={{ width: `${Math.round(cashShare * 100)}%` }}
            />
          </View>
          <View className="flex-row items-center gap-2">
            <View className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <View
                className="h-full rounded-full bg-amber-500 dark:bg-amber-400"
                style={{ width: `${Math.round(interestShare * 100)}%` }}
              />
            </View>
            <Text className="text-sm text-slate-600 dark:text-slate-300">
              {t('reports.dayInterest', { amount: formatPeso(interestEarned) })}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

export const DailyReportRow = memo(DailyReportRowBase);
