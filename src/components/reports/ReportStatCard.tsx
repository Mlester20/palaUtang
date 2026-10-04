import { Text, View } from 'react-native';

type ReportStatCardProps = {
  label: string;
  value: string;
  /** Short explanation under the value. */
  hint?: string;
  /** `primary` = the headline profit number; `danger` = a loss (red). */
  tone?: 'default' | 'primary' | 'danger';
};

const STYLES = {
  default: {
    card: 'gap-1 rounded-2xl bg-white p-4 dark:bg-slate-900',
    label: 'text-sm font-semibold text-slate-600 dark:text-slate-300',
    value: 'text-2xl font-extrabold text-slate-900 dark:text-white',
    hint: 'text-xs text-slate-500 dark:text-slate-400',
  },
  primary: {
    card: 'gap-1 rounded-2xl bg-teal-700 p-4 dark:bg-teal-800',
    label: 'text-sm font-semibold text-teal-50',
    value: 'text-3xl font-extrabold text-white',
    hint: 'text-xs text-teal-50',
  },
  danger: {
    card: 'gap-1 rounded-2xl border-2 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950',
    label: 'text-sm font-semibold text-red-700 dark:text-red-300',
    value: 'text-2xl font-extrabold text-red-700 dark:text-red-300',
    hint: 'text-xs text-red-700 dark:text-red-300',
  },
} as const;

export function ReportStatCard({ label, value, hint, tone = 'default' }: ReportStatCardProps) {
  const s = STYLES[tone];
  return (
    <View className={s.card}>
      <Text className={s.label}>{label}</Text>
      <Text className={s.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text className={s.hint}>{hint}</Text> : null}
    </View>
  );
}
