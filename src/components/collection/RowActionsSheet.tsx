import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { t } from '@/i18n';
import type { ClassifiedRow } from '@/lib/collection';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';

type RowActionsSheetProps = {
  row: ClassifiedRow | null;
  onClose: () => void;
  onTodayAmount: (row: ClassifiedRow, amount: number) => void;
  onCustom: (row: ClassifiedRow) => void;
  onCall: (row: ClassifiedRow) => void;
  onOpenLoan: (row: ClassifiedRow) => void;
  onOpenCalendar: (row: ClassifiedRow) => void;
};

/** "More" actions for a collection row. */
export function RowActionsSheet({
  row,
  onClose,
  onTodayAmount,
  onCustom,
  onCall,
  onOpenLoan,
  onOpenCalendar,
}: RowActionsSheetProps) {
  // Today's amount = what is still owed for today, or one regular hulog when only overdue.
  const todayAmount = row
    ? Math.min(
        row.toCollect,
        row.dueTodayOutstanding > 0 ? row.dueTodayOutstanding : row.installmentAmount,
      )
    : 0;
  const showTodayAmount = row !== null && todayAmount > 0 && todayAmount < row.toCollect;

  return (
    <BottomSheet visible={row !== null} onClose={onClose}>
      {row && (
        <View className="gap-2">
          <Text className="pb-1 text-xl font-bold text-slate-900 dark:text-white" numberOfLines={1}>
            {row.borrowerName}
          </Text>
          {showTodayAmount && (
            <Action
              icon="today-outline"
              label={t('collection.actionTodayAmount', { amount: formatPeso(todayAmount) })}
              hint={row.overdueOutstanding > 0 ? t('collection.actionTodayAmountHint') : undefined}
              onPress={() => onTodayAmount(row, todayAmount)}
            />
          )}
          <Action
            icon="create-outline"
            label={t('collection.actionCustom')}
            onPress={() => onCustom(row)}
          />
          {row.phone && (
            <Action
              icon="call-outline"
              label={t('collection.actionCall', { phone: row.phone })}
              onPress={() => onCall(row)}
            />
          )}
          <Action
            icon="document-text-outline"
            label={t('collection.actionOpenLoan')}
            onPress={() => onOpenLoan(row)}
          />
          <Action
            icon="calendar-outline"
            label={t('calendar.openCalendar')}
            onPress={() => onOpenCalendar(row)}
          />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="mt-1 min-h-14 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
            <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
              {t('collection.close')}
            </Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

function Action({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3 active:opacity-70 dark:bg-slate-800">
      <Ionicons name={icon} size={24} color={colors.primary} />
      <View className="flex-1">
        <Text className="text-lg font-semibold text-slate-900 dark:text-white">{label}</Text>
        {hint && <Text className="text-sm text-slate-600 dark:text-slate-400">{hint}</Text>}
      </View>
    </Pressable>
  );
}
