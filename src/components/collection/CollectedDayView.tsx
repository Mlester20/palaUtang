import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactElement } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import type { DatedPayment } from '@/db/collection';
import { Money } from '@/components/Money';
import { useTabBarInset } from '@/components/navigation/FloatingTabBar';
import { t } from '@/i18n';
import { isCashPayment } from '@/lib/cash';
import { formatTime } from '@/lib/date';
import { formatDisplayDate } from '@/lib/loan';
import { useThemeColors } from '@/lib/theme';

type CollectedDayViewProps = {
  date: string;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  payments: DatedPayment[];
  refreshing: boolean;
  onRefresh: () => void;
  onVoid: (payment: DatedPayment) => void;
  onOpenLoan: (loanId: number) => void;
  onReceipt: (paymentId: number) => void;
  /** Segment switcher etc., shown above the list. */
  header: ReactElement;
};

/** "Collected" segment: payments recorded for one day, with Void. */
export function CollectedDayView({
  date,
  canGoNext,
  onPrev,
  onNext,
  payments,
  refreshing,
  onRefresh,
  onVoid,
  onOpenLoan,
  onReceipt,
  header,
}: CollectedDayViewProps) {
  const colors = useThemeColors();
  const tabBarInset = useTabBarInset();
  // Cash only: a netted settlement was deducted from a renewal, no money changed hands.
  const total = payments
    .filter(isCashPayment)
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <FlatList
      data={payments}
      keyExtractor={(p) => String(p.id)}
      contentContainerClassName="gap-3 px-5"
      contentContainerStyle={{ paddingBottom: tabBarInset }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        <View className="gap-4 pb-1">
          {header}
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={onPrev}
              accessibilityRole="button"
              accessibilityLabel={t('collection.prevDay')}
              className="h-14 w-14 items-center justify-center rounded-2xl bg-white active:opacity-60 dark:bg-slate-900">
              <Ionicons name="chevron-back" size={26} color={colors.text} />
            </Pressable>
            <Text className="flex-1 text-center text-lg font-bold text-slate-900 dark:text-white">
              {formatDisplayDate(date)}
            </Text>
            <Pressable
              onPress={onNext}
              disabled={!canGoNext}
              accessibilityRole="button"
              accessibilityLabel={t('collection.nextDay')}
              accessibilityState={{ disabled: !canGoNext }}
              className={
                canGoNext
                  ? 'h-14 w-14 items-center justify-center rounded-2xl bg-white active:opacity-60 dark:bg-slate-900'
                  : 'h-14 w-14 items-center justify-center rounded-2xl bg-white opacity-30 dark:bg-slate-900'
              }>
              <Ionicons name="chevron-forward" size={26} color={colors.text} />
            </Pressable>
          </View>
          <View className="gap-1 rounded-2xl bg-teal-700 p-5 dark:bg-teal-800">
            <Text className="text-sm font-semibold text-teal-50">
              {t('collection.totalForDay')}
            </Text>
            <Money
              value={total}
              kind="total"
              className="text-3xl font-extrabold text-white"
              numberOfLines={1}
              adjustsFontSizeToFit
            />
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text className="py-8 text-center text-base text-slate-500 dark:text-slate-400">
          {t('collection.noPaymentsForDay')}
        </Text>
      }
      renderItem={({ item }) => {
        const voided = item.status === 'voided';
        return (
          <View className="flex-row items-center gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <Pressable
              onPress={() => onOpenLoan(item.loanId)}
              accessibilityRole="button"
              className="flex-1 gap-0.5 active:opacity-70">
              <Text className="text-lg font-bold text-slate-900 dark:text-white" numberOfLines={1}>
                {item.borrowerName}
              </Text>
              <Text className="text-sm text-slate-500 dark:text-slate-400">
                {t('collection.loanRef', { id: item.loanId })} ·{' '}
                {formatTime(new Date(item.createdAt))}
              </Text>
              {item.type === 'settlement' && (
                <Text className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                  {item.isNetted ? t('settlement.labelNetted') : t('settlement.labelEarlyPayoff')}
                </Text>
              )}
              {item.note && (
                <Text className="text-sm text-slate-600 dark:text-slate-300">{item.note}</Text>
              )}
              {voided && (
                <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {t('payments.voidedReason', { reason: item.voidReason ?? '' })}
                </Text>
              )}
            </Pressable>
            <View className="items-end gap-2">
              <Money
                value={item.amount}
                kind="borrower"
                className={
                  voided
                    ? 'text-xl font-extrabold text-slate-400 line-through dark:text-slate-500'
                    : 'text-xl font-extrabold text-slate-900 dark:text-white'
                }
              />
              {!voided && (
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => onReceipt(item.id)}
                    accessibilityRole="button"
                    className="min-h-12 justify-center rounded-xl border border-sky-300 px-4 active:opacity-70 dark:border-sky-800">
                    <Text className="text-base font-bold text-sky-700 dark:text-sky-300">
                      {t('receipts.receiptAction')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onVoid(item)}
                    accessibilityRole="button"
                    className="min-h-12 justify-center rounded-xl border border-red-300 px-4 active:opacity-70 dark:border-red-900">
                    <Text className="text-base font-bold text-red-600 dark:text-red-400">
                      {t('payments.void')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        );
      }}
    />
  );
}
