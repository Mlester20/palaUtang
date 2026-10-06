import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { parseYmd, type PaymentType } from '@/lib/loan';
import {
  getMonthGrid,
  monthSummary,
  type CalendarDayState,
  type LoanCalendarResult,
  type MonthKey,
} from '@/lib/loanCalendar';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';

import { DAY_STATE_STYLE, LEGEND_STATES, stateLabelKey } from './dayStateStyles';

const MONTH_KEY: Record<number, TranslationKey> = {
  1: 'calendar.month.jan',
  2: 'calendar.month.feb',
  3: 'calendar.month.mar',
  4: 'calendar.month.apr',
  5: 'calendar.month.may',
  6: 'calendar.month.jun',
  7: 'calendar.month.jul',
  8: 'calendar.month.aug',
  9: 'calendar.month.sep',
  10: 'calendar.month.oct',
  11: 'calendar.month.nov',
  12: 'calendar.month.dec',
};

/** Monday-first, matching getMonthGrid's row order. */
const WEEKDAY_KEY: TranslationKey[] = [
  'calendar.weekdayShort.mon',
  'calendar.weekdayShort.tue',
  'calendar.weekdayShort.wed',
  'calendar.weekdayShort.thu',
  'calendar.weekdayShort.fri',
  'calendar.weekdayShort.sat',
  'calendar.weekdayShort.sun',
];

function monthKeyEquals(a: MonthKey, b: MonthKey) {
  return a.year === b.year && a.month === b.month;
}

function monthKeyCompare(a: MonthKey, b: MonthKey) {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const zeroBased = key.month - 1 + delta;
  const year = key.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return { year, month };
}

type LoanCalendarProps = {
  result: LoanCalendarResult;
  paymentType: PaymentType;
  today: string;
  onDayPress: (date: string) => void;
};

