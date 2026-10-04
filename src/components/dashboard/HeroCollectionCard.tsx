import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { formatPeso } from '@/lib/money';
import type { HeroCollection } from '@/types/dashboard';

type HeroCollectionCardProps = HeroCollection & {
  title: string;
};

/** Today's collection: same numbers (collected, remaining, %, X of Y) as the Collection tab. */
export function HeroCollectionCard({
  title,
  expectedCentavos,
  collectedCentavos,
  remainingCentavos,
  percent,
  paidCount,
  totalCount,
}: HeroCollectionCardProps) {
  return (
    <View className="gap-4 rounded-3xl bg-teal-700 p-5 dark:bg-teal-800">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-base font-semibold text-teal-50">{title}</Text>
        <Text className="text-sm text-teal-50" numberOfLines={1}>
          {t('dashboard.expectedToday', { amount: formatPeso(expectedCentavos) })}
        </Text>
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold text-teal-50">{t('dashboard.collected')}</Text>
          <Text
            className="text-4xl font-extrabold text-white"
            numberOfLines={1}
            adjustsFontSizeToFit>
            {formatPeso(collectedCentavos)}
          </Text>
        </View>
        <View className="items-end gap-1">
          <Text className="text-sm font-semibold text-teal-50">{t('dashboard.remaining')}</Text>
          <Text
            className="text-2xl font-extrabold text-white"
            numberOfLines={1}
            adjustsFontSizeToFit>
            {formatPeso(remainingCentavos)}
          </Text>
        </View>
      </View>

      {percent === null ? (
        <Text className="text-base font-semibold text-teal-50">{t('dashboard.nothingToday')}</Text>
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
              {t('dashboard.paidOfTotal', { paid: paidCount, total: totalCount })}
            </Text>
            <Text className="text-base font-bold text-white">{percent}%</Text>
          </View>
        </View>
      )}
    </View>
  );
}
