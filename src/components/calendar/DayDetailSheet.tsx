import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, useColorScheme, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Money, useMoneyText } from '@/components/Money';
import { t } from '@/i18n';
import { collectionDaysBetween, formatDisplayDate } from '@/lib/loan';
import type { CalendarDay } from '@/lib/loanCalendar';
import { useThemeColors } from '@/lib/theme';
import type { PaymentType } from '@/lib/loan';
import type { LoanStatus } from '@/types/loan';

import { DAY_STATE_STYLE, stateLabelKey } from './dayStateStyles';

type DayDetailSheetProps = {
  day: CalendarDay | null;
  paymentType: PaymentType;
  skipSundays: boolean;
  loanStatus: LoanStatus;
  /** Regular (non make-up) installment count, for "#12 of 40". */
  totalCount: number;
  /** installmentId → the ORIGINAL due date of the regular day it covers, for a make-up's "for {date}". */
  missedDateById: Map<number, string>;
  onClose: () => void;
  onRecordPayment: (date: string) => void;
  onReceipt: (paymentId: number) => void;
};

function explainDay(
  day: CalendarDay,
  paymentType: PaymentType,
  skipSundays: boolean,
  moneyText: ReturnType<typeof useMoneyText>,
): string {
  const inst = day.installment;
  if (!inst) {
    if (day.isSundayNoCollection) return t('calendar.explainNoCollection');
    if (day.isOverdueSpan) return t('calendar.explainOverdueSpan');
    return t('calendar.explainGapDay');
  }
  const overdue = !day.isFuture && !day.isToday;
  switch (day.state) {
    case 'paid':
      return t('calendar.explainPaid');
    case 'recovered': {
      const completedOn = inst.completionDate ?? day.date;
      const days = Math.max(1, collectionDaysBetween(day.date, completedOn, skipSundays));
      return days === 1
        ? t('calendar.explainRecoveredOne', { date: formatDisplayDate(completedOn) })
        : t('calendar.explainRecoveredMany', { date: formatDisplayDate(completedOn), days });
    }
    case 'advance':
      return t('calendar.explainAdvance', { date: formatDisplayDate(inst.completionDate ?? day.date) });
    case 'partial': {
      const shortfall = moneyText(inst.amountDue - inst.amountPaid - inst.waivedAmount, 'borrower');
      return overdue
        ? t('calendar.explainPartialOverdue', { amount: shortfall })
        : t('calendar.explainPartial', { amount: shortfall });
    }
    case 'pending':
      return day.isToday ? t('calendar.explainPendingToday') : t('calendar.explainPending');
    case 'missed':
      return paymentType === 'lump_sum'
        ? t('calendar.explainOverdueLumpSum', {
            amount: moneyText(inst.amountDue - inst.amountPaid, 'borrower'),
          })
        : t('calendar.explainMissed', {
            amount: moneyText(inst.amountDue - inst.amountPaid, 'borrower'),
          });
    case 'makeup_pending':
      return t('calendar.explainMakeupPending');
    case 'makeup_not_needed':
      return t('calendar.explainMakeupNotNeeded');
    case 'settled':
      return t('calendar.explainSettled');
    default:
      return '';
  }
}

