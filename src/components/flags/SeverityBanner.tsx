import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColorScheme, View } from 'react-native';

import { t } from '@/i18n';
import type { Severity } from '@/lib/flags';
import { formatPeso } from '@/lib/money';

import { daysBehindText, severityLabel } from './flag-text';

const STYLES: Record<
  Exclude<Severity, 'none'>,
  { box: string; text: string; icon: { light: string; dark: string } }
> = {
  late: {
    box: 'flex-row gap-3 rounded-2xl border-2 border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950',
    text: 'text-yellow-900 dark:text-yellow-100',
    icon: { light: '#a16207', dark: '#facc15' }, // yellow-700 / yellow-400
  },
  flagged: {
    box: 'flex-row gap-3 rounded-2xl border-2 border-orange-300 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950',
    text: 'text-orange-900 dark:text-orange-100',
    icon: { light: '#ea580c', dark: '#fb923c' }, // orange-600 / orange-400
  },
  critical: {
    box: 'flex-row gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950',
    text: 'text-red-800 dark:text-red-100',
    icon: { light: '#dc2626', dark: '#f87171' }, // red-600 / red-400
  },
};

type SeverityBannerProps = {
  severity: Exclude<Severity, 'none'>;
  daysBehind: number;
  totalOverdue: number;
  loanCount: number;
};

/** Borrower detail: how far behind they are, in the severity colour. */
export function SeverityBanner({ severity, daysBehind, totalOverdue, loanCount }: SeverityBannerProps) {
  const isDark = useColorScheme() === 'dark';
  const s = STYLES[severity];
  return (
    <View className={s.box} accessibilityRole="alert">
      <Ionicons
        name={severity === 'late' ? 'time' : 'alert-circle'}
        size={26}
        color={isDark ? s.icon.dark : s.icon.light}
      />
      <View className="flex-1 gap-1">
        <Text className={`text-lg font-bold ${s.text}`}>
          {t('flags.bannerTitle', {
            severity: severityLabel(severity),
            days: daysBehindText(daysBehind),
          })}
        </Text>
        <Text className={`text-base ${s.text}`}>
          {loanCount === 1
            ? t('flags.bannerOverdueOne', { amount: formatPeso(totalOverdue) })
            : t('flags.bannerOverdueMany', { amount: formatPeso(totalOverdue), count: loanCount })}
        </Text>
      </View>
    </View>
  );
}
