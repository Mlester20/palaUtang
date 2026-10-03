import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { InitialsAvatar } from '@/components/dashboard';
import { t } from '@/i18n';
import type { ClassifiedRow } from '@/lib/collection';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';

type CollectionRowItemProps = {
  row: ClassifiedRow;
  /** Disables Collect while any payment is being saved. */
  busy: boolean;
  onCollect: (row: ClassifiedRow) => void;
  onMore: (row: ClassifiedRow) => void;
  onOpen: (row: ClassifiedRow) => void;
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

function chip(row: ClassifiedRow): { label: string; box: string; text: string } {
  switch (row.status) {
    case 'overdue':
      return {
        label: t('collection.chipOverdue', { days: lateText(row) }),
        box: 'rounded-full bg-red-100 px-2.5 py-1 dark:bg-red-950',
        text: 'text-xs font-bold text-red-700 dark:text-red-300',
      };
    case 'partial':
      return {
        label: t('collection.chipPartial'),
        box: 'rounded-full bg-amber-100 px-2.5 py-1 dark:bg-amber-950',
        text: 'text-xs font-bold text-amber-800 dark:text-amber-300',
      };
    case 'paid_today':
      return {
        label: t('collection.chipPaid'),
        box: 'rounded-full bg-green-100 px-2.5 py-1 dark:bg-green-950',
        text: 'text-xs font-bold text-green-800 dark:text-green-300',
      };
    case 'paid_in_advance':
      return {
        label: t('collection.chipPaidAdvance'),
        box: 'rounded-full bg-sky-100 px-2.5 py-1 dark:bg-sky-950',
        text: 'text-xs font-bold text-sky-800 dark:text-sky-200',
      };
    default:
      return {
        label: t('collection.chipDueToday'),
        box: 'rounded-full bg-slate-200 px-2.5 py-1 dark:bg-slate-700',
        text: 'text-xs font-bold text-slate-700 dark:text-slate-200',
      };
  }
}

function breakdown(row: ClassifiedRow): string {
  if (row.status === 'paid_today')
    return t('collection.paidTodayLine', { amount: formatPeso(row.collectedToday) });
  if (row.status === 'paid_in_advance') return t('collection.paidAdvanceLine');
  if (row.status === 'partial')
    return t('collection.breakdownPartial', {
      left: formatPeso(row.dueTodayOutstanding),
      due: formatPeso(row.dueTodayAmount),
    });
  if (row.dueTodayOutstanding > 0 && row.overdueOutstanding > 0)
    return t('collection.breakdownTodayOverdue', {
      today: formatPeso(row.dueTodayOutstanding),
      overdue: formatPeso(row.overdueOutstanding),
      days: lateText(row),
    });
  if (row.overdueOutstanding > 0)
    return t('collection.breakdownOverdue', {
      overdue: formatPeso(row.overdueOutstanding),
      days: lateText(row),
    });
  return t('collection.breakdownToday', { today: formatPeso(row.dueTodayOutstanding) });
}

function CollectionRowItemBase({ row, busy, onCollect, onMore, onOpen }: CollectionRowItemProps) {
  const colors = useThemeColors();
  const c = chip(row);
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
        <View className={c.box}>
          <Text className={c.text}>{c.label}</Text>
        </View>
      </Pressable>

      <Text className="text-base text-slate-700 dark:text-slate-200">{breakdown(row)}</Text>

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
              {t('collection.collectButton', { amount: formatPeso(row.toCollect) })}
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
