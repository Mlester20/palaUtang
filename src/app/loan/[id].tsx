import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InstallmentStatusChip, LoanStatusBadge } from '@/components/loans/StatusBadges';
import { ProgressBar } from '@/components/loans/ProgressBar';
import { canCancelLoan, cancelLoan, getInstallmentsByLoan, getLoanById } from '@/db/loans';
import { showError } from '@/lib/errors';
import {
  assessProfit,
  formatDisplayDate,
  formatMonthYear,
  formatPercent,
  formatShortDate,
} from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { useThemeColors } from '@/lib/theme';
import type { Installment, LoanSummary } from '@/types/loan';

type LoadedLoan = { loan: LoanSummary; installments: Installment[]; canCancel: boolean };

/** Groups the schedule by month for sticky month headers. */
function groupByMonth(installments: Installment[]) {
  const sections: { title: string; data: Installment[] }[] = [];
  for (const inst of installments) {
    const title = formatMonthYear(inst.dueDate);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(inst);
    else sections.push({ title, data: [inst] });
  }
  return sections;
}

export default function LoanDetailScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data, setData] = useState<LoadedLoan | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [loan, installments, canCancel] = await Promise.all([
      getLoanById(db, id),
      getInstallmentsByLoan(db, id),
      canCancelLoan(db, id),
    ]);
    return loan ? { loan, installments, canCancel } : null;
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load()
        .then((result) => active && setData(result))
        .catch((error) => {
          console.error('[Load loan failed]', error);
          if (active) setData(null);
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  if (data === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (data === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          This loan could not be found.
        </Text>
      </View>
    );
  }

  const { loan, installments, canCancel } = data;
  const progress = loan.totalCount > 0 ? loan.paidCount / loan.totalCount : 0;
  const sections = groupByMonth(installments);
  const profit = assessProfit(loan.principal, loan.totalPayable, loan.startDate, loan.endDate);

  const confirmCancel = () => {
    Alert.alert(
      'Cancel this loan?',
      `The ${formatPeso(loan.principal)} loan for ${loan.borrowerName} will be marked cancelled. Its schedule is kept for your records. This cannot be undone.`,
      [
        { text: 'Keep loan', style: 'cancel' },
        {
          text: 'Cancel loan',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await cancelLoan(db, loan.id);
              setData(await load());
              Alert.alert('Loan cancelled', 'The loan is now marked as cancelled.');
            } catch (error) {
              showError('Could not cancel the loan', error);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const header = (
    <View className="gap-4 pb-4">
      {/* Summary */}
      <View className="gap-4 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <View className="flex-row items-start justify-between gap-3">
          <Pressable
            onPress={() =>
              router.push({ pathname: '/borrower/[id]', params: { id: String(loan.borrowerId) } })
            }
            accessibilityRole="link"
            hitSlop={8}
            className="flex-1 active:opacity-60">
            <Text className="text-sm text-slate-500 dark:text-slate-400">Borrower</Text>
            <View className="flex-row items-center gap-1">
              <Text
                className="flex-shrink text-xl font-bold text-teal-700 dark:text-teal-300"
                numberOfLines={1}>
                {loan.borrowerName}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </View>
          </Pressable>
          <LoanStatusBadge status={loan.status} />
        </View>

        <View className="gap-1">
          <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Total payable
          </Text>
          <Text
            className="text-3xl font-extrabold text-slate-900 dark:text-white"
            numberOfLines={1}
            adjustsFontSizeToFit>
            {formatPeso(loan.totalPayable)}
          </Text>
        </View>

        <View className="gap-2">
          <Row label="Principal" value={formatPeso(loan.principal)} />
          <Row
            label="Profit (tubo)"
            value={`${formatPeso(profit.profitCentavos)} · ${formatPercent(profit.ratePercent)} (≈${formatPercent(profit.monthlyRatePercent)}/mo)`}
          />
          {loan.paymentType === 'daily' ? (
            <>
              <Row
                label="Hulog"
                value={`${formatPeso(loan.installmentAmount)} × ${loan.numberOfInstallments} days`}
              />
              <Row label="Skip Sundays" value={loan.skipSundays ? 'Yes' : 'No'} />
            </>
          ) : (
            <Row label="Payment" value="Lump sum (one payment)" />
          )}
          <Row label="Start date" value={formatDisplayDate(loan.startDate)} />
          <Row
            label={loan.paymentType === 'daily' ? 'Last due date' : 'Due date'}
            value={formatDisplayDate(loan.endDate)}
          />
          {loan.notes && <Row label="Notes" value={loan.notes} />}
        </View>
      </View>

      {/* Progress */}
      <View className="gap-2 rounded-2xl bg-white p-5 dark:bg-slate-900">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-lg font-bold text-slate-900 dark:text-white">
            {loan.paidCount}/{loan.totalCount} paid
          </Text>
          <Text className="text-base text-slate-600 dark:text-slate-300">
            {formatPeso(loan.amountPaid)} collected
          </Text>
        </View>
        <ProgressBar value={progress} />
      </View>

      {/* Actions */}
      <View
        className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-100 px-4 opacity-70 dark:border-slate-700 dark:bg-slate-900"
        accessibilityState={{ disabled: true }}>
        <Ionicons name="cash-outline" size={22} color={colors.textMuted} />
        <Text className="text-base font-semibold text-slate-500 dark:text-slate-400">
          Record payment: coming in the next phase
        </Text>
      </View>
      {canCancel && (
        <Pressable
          onPress={confirmCancel}
          disabled={busy}
          accessibilityRole="button"
          className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-red-300 bg-white active:opacity-70 dark:border-red-900 dark:bg-slate-900">
          <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
          <Text className="text-lg font-bold text-red-600 dark:text-red-400">Cancel loan</Text>
        </Pressable>
      )}

      <Text className="pt-2 text-xl font-bold text-slate-900 dark:text-white">
        Schedule ({installments.length})
      </Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: `Loan · ${loan.borrowerName}` }} />
      <SectionList
        className="flex-1 bg-slate-50 dark:bg-slate-950"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: insets.bottom + 24,
        }}
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        initialNumToRender={20}
        windowSize={10}
        renderSectionHeader={({ section }) => (
          <View className="bg-slate-50 py-2 dark:bg-slate-950">
            <Text className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View
            className={[
              'min-h-14 flex-row items-center gap-3 bg-white px-4 py-3 dark:bg-slate-900',
              index === 0 ? 'rounded-t-2xl' : 'border-t border-slate-100 dark:border-slate-800',
              index === section.data.length - 1 ? 'mb-3 rounded-b-2xl' : '',
            ].join(' ')}>
            <Text className="w-10 text-base font-bold text-slate-500 dark:text-slate-400">
              #{item.installmentNumber}
            </Text>
            <Text className="flex-1 text-base text-slate-900 dark:text-white">
              {formatShortDate(item.dueDate)}
            </Text>
            <Text className="text-base font-bold text-slate-900 dark:text-white">
              {formatPeso(item.amountDue)}
            </Text>
            <InstallmentStatusChip status={item.status} />
          </View>
        )}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-base text-slate-600 dark:text-slate-300">{label}</Text>
      <Text className="flex-shrink text-right text-base font-semibold text-slate-900 dark:text-white">
        {value}
      </Text>
    </View>
  );
}
