import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { StatusChip } from '@/components/dashboard';
import { useMoneyText } from '@/components/Money';
import { t } from '@/i18n';
import type { CashEntry, LedgerItem } from '@/lib/cash';
import { useThemeColors } from '@/lib/theme';
import type { ChipTone } from '@/types/dashboard';

import { categoryLabel, kindLabel } from './cash-text';

const KIND_TONE: Record<CashEntry['kind'], ChipTone> = {
  opening: 'info',
  capital_in: 'success',
  withdrawal: 'flagged',
  expense: 'partial',
  adjustment: 'neutral',
};

type LedgerItemRowProps = {
  item: LedgerItem;
  onOpenCollection: () => void;
  onOpenLoan: (loanId: number) => void;
  onVoid: (entry: CashEntry) => void;
};

function Amount({ value, direction, struck }: { value: number; direction: 'in' | 'out'; struck?: boolean }) {
  const moneyText = useMoneyText();
  return (
    <Text
      className={
        struck
          ? 'text-lg font-bold text-slate-400 line-through dark:text-slate-500'
          : direction === 'in'
            ? 'text-lg font-bold text-green-700 dark:text-green-400'
            : 'text-lg font-bold text-slate-900 dark:text-white'
      }>
      {`${direction === 'in' ? '+' : '−'}${moneyText(value, 'total')}`}
    </Text>
  );
}

/** One ledger line: derived (collections, releases: read-only links) or a manual entry. */
function LedgerItemRowBase({ item, onOpenCollection, onOpenLoan, onVoid }: LedgerItemRowProps) {
  const colors = useThemeColors();
  const moneyText = useMoneyText();

  if (item.type === 'collection') {
    return (
      <Pressable
        onPress={onOpenCollection}
        accessibilityRole="button"
        className="min-h-16 flex-row items-center gap-3 rounded-2xl bg-white px-4 py-3 active:opacity-70 dark:bg-slate-900">
        <Ionicons name="cash" size={22} color={colors.primary} />
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900 dark:text-white">
            {t('cash.rowCollections')}
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            {item.count === 1 ? t('cash.onePayment') : t('cash.payments', { count: item.count })}
          </Text>
        </View>
        <Amount value={item.amount} direction="in" />
      </Pressable>
    );
  }

  if (item.type === 'release') {
    const r = item.release;
    return (
      <Pressable
        onPress={() => onOpenLoan(r.loanId)}
        accessibilityRole="button"
        className="min-h-16 flex-row items-center gap-3 rounded-2xl bg-white px-4 py-3 active:opacity-70 dark:bg-slate-900">
        <Ionicons name="arrow-up-circle" size={22} color={colors.textMuted} />
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900 dark:text-white" numberOfLines={1}>
            {t('cash.rowRelease', { name: r.borrowerName })}
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            {r.nettedAmount
              ? t('cash.rowRenewal', {
                  principal: moneyText(r.principal, 'total'),
                  netted: moneyText(r.nettedAmount, 'total'),
                })
              : t('cash.loanRef', { id: r.loanId })}
          </Text>
        </View>
        <Amount value={r.amount} direction="out" />
      </Pressable>
    );
  }

  const e = item.entry;
  const voided = e.status === 'voided';
  const category = categoryLabel(e.kind, e.category);
  return (
    <View className="gap-2 rounded-2xl bg-white px-4 py-3 dark:bg-slate-900">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <StatusChip label={kindLabel(e.kind)} tone={voided ? 'neutral' : KIND_TONE[e.kind]} size="sm" />
            {category ? (
              <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">{category}</Text>
            ) : null}
          </View>
          {e.note ? (
            <Text
              className={
                voided
                  ? 'text-sm text-slate-400 line-through dark:text-slate-500'
                  : 'text-sm text-slate-600 dark:text-slate-300'
              }>
              {e.note}
            </Text>
          ) : null}
        </View>
        <Amount value={e.amount} direction={e.direction} struck={voided} />
      </View>
      {voided ? (
        <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
          {t('cash.voidedBecause', { reason: e.voidReason ?? '' })}
        </Text>
      ) : e.kind !== 'opening' ? (
        <Pressable
          onPress={() => onVoid(e)}
          hitSlop={8}
          accessibilityRole="button"
          className="min-h-11 self-end justify-center px-2 active:opacity-60">
          <Text className="text-base font-semibold text-red-600 dark:text-red-400">{t('cash.void')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const LedgerItemRow = memo(LedgerItemRowBase);
