import { Pressable, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { formatFullDate } from '@/lib/date';
import { parseYmd } from '@/lib/loan';
import type { LoanSummary } from '@/types/loan';

import { ProgressBar } from './ProgressBar';
import { LoanStatusBadge, RenewedMarker } from './StatusBadges';

type LoanCardProps = {
  loan: Pick<
    LoanSummary,
    | 'principal'
    | 'totalPayable'
    | 'status'
    | 'paidCount'
    | 'totalCount'
    | 'startDate'
    | 'paymentType'
    | 'renewedByLoanId'
  >;
  onPress: () => void;
};

export function LoanCard({ loan, onPress }: LoanCardProps) {
  const progress = loan.totalCount > 0 ? loan.paidCount / loan.totalCount : 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="gap-3 rounded-2xl bg-white p-4 active:opacity-70 dark:bg-slate-900">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            {loan.paymentType === 'daily' ? 'Daily' : 'Lump sum'} · started{' '}
            {formatFullDate(parseYmd(loan.startDate))}
          </Text>
          <Money
            value={loan.principal}
            kind="borrower"
            className="text-xl font-extrabold text-slate-900 dark:text-white"
          />
          <Text className="text-sm text-slate-600 dark:text-slate-300">
            Total payable <Money value={loan.totalPayable} kind="borrower" />
          </Text>
        </View>
        <View className="items-end gap-1">
          <LoanStatusBadge status={loan.status} />
          {loan.renewedByLoanId !== null && <RenewedMarker />}
        </View>
      </View>
      <View className="gap-1.5">
        <ProgressBar value={progress} />
        <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          {loan.paidCount}/{loan.totalCount} paid
        </Text>
      </View>
    </Pressable>
  );
}
