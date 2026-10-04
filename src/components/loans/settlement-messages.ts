import { SettleError } from '@/db/settlement';
import { t } from '@/i18n';
import { formatDisplayDate } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import type { SettlementDateError, SettlementError } from '@/lib/settlement';

export type SettlementMessageContext = {
  startDate: string;
  latestPaymentDate: string | null;
  balance: number;
};

/** English lines for settlement validation codes (date + amount). */
export function settlementErrorLines(
  dateErrors: SettlementDateError[],
  amountErrors: SettlementError[],
  ctx: SettlementMessageContext,
): string[] {
  return [
    ...dateErrors.map((e) => {
      switch (e) {
        case 'futureDate':
          return t('settlement.errorFutureDate');
        case 'beforeStart':
          return t('settlement.errorBeforeStart', { date: formatDisplayDate(ctx.startDate) });
        case 'beforeLastPayment':
          return t('settlement.errorBeforeLastPayment', {
            date: ctx.latestPaymentDate ? formatDisplayDate(ctx.latestPaymentDate) : '',
          });
        default:
          return t('settlement.errorNotActive');
      }
    }),
    ...amountErrors.map((e) =>
      e === 'discountInvalid'
        ? t('settlement.errorDiscount', { amount: formatPeso(ctx.balance) })
        : t('settlement.errorNothing'),
    ),
  ];
}

/** Message for a failed settle/renew save, or null to fall back to the generic error alert. */
export function settleErrorText(error: unknown, ctx: SettlementMessageContext): string | null {
  if (!(error instanceof SettleError)) return null;
  switch (error.code) {
    case 'stale':
      return t('settlement.errorStale');
    case 'notFound':
      return t('settlement.notFound');
    case 'principalBelowSettlement':
      return null;
    default:
      return settlementErrorLines(error.dateErrors, error.amountErrors, ctx).join('\n') || null;
  }
}
