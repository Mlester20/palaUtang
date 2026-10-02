import { Text, View } from 'react-native';

import { formatPeso } from '@/lib/money';
import type { CollectionSummary } from '@/types/dashboard';

type HeroCollectionCardProps = CollectionSummary & {
  title: string;
};

export function HeroCollectionCard({
  title,
  targetCentavos,
  collectedCentavos,
  paidCount,
  totalCount,
}: HeroCollectionCardProps) {
  const percent =
    targetCentavos > 0 ? Math.min(100, Math.round((collectedCentavos / targetCentavos) * 100)) : 0;

  return (
    <View className="gap-4 rounded-3xl bg-teal-700 p-5 dark:bg-teal-800">
      <Text className="text-base font-semibold text-teal-50">{title}</Text>

      <View className="gap-1">
        <Text className="text-4xl font-extrabold text-white" numberOfLines={1} adjustsFontSizeToFit>
          {formatPeso(collectedCentavos)}
        </Text>
        <Text className="text-base text-teal-50">of {formatPeso(targetCentavos)} target</Text>
      </View>

      <View className="gap-2">
        <View
          className="h-4 overflow-hidden rounded-full bg-teal-900"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}>
          <View className="h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
        </View>
        <View className="flex-row justify-between">
          <Text className="text-base font-semibold text-white">
            {paidCount} of {totalCount} have paid
          </Text>
          <Text className="text-base font-bold text-white">{percent}%</Text>
        </View>
      </View>
    </View>
  );
}
