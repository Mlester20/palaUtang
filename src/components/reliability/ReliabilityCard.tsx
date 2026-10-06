import { Text, View } from 'react-native';

import { StatusChip } from '@/components/dashboard';
import { t } from '@/i18n';
import type { ReliabilityResult } from '@/lib/reliability';

import { tierBadge } from './reliability-text';

/** Borrower detail: the rating badge and "Why this rating" reasons. Never shown as a block. */
export function ReliabilityCard({ result }: { result: ReliabilityResult }) {
  const badge = tierBadge(result);

  return (
    <View className="gap-3 rounded-2xl bg-white p-5 dark:bg-slate-900">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold text-slate-900 dark:text-white">
          {t('reliability.cardTitle')}
        </Text>
        <StatusChip label={badge.label} tone={badge.tone} />
      </View>
      {result.tier === 'new' ? (
        <Text className="text-base text-slate-600 dark:text-slate-300">
          {t('reliability.newExplanation')}
        </Text>
      ) : (
        <View className="gap-2">
          <Text className="text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">
            {t('reliability.whyTitle')}
          </Text>
          {result.reasons.map((reason) => (
            <Text key={reason} className="text-base text-slate-700 dark:text-slate-200">
              • {reason}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
