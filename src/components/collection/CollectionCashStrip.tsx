import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

type CollectionCashStripProps = {
  /** null = cash tracking not set up (no cash numbers are shown then). */
  cashOnHand: number | null;
  /** Withdrawals + expenses dated today. */
  outToday: number;
  onWithdraw: () => void;
  onOpenCash: () => void;
  onSetup: () => void;
};

/** Under the collection summary: Out today, Cash on hand, and a Withdraw / Expense button. */
export function CollectionCashStrip({
  cashOnHand,
  outToday,
  onWithdraw,
  onOpenCash,
  onSetup,
}: CollectionCashStripProps) {
  const colors = useThemeColors();
  if (cashOnHand === null) {
    return (
      <Pressable
        onPress={onSetup}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-teal-400 px-4 active:opacity-70 dark:border-teal-700">
        <Ionicons name="wallet-outline" size={20} color={colors.primary} />
        <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
          {t('cash.setupCardTitle')}
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="flex-row gap-2">
      <Pressable
        onPress={onOpenCash}
        accessibilityRole="button"
        className="flex-1 flex-row gap-3 rounded-2xl bg-white px-4 py-3 active:opacity-70 dark:bg-slate-900">
        <View className="flex-1">
          <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {t('cash.outToday')}
          </Text>
          <Money
            value={outToday}
            kind="total"
            className="text-lg font-bold text-slate-900 dark:text-white"
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        </View>
        <View className="flex-1">
          <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {t('cash.cashOnHand')}
          </Text>
          <Money
            value={cashOnHand}
            kind="total"
            className={
              cashOnHand < 0
                ? 'text-lg font-bold text-red-600 dark:text-red-400'
                : 'text-lg font-bold text-slate-900 dark:text-white'
            }
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        </View>
      </Pressable>
      <Pressable
        onPress={onWithdraw}
        accessibilityRole="button"
        accessibilityLabel={t('cash.withdrawExpense')}
        className="w-28 items-center justify-center gap-1 rounded-2xl border-2 border-teal-700 bg-white px-2 active:opacity-70 dark:border-teal-400 dark:bg-slate-900">
        <Ionicons name="remove-circle-outline" size={22} color={colors.primary} />
        <Text className="text-center text-xs font-bold text-teal-800 dark:text-teal-200">
          {t('cash.withdrawExpense')}
        </Text>
      </Pressable>
    </View>
  );
}
