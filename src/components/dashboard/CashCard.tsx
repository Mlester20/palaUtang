import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';
import type { Centavos } from '@/types/dashboard';

type CashCardProps = {
  cashOnHandCentavos: Centavos;
  withdrawnTodayCentavos: Centavos;
  expensesTodayCentavos: Centavos;
  onPress: () => void;
};

/** Home: compact cash on hand + today's money out. */
export function CashCard({
  cashOnHandCentavos,
  withdrawnTodayCentavos,
  expensesTodayCentavos,
  onPress,
}: CashCardProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t('dashboard.cashOnHand')}: ${formatPeso(cashOnHandCentavos)}`}
      className="gap-3 rounded-2xl bg-white p-4 active:opacity-70 dark:bg-slate-900">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950">
          <Ionicons name="wallet" size={22} color={colors.primary} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            {t('dashboard.cashOnHand')}
          </Text>
          <Text
            className={
              cashOnHandCentavos < 0
                ? 'text-2xl font-extrabold text-red-600 dark:text-red-400'
                : 'text-2xl font-extrabold text-slate-900 dark:text-white'
            }
            numberOfLines={1}
            adjustsFontSizeToFit>
            {formatPeso(cashOnHandCentavos)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
          <Text className="text-xs text-slate-600 dark:text-slate-300">
            {t('dashboard.withdrawnToday')}
          </Text>
          <Text className="text-base font-bold text-slate-900 dark:text-white">
            {formatPeso(withdrawnTodayCentavos)}
          </Text>
        </View>
        <View className="flex-1 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
          <Text className="text-xs text-slate-600 dark:text-slate-300">
            {t('dashboard.expensesToday')}
          </Text>
          <Text className="text-base font-bold text-slate-900 dark:text-white">
            {formatPeso(expensesTodayCentavos)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
