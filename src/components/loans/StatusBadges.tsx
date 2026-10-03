import { Text, View } from 'react-native';

import { t } from '@/i18n';
import type { InstallmentStatus, LoanStatus, PaymentType } from '@/types/loan';

type BadgeStyle = { label: string; box: string; text: string };

const LOAN_STATUS: Record<LoanStatus, BadgeStyle> = {
  active: {
    label: 'Active',
    box: 'rounded-full bg-teal-100 px-3 py-1 dark:bg-teal-950',
    text: 'text-sm font-bold text-teal-800 dark:text-teal-200',
  },
  completed: {
    label: 'Completed',
    box: 'rounded-full bg-green-100 px-3 py-1 dark:bg-green-950',
    text: 'text-sm font-bold text-green-800 dark:text-green-300',
  },
  cancelled: {
    label: 'Cancelled',
    box: 'rounded-full bg-slate-200 px-3 py-1 dark:bg-slate-700',
    text: 'text-sm font-bold text-slate-700 dark:text-slate-200',
  },
};

const INSTALLMENT_STATUS: Record<InstallmentStatus, BadgeStyle> = {
  pending: {
    label: 'Pending',
    box: 'rounded-full bg-slate-200 px-2.5 py-0.5 dark:bg-slate-700',
    text: 'text-xs font-bold text-slate-700 dark:text-slate-200',
  },
  paid: {
    label: 'Paid',
    box: 'rounded-full bg-green-100 px-2.5 py-0.5 dark:bg-green-950',
    text: 'text-xs font-bold text-green-800 dark:text-green-300',
  },
  partial: {
    label: 'Partial',
    box: 'rounded-full bg-amber-100 px-2.5 py-0.5 dark:bg-amber-950',
    text: 'text-xs font-bold text-amber-800 dark:text-amber-300',
  },
  missed: {
    label: 'Balda',
    box: 'rounded-full bg-red-100 px-2.5 py-0.5 dark:bg-red-950',
    text: 'text-xs font-bold text-red-700 dark:text-red-300',
  },
  skipped: {
    label: t('payments.chipSkipped'),
    box: 'rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 dark:border-slate-600',
    text: 'text-xs font-bold text-slate-400 dark:text-slate-500',
  },
};

function Badge({ style }: { style: BadgeStyle }) {
  return (
    <View className={style.box}>
      <Text className={style.text}>{style.label}</Text>
    </View>
  );
}

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  return <Badge style={LOAN_STATUS[status]} />;
}

/** Lump-sum loans show a past-due balance as "Overdue" (no balda/make-up for them). */
export function InstallmentStatusChip({
  status,
  paymentType = 'daily',
}: {
  status: InstallmentStatus;
  paymentType?: PaymentType;
}) {
  const style =
    status === 'missed' && paymentType === 'lump_sum'
      ? { ...INSTALLMENT_STATUS.missed, label: t('payments.chipOverdue') }
      : INSTALLMENT_STATUS[status];
  return <Badge style={style} />;
}

/** Small marker for installments paid before their due date. */
export function AdvanceMarker() {
  return (
    <Badge
      style={{
        label: t('payments.advance'),
        box: 'rounded-full bg-sky-100 px-2.5 py-0.5 dark:bg-sky-950',
        text: 'text-xs font-bold text-sky-800 dark:text-sky-200',
      }}
    />
  );
}