/** Props-driven: never queries the database. Changing months just re-reads `result.days`. */
export function LoanCalendar({ result, paymentType, today, onDayPress }: LoanCalendarProps) {
  const colors = useThemeColors();
  const isDark = useColorScheme() === 'dark';
  const [month, setMonth] = useState<MonthKey>(result.openingMonth);
  const [highlight, setHighlight] = useState<CalendarDayState | null>(null);

  const grid = useMemo(() => getMonthGrid(month.year, month.month), [month.year, month.month]);
  const summary = useMemo(
    () => monthSummary(result.days, month.year, month.month),
    [result.days, month.year, month.month],
  );

  const canPrev = monthKeyCompare(shiftMonth(month, -1), result.firstMonth) >= 0;
  const canNext = monthKeyCompare(shiftMonth(month, 1), result.lastMonth) <= 0;
  // "Today" jumps to today's actual month — hidden when that month is out of this loan's
  // range (e.g. a completed loan whose last relevant month is before today) or already shown.
  const todayDate = parseYmd(today);
  const todayMonth: MonthKey = { year: todayDate.getFullYear(), month: todayDate.getMonth() + 1 };
  const todayInRange =
    monthKeyCompare(todayMonth, result.firstMonth) >= 0 && monthKeyCompare(todayMonth, result.lastMonth) <= 0;
  const showToday = todayInRange && !monthKeyEquals(month, todayMonth);

  return (
    <View className="gap-3">
      {/* Month header */}
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => canPrev && setMonth(shiftMonth(month, -1))}
          disabled={!canPrev}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          className={canPrev ? 'h-11 w-11 items-center justify-center rounded-xl active:bg-slate-100 dark:active:bg-slate-800' : 'h-11 w-11 items-center justify-center rounded-xl opacity-30'}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-bold text-slate-900 dark:text-white">
          {t('calendar.monthHeading', { month: t(MONTH_KEY[month.month]!), year: month.year })}
        </Text>
        <View className="flex-row items-center gap-1">
          {showToday && (
            <Pressable
              onPress={() => setMonth(todayMonth)}
              accessibilityRole="button"
              className="h-9 justify-center rounded-full bg-teal-100 px-3 active:opacity-70 dark:bg-teal-900">
              <Text className="text-sm font-bold text-teal-800 dark:text-teal-200">
                {t('calendar.today')}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => canNext && setMonth(shiftMonth(month, 1))}
            disabled={!canNext}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            className={canNext ? 'h-11 w-11 items-center justify-center rounded-xl active:bg-slate-100 dark:active:bg-slate-800' : 'h-11 w-11 items-center justify-center rounded-xl opacity-30'}>
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Month summary */}
      <View className="flex-row justify-between rounded-xl bg-white px-4 py-3 dark:bg-slate-900">
        <SummaryStat label={t('calendar.summaryDue')} value={formatPeso(summary.amountDue)} />
        <SummaryStat label={t('calendar.summaryReceived')} value={formatPeso(summary.received)} />
        <SummaryStat
          label={t('calendar.summaryMissed')}
          value={String(summary.missedCount)}
          danger={summary.missedCount > 0}
        />
      </View>

      {/* Weekday labels */}
      <View className="flex-row">
        {WEEKDAY_KEY.map((key, i) => (
          <Text
            key={key}
            className={
              i === 6
                ? 'flex-1 text-center text-xs font-bold text-slate-400 dark:text-slate-500'
                : 'flex-1 text-center text-xs font-bold text-slate-500 dark:text-slate-400'
            }>
            {t(key)}
          </Text>
        ))}
      </View>

      {/* Grid */}
      <View className="gap-1.5">
        {grid.map((row, rowIndex) => (
          <View key={rowIndex} className="flex-row gap-1.5">
            {row.map((date, colIndex) => {
              if (!date) return <View key={colIndex} className="flex-1" style={{ aspectRatio: 1 }} />;
              const day = result.days.get(date);
              if (!day) return <View key={colIndex} className="flex-1" style={{ aspectRatio: 1 }} />;
              const dimmed = highlight !== null && day.state !== highlight;
              return (
                <DayCell
                  key={date}
                  date={date}
                  state={day.state}
                  dayNumber={Number(date.slice(8, 10))}
                  isToday={day.isToday}
                  doubleMultiple={day.doubleMultiple}
                  isMakeup={day.installment?.isMakeup ?? false}
                  hasPaymentMarker={day.hasPaymentMarker}
                  isOverdueSpan={day.isOverdueSpan}
                  dimmed={dimmed}
                  paymentType={paymentType}
                  isDark={isDark}
                  onPress={() => onDayPress(date)}
                />
              );
            })}
          </View>
        ))}
      </View>

      {/* Legend */}
      <View className="gap-2 rounded-2xl bg-white p-4 dark:bg-slate-900">
        <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
          {t('calendar.legendTitle')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {LEGEND_STATES.map((state) => {
            const style = DAY_STATE_STYLE[state];
            const selected = highlight === state;
            const count = result.counts[state];
            if (count === 0) return null;
            return (
              <Pressable
                key={state}
                onPress={() => setHighlight(selected ? null : state)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={
                  selected
                    ? 'min-h-10 flex-row items-center gap-1.5 rounded-full border-2 border-teal-600 bg-teal-50 px-3 dark:border-teal-400 dark:bg-teal-950'
                    : 'min-h-10 flex-row items-center gap-1.5 rounded-full border border-slate-200 px-3 active:opacity-70 dark:border-slate-700'
                }>
                {style.icon && (
                  <Ionicons
                    name={style.icon}
                    size={16}
                    color={isDark ? style.iconColor.dark : style.iconColor.light}
                  />
                )}
                <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t(stateLabelKey(state, paymentType))} ({count})
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function SummaryStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View className="items-center gap-0.5">
      <Text className="text-xs text-slate-500 dark:text-slate-400">{label}</Text>
      <Text
        className={
          danger
            ? 'text-base font-extrabold text-red-600 dark:text-red-400'
            : 'text-base font-bold text-slate-900 dark:text-white'
        }>
        {value}
      </Text>
    </View>
  );
}

function DayCell({
  date,
  state,
  dayNumber,
  isToday,
  doubleMultiple,
  isMakeup,
  hasPaymentMarker,
  isOverdueSpan,
  dimmed,
  paymentType,
  isDark,
  onPress,
}: {
  date: string;
  state: CalendarDayState;
  dayNumber: number;
  isToday: boolean;
  doubleMultiple: number | null;
  isMakeup: boolean;
  hasPaymentMarker: boolean;
  isOverdueSpan: boolean;
  dimmed: boolean;
  paymentType: PaymentType;
  isDark: boolean;
  onPress: () => void;
}) {
  const style = DAY_STATE_STYLE[state];
  const label = t('calendar.cellLabelNoAmount', { date, state: t(stateLabelKey(state, paymentType)) });

  if (state === 'outside') {
    return <View className="flex-1" style={{ aspectRatio: 1, minHeight: 44 }} />;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={[
        'flex-1 items-center justify-center rounded-xl',
        isOverdueSpan ? 'bg-red-50 dark:bg-red-950' : style.cellClass,
        style.dashed ? 'border border-dashed border-slate-300 dark:border-slate-600' : '',
        isToday ? 'border-2 border-teal-600 dark:border-teal-400' : '',
        dimmed ? 'opacity-25' : '',
        style.faded && !isOverdueSpan ? 'opacity-50' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ aspectRatio: 1, minHeight: 44 }}>
      <Text className="text-xs font-bold text-slate-700 dark:text-slate-200">{dayNumber}</Text>
      {style.icon && (
        <Ionicons
          name={style.icon}
          size={14}
          color={isDark ? style.iconColor.dark : style.iconColor.light}
        />
      )}
      {hasPaymentMarker && (
        <View className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-teal-600 dark:bg-teal-400" />
      )}
      {isMakeup && (
        <View className="absolute left-1 top-1 rounded-full bg-amber-500 px-1">
          <Text className="text-[9px] font-extrabold text-white">{t('calendar.makeupBadge')}</Text>
        </View>
      )}
      {doubleMultiple !== null && (
        <Text className="absolute bottom-0.5 text-[9px] font-extrabold text-slate-600 dark:text-slate-300">
          ×{doubleMultiple}
        </Text>
      )}
    </Pressable>
  );
}
