import { Text, View } from 'react-native';

import { formatDisplayDate, formatPercent, formatShortDate } from '@/lib/loan';
import { formatPeso } from '@/lib/money';

type LoanPreviewCardProps = {
  interestCentavos: number;
  totalPayableCentavos: number;
  installmentCentavos: number;
  lastInstallmentCentavos: number;
  numberOfInstallments: number;
  /** Shown when the loan was entered by amount (rate is derived). */
  derivedRatePercent?: number;
  endDate: string;
  firstDueDates: string[];
  isLumpSum: boolean;
};

export function LoanPreviewCard({
  interestCentavos,
  totalPayableCentavos,
  installmentCentavos,
  lastInstallmentCentavos,
  numberOfInstallments,
  derivedRatePercent,
  endDate,
  firstDueDates,
  isLumpSum,
}: LoanPreviewCardProps) {
  const unevenLast = !isLumpSum && lastInstallmentCentavos !== installmentCentavos;

  return (
    <View className="gap-4 rounded-2xl border-2 border-teal-600 bg-teal-50 p-5 dark:border-teal-500 dark:bg-teal-950">
      <Text className="text-sm font-bold uppercase text-teal-800 dark:text-teal-200">Preview</Text>

      <View className="gap-1">
        <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          Total payable
        </Text>
        <Text
          className="text-3xl font-extrabold text-slate-900 dark:text-white"
          numberOfLines={1}
          adjustsFontSizeToFit>
          {formatPeso(totalPayableCentavos)}
        </Text>
      </View>

      <View className="gap-2">
        <Row label="Interest" value={formatPeso(interestCentavos)} />
        {derivedRatePercent !== undefined && (
          <Row label="Interest rate (computed)" value={formatPercent(derivedRatePercent)} />
        )}
        {isLumpSum ? (
          <Row label="Pay once on" value={formatDisplayDate(endDate)} />
        ) : (
          <>
            <Row label="Installments" value={`${numberOfInstallments} daily`} />
            <Row label="Per installment" value={formatPeso(installmentCentavos)} strong />
            {unevenLast && (
              <Row label="Last installment" value={formatPeso(lastInstallmentCentavos)} />
            )}
            <Row label="Last due date" value={formatDisplayDate(endDate)} />
          </>
        )}
      </View>

      {!isLumpSum && firstDueDates.length > 0 && (
        <View className="gap-1.5 border-t border-teal-200 pt-3 dark:border-teal-800">
          <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            First due dates
          </Text>
          <Text className="text-base text-slate-900 dark:text-white">
            {firstDueDates.map(formatShortDate).join('  ·  ')}
            {numberOfInstallments > firstDueDates.length ? '  …' : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="flex-shrink text-base text-slate-600 dark:text-slate-300">{label}</Text>
      <Text
        className={
          strong
            ? 'text-lg font-extrabold text-teal-800 dark:text-teal-200'
            : 'text-base font-semibold text-slate-900 dark:text-white'
        }>
        {value}
      </Text>
    </View>
  );
}
