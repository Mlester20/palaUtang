import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { InitialsAvatar, StatusChip } from '@/components/dashboard';
import { useMoneyText } from '@/components/Money';
import { t } from '@/i18n';
import type { ClassifiedRow } from '@/lib/collection';
import type { FlagThresholds } from '@/lib/flags';
import { useThemeColors } from '@/lib/theme';

import { collectionChip } from './collection-chip';

type CollectionRowItemProps = {
  row: ClassifiedRow;
  /** Disables Collect while any payment is being saved. */
  busy: boolean;
  onCollect: (row: ClassifiedRow) => void;
  onMore: (row: ClassifiedRow) => void;
  onOpen: (row: ClassifiedRow) => void;
  /** For the overdue chip's severity colour. */
  today: string;
  thresholds: FlagThresholds;
};

function daysText(count: number) {
  return count === 1 ? t('collection.oneDay') : t('collection.days', { count });
}

/** How late: balda days for daily loans (or days since the oldest shortfall), days past due for lump sums. */
function lateText(row: ClassifiedRow) {
  return daysText(
    row.paymentType === 'daily' && row.baldaDays > 0 ? row.baldaDays : Math.max(1, row.daysOverdue),
  );
}

function breakdown(row: ClassifiedRow, moneyText: ReturnType<typeof useMoneyText>): string {
  if (row.status === 'paid_today')
    return t('collection.paidTodayLine', { amount: moneyText(row.collectedToday, 'borrower') });
  if (row.status === 'paid_in_advance') return t('collection.paidAdvanceLine');
  if (row.status === 'partial')
    return t('collection.breakdownPartial', {
      left: moneyText(row.dueTodayOutstanding, 'borrower'),
      due: moneyText(row.dueTodayAmount, 'borrower'),
    });
  if (row.dueTodayOutstanding > 0 && row.overdueOutstanding > 0)
    return t('collection.breakdownTodayOverdue', {
      today: moneyText(row.dueTodayOutstanding, 'borrower'),
      overdue: moneyText(row.overdueOutstanding, 'borrower'),
      days: lateText(row),
    });
  if (row.overdueOutstanding > 0)
    return t('collection.breakdownOverdue', {
      overdue: moneyText(row.overdueOutstanding, 'borrower'),
      days: lateText(row),
    });
  return t('collection.breakdownToday', { today: moneyText(row.dueTodayOutstanding, 'borrower') });
}

function CollectionRowItemBase({
  row,
  busy,
  onCollect,
  onMore,
  onOpen,
  today,
  thresholds,
}: CollectionRowItemProps) {
  const colors = useThemeColors();
  const moneyText = useMoneyText();
  const c = collectionChip(row, today, thresholds);
  const toCollect = row.toCollect > 0;

  return (
    <View className="gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
      <Pressable
        onPress={() => onOpen(row)}
        accessibilityRole="button"
        className="flex-row items-center gap-3 active:opacity-70">
        <InitialsAvatar name={row.borrowerName} />
        <View className="flex-1 gap-0.5">
          <Text className="text-lg font-bold text-slate-900 dark:text-white" numberOfLines={1}>
            {row.borrowerName}
          </Text>
          {row.nickname && (
            <Text className="text-sm text-slate-600 dark:text-slate-300" numberOfLines={1}>
              “{row.nickname}”
            </Text>
          )}
        </View>
        <StatusChip label={c.label} tone={c.tone} size="sm" />
      </Pressable>

      <Text className="text-base text-slate-700 dark:text-slate-200">{breakdown(row, moneyText)}</Text>

      {toCollect && (
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => onCollect(row)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            className={
              busy
                ? 'min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-50 dark:bg-teal-500'
                : 'min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
            }>
            <Ionicons name="cash" size={22} color="#ffffff" />
            <Text
              className="text-lg font-extrabold text-white"
              numberOfLines={1}
              adjustsFontSizeToFit>
              {t('collection.collectButton', { amount: moneyText(row.toCollect, 'borrower') })}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onMore(row)}
            accessibilityRole="button"
            accessibilityLabel={t('collection.more')}
            className="min-h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 active:opacity-60 dark:border-slate-700">
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Memoized: rows re-render only when their own data or the busy flag changes. */
export const CollectionRowItem = memo(CollectionRowItemBase);
