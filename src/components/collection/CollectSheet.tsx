import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { t } from '@/i18n';
import { formatPeso } from '@/lib/money';
import type { PaymentPreview } from '@/lib/payments';

type CollectSheetProps = {
  visible: boolean;
  borrowerName: string;
  amount: number;
  /** null while loading. */
  preview: PaymentPreview | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** One-tap Collect always lands here first, so an accidental tap never records money. */
export function CollectSheet({
  visible,
  borrowerName,
  amount,
  preview,
  saving,
  onCancel,
  onConfirm,
}: CollectSheetProps) {
  const lines: string[] = [];
  if (preview) {
    const overdueOnly = preview.lines
      .filter((l) => l.kind === 'overdue')
      .reduce((sum, l) => sum + l.amount, 0);
    const advance = preview.lines.filter((l) => l.kind === 'advance').length;
    if (preview.recoveredCount > 0)
      lines.push(t('collection.previewRecovers', { count: preview.recoveredCount }));
    if (overdueOnly > 0)
      lines.push(t('collection.previewOverdue', { amount: formatPeso(overdueOnly) }));
    if (preview.lines.some((l) => l.kind === 'today')) lines.push(t('collection.previewToday'));
    if (advance > 0) lines.push(t('collection.previewAdvance', { count: advance }));
    if (preview.completesLoan) lines.push(t('collection.previewCompletes'));
  }
  const canConfirm = preview !== null && preview.errors.length === 0 && !saving;

  return (
    <BottomSheet visible={visible} onClose={onCancel} locked={saving}>
      <View className="gap-1">
        <Text className="text-2xl font-extrabold text-slate-900 dark:text-white">
          {t('collection.confirmTitle', { amount: formatPeso(amount) })}
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-300">
          {t('collection.confirmFrom', { name: borrowerName })}
        </Text>
      </View>

      <View className="min-h-20 gap-2 rounded-2xl bg-teal-50 p-4 dark:bg-teal-950">
        {preview === null ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {t('collection.previewChecking')}
            </Text>
          </View>
        ) : (
          <>
            {lines.map((line) => (
              <Text key={line} className="text-base font-semibold text-slate-900 dark:text-white">
                • {line}
              </Text>
            ))}
            <Text className="text-base text-slate-700 dark:text-slate-200">
              {t('collection.previewBalanceAfter', { amount: formatPeso(preview.balanceAfter) })}
            </Text>
          </>
        )}
      </View>

      <View className="flex-row gap-3">
        <Pressable
          onPress={onCancel}
          disabled={saving}
          accessibilityRole="button"
          className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
          <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
            {t('collection.cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          disabled={!canConfirm}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canConfirm, busy: saving }}
          style={{ flex: 2 }}
          className={
            canConfirm
              ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
              : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-50 dark:bg-teal-500'
          }>
          {saving && <ActivityIndicator color="#ffffff" />}
          <Text className="text-lg font-extrabold text-white">
            {t('collection.confirmButton', { amount: formatPeso(amount) })}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