/** Reuses src/components/BottomSheet.tsx; opened by tapping a day in LoanCalendar. */
export function DayDetailSheet({
  day,
  paymentType,
  skipSundays,
  loanStatus,
  totalCount,
  missedDateById,
  onClose,
  onRecordPayment,
  onReceipt,
}: DayDetailSheetProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = useThemeColors();
  const moneyText = useMoneyText();

  return (
    <BottomSheet visible={day !== null} onClose={onClose}>
      {day && (
        <View className="gap-4 py-1">
          <View className="gap-1">
            <Text className="text-lg font-bold text-slate-900 dark:text-white">
              {formatDisplayDate(day.date)}
            </Text>
            <StateChip state={day.state} paymentType={paymentType} isDark={isDark} />
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {explainDay(day, paymentType, skipSundays, moneyText)}
            </Text>
          </View>

          {day.installment && (
            <View className="gap-2 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
              <Text className="text-base font-bold text-slate-900 dark:text-white">
                {day.installment.isMakeup
                  ? t('calendar.makeupLabel', {
                      number: day.installment.installmentNumber,
                      date: formatDisplayDate(
                        missedDateById.get(day.installment.makeupForInstallmentId ?? -1) ??
                          day.installment.originalDueDate,
                      ),
                    })
                  : t('calendar.installmentLabel', {
                      number: day.installment.installmentNumber,
                      total: totalCount,
                    })}
              </Text>
              <Row
                label={t('calendar.amountDueLabel')}
                value={moneyText(day.installment.amountDue, 'borrower')}
              />
              <Row
                label={t('calendar.amountPaidLabel')}
                value={moneyText(day.installment.amountPaid, 'borrower')}
              />
              {day.installment.amountPaid + day.installment.waivedAmount < day.installment.amountDue && (
                <Row
                  label={t('calendar.shortfallLabel')}
                  value={moneyText(
                    day.installment.amountDue - day.installment.amountPaid - day.installment.waivedAmount,
                    'borrower',
                  )}
                />
              )}
            </View>
          )}

          {day.isSettlementDay && (
            <View className="flex-row items-center gap-2 rounded-xl bg-violet-50 px-4 py-3 dark:bg-violet-950">
              <Ionicons name="flag" size={20} color={colors.accent} />
              <Text className="text-base font-bold text-violet-800 dark:text-violet-200">
                {t('calendar.earlyPayoffMarker')}
              </Text>
            </View>
          )}

          {day.payments.length > 0 && (
            <View className="gap-2">
              <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
                {t('calendar.paymentsReceivedTitle')}
              </Text>
              {day.payments.map((p) => {
                const voided = p.status === 'voided';
                const typeLabel =
                  p.type === 'regular'
                    ? t('calendar.paymentTypeRegular')
                    : p.isNetted
                      ? t('calendar.paymentTypeNetted')
                      : t('calendar.paymentTypeSettlement');
                return (
                  <View
                    key={p.id}
                    className="flex-row items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                    <View className="flex-1 gap-0.5">
                      <Text
                        className={
                          voided
                            ? 'text-base font-bold text-slate-400 line-through dark:text-slate-500'
                            : 'text-base font-bold text-slate-900 dark:text-white'
                        }>
                        <Money value={p.amount} kind="borrower" /> · {typeLabel}
                      </Text>
                      {p.note && (
                        <Text className="text-sm text-slate-500 dark:text-slate-400">{p.note}</Text>
                      )}
                      {voided && (
                        <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
                          {t('calendar.voidedLabel', { reason: p.voidReason ?? '' })}
                        </Text>
                      )}
                    </View>
                    {!voided && (
                      <Pressable
                        onPress={() => onReceipt(p.id)}
                        accessibilityRole="button"
                        className="min-h-11 justify-center rounded-xl border border-sky-300 px-3 active:opacity-70 dark:border-sky-800">
                        <Text className="text-sm font-bold text-sky-700 dark:text-sky-300">
                          {t('receipts.receiptAction')}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {loanStatus === 'active' ? (
            <View className="gap-2">
              <Pressable
                onPress={() => onRecordPayment(day.date)}
                accessibilityRole="button"
                className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
                <Ionicons name="cash-outline" size={22} color="#ffffff" />
                <Text className="text-lg font-bold text-white">{t('calendar.recordPayment')}</Text>
              </Pressable>
              <Text className="text-center text-xs text-slate-500 dark:text-slate-400">
                {t('calendar.recordPaymentHint')}
              </Text>
            </View>
          ) : (
            <Text className="text-center text-sm text-slate-500 dark:text-slate-400">
              {t('calendar.noActionsClosed')}
            </Text>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="min-h-12 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
            <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
              {t('calendar.close')}
            </Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

function StateChip({
  state,
  paymentType,
  isDark,
}: {
  state: CalendarDay['state'];
  paymentType: PaymentType;
  isDark: boolean;
}) {
  const style = DAY_STATE_STYLE[state];
  return (
    <View className="flex-row items-center gap-2">
      {style.icon && (
        <Ionicons name={style.icon} size={18} color={isDark ? style.iconColor.dark : style.iconColor.light} />
      )}
      <Text className="text-base font-bold text-slate-700 dark:text-slate-200">
        {t(stateLabelKey(state, paymentType))}
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm text-slate-600 dark:text-slate-300">{label}</Text>
      <Text className="text-sm font-bold text-slate-900 dark:text-white">{value}</Text>
    </View>
  );
}
