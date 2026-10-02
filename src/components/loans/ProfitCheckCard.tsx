import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Text, View } from 'react-native';

import { formatPercent, type ProfitCheck, type ProfitLevel } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';

type ProfitCheckCardProps = ProfitCheck & {
  principalCentavos: number;
  totalPayableCentavos: number;
};

const LEVEL: Record<
  ProfitLevel,
  {
    title: string;
    icon: ComponentProps<typeof Ionicons>['name'];
    box: string;
    amount: string;
    text: string;
  }
> = {
  loss: {
    title: 'Loss',
    icon: 'trending-down',
    box: 'gap-3 rounded-2xl border-2 border-red-400 bg-red-50 p-5 dark:border-red-700 dark:bg-red-950',
    amount: 'text-3xl font-extrabold text-red-700 dark:text-red-300',
    text: 'text-base text-red-800 dark:text-red-200',
  },
  none: {
    title: 'No profit',
    icon: 'remove-circle',
    box: 'gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950',
    amount: 'text-3xl font-extrabold text-amber-700 dark:text-amber-300',
    text: 'text-base text-amber-900 dark:text-amber-100',
  },
  high: {
    title: 'Very high profit',
    icon: 'warning',
    box: 'gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950',
    amount: 'text-3xl font-extrabold text-amber-700 dark:text-amber-300',
    text: 'text-base text-amber-900 dark:text-amber-100',
  },
  normal: {
    title: 'Profit',
    icon: 'trending-up',
    box: 'gap-3 rounded-2xl border-2 border-green-400 bg-green-50 p-5 dark:border-green-700 dark:bg-green-950',
    amount: 'text-3xl font-extrabold text-green-700 dark:text-green-300',
    text: 'text-base text-green-900 dark:text-green-100',
  },
};

/** Shows the lender's expected earnings (tubo) and flags losses or unusually high interest. */
export function ProfitCheckCard({
  profitCentavos,
  ratePercent,
  monthlyRatePercent,
  durationDays,
  level,
  principalCentavos,
  totalPayableCentavos,
}: ProfitCheckCardProps) {
  const colors = useThemeColors();
  const style = LEVEL[level];
  const iconColor =
    level === 'loss' ? colors.danger : level === 'normal' ? colors.success : '#d97706'; // amber-600

  const message = {
    loss: `You lend ${formatPeso(principalCentavos)} but will only collect ${formatPeso(totalPayableCentavos)}. Short by ${formatPeso(-profitCentavos)}.`,
    none: `You will only get back the ${formatPeso(principalCentavos)} you lent.`,
    high: `About ${formatPercent(monthlyRatePercent)} per month. Double-check the amounts.`,
    normal: `You collect ${formatPeso(totalPayableCentavos)} for ${formatPeso(principalCentavos)} lent.`,
  }[level];

  return (
    <View className={style.box} accessibilityRole="summary">
      <View className="flex-row items-center gap-2">
        <Ionicons name={style.icon} size={22} color={iconColor} />
        <Text className="text-sm font-bold uppercase text-slate-700 dark:text-slate-200">
          Profit check (tubo) · {style.title}
        </Text>
      </View>

      <Text className={style.amount} numberOfLines={1} adjustsFontSizeToFit>
        {profitCentavos > 0 ? '+' : ''}
        {formatPeso(profitCentavos)}
      </Text>

      <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
        {formatPercent(ratePercent)} of principal
        {profitCentavos > 0 ? ` · ≈${formatPercent(monthlyRatePercent)} per month` : ''} ·{' '}
        {durationDays} {durationDays === 1 ? 'day' : 'days'}
      </Text>

      <Text className={style.text}>{message}</Text>
    </View>
  );
}
