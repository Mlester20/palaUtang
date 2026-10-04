import { CashError } from '@/db/cash';
import { t, type TranslationKey } from '@/i18n';
import type { CashEntryError, CashKind } from '@/lib/cash';

const KIND: Record<CashKind, TranslationKey> = {
  opening: 'cash.kindOpening',
  capital_in: 'cash.kindCapitalIn',
  withdrawal: 'cash.kindWithdrawal',
  expense: 'cash.kindExpense',
  adjustment: 'cash.kindAdjustment',
};

export function kindLabel(kind: CashKind): string {
  return t(KIND[kind]);
}

const CATEGORY: Record<string, TranslationKey> = {
  'withdrawal.personal': 'cash.catPersonal',
  'withdrawal.bills': 'cash.catBills',
  'withdrawal.capital_return': 'cash.catCapitalReturn',
  'withdrawal.other': 'cash.catOther',
  'expense.transport': 'cash.catTransport',
  'expense.load_data': 'cash.catLoadData',
  'expense.collector_pay': 'cash.catCollectorPay',
  'expense.supplies': 'cash.catSupplies',
  'expense.other': 'cash.catOther',
};

/** Unknown (future) categories show as-is instead of breaking. */
export function categoryLabel(kind: CashKind, category: string | null): string {
  if (!category) return '';
  const key = CATEGORY[`${kind}.${category}`];
  return key ? t(key) : category;
}

const ENTRY_ERROR: Record<CashEntryError, TranslationKey> = {
  notSetUp: 'cash.errNotSetUp',
  kindInvalid: 'cash.errKind',
  directionInvalid: 'cash.errKind',
  categoryInvalid: 'cash.errCategory',
  amountInvalid: 'cash.errAmount',
  amountTooLarge: 'cash.errAmountTooLarge',
  beforeStart: 'cash.errBeforeStart',
  futureDate: 'cash.errFutureDate',
};

export function entryErrorText(error: CashEntryError): string {
  return t(ENTRY_ERROR[error]);
}

/** Message for anything a cash save can throw (null = not a CashError; show it generically). */
export function cashErrorText(error: unknown): string | null {
  if (!(error instanceof CashError)) return null;
  switch (error.code) {
    case 'invalid':
      return error.errors.map(entryErrorText).join('\n');
    case 'notSetUp':
      return t('cash.errNotSetUp');
    case 'alreadySetUp':
      return t('cash.errAlreadySetUp');
    case 'alreadyVoided':
      return t('cash.errAlreadyVoided');
    case 'useAdjustOpening':
      return t('cash.errUseAdjustOpening');
    case 'reasonRequired':
      return t('cash.errReasonRequired');
    case 'noteRequired':
      return t('cash.errNoteRequired');
    case 'entriesBeforeStart':
      return t('cash.errEntriesBeforeStart', { count: error.count });
    case 'stale':
      return t('cash.errStale');
    default:
      return t('cash.errNotFound');
  }
}
