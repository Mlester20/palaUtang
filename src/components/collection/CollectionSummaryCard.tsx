import { Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { PrivacyToggle } from '@/components/PrivacyToggle';
import { t } from '@/i18n';
import { progressPercent, type CollectionSummary } from '@/lib/collection';

/** Collected today, remaining, progress and "X of Y paid" — big numbers for outdoor use. */
export function CollectionSummaryCard({ summary }: { summary: CollectionSummary }) {
  const percent = progressPercent(summary);

  return (
    <View className="gap-4 rounded-3xl bg-teal-700 p-5 dark:bg-teal-800">
      <View className="flex-row gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold text-teal-50">
            {t('collection.collectedToday')}
          </Text>
          <Money
            value={summary.collectedToday}
            kind="total"
            className="text-3xl font-extrabold text-white"
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        </View>
        <View className="flex-1 items-end gap-1">
          <View className="w-full flex-row items-center justify-end">
            <Text className="text-sm font-semibold text-teal-50">
              {t('collection.remaining')}
            </Text>
            <View className="-mr-2">
              <PrivacyToggle tone="onDark" />
            </View>
          </View>
          <Money
            value={summary.remaining}
            kind="total"
            className="text-3xl font-extrabold text-white"
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        </View>
      </View>

      {percent === null ? (
        <Text className="text-base font-semibold text-teal-50">{t('collection.nothingToday')}</Text>
      ) : (
        <View className="gap-2">
          <View
            className="h-4 overflow-hidden rounded-full bg-teal-900"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View className="h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
          </View>
          <View className="flex-row justify-between">
            <Text className="text-base font-semibold text-white">
              {t('collection.paidOfTotal', { paid: summary.paidCount, total: summary.totalCount })}
            </Text>
            <Text className="text-base font-bold text-white">{percent}%</Text>
          </View>
        </View>
      )}
    </View>
  );
}
