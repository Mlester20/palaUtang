import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

type VoidPaymentModalProps = {
  visible: boolean;
  /** e.g. "₱300.00 payment on Friday, October 9, 2026" pieces for the message. */
  amountText: string;
  dateText: string;
  /** Extra warning shown above the reason (e.g. voiding a settlement reopens the loan). */
  warning?: string;
  /** Override the payment wording (e.g. for a cash entry). */
  title?: string;
  message?: string;
  onCancel: () => void;
  /** Resolves when done; the modal stays open (busy) until then. */
  onConfirm: (reason: string) => Promise<void>;
};

/** Confirmation with a required reason (Alert.prompt is iOS-only, so this is a small modal). */
export function VoidPaymentModal({
  visible,
  amountText,
  dateText,
  warning,
  title,
  message,
  onCancel,
  onConfirm,
}: VoidPaymentModalProps) {
  const colors = useThemeColors();
  const [reason, setReason] = useState('');
  const [showError, setShowError] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setReason('');
    setShowError(false);
    onCancel();
  };

  const confirm = async () => {
    if (!reason.trim()) {
      setShowError(true);
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
      setShowError(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <View className="w-full max-w-md gap-4 rounded-2xl bg-white p-5 dark:bg-slate-900">
            <Text className="text-xl font-bold text-slate-900 dark:text-white">
              {title ?? t('payments.voidTitle')}
            </Text>
            <Text className="text-base text-slate-700 dark:text-slate-300">
              {message ?? t('payments.voidMessage', { amount: amountText, date: dateText })}
            </Text>
            {warning && (
              <View className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950">
                <Text className="text-base font-semibold text-amber-900 dark:text-amber-100">
                  {warning}
                </Text>
              </View>
            )}

            <View className="gap-2">
              <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
                {t('payments.voidReasonLabel')}
              </Text>
              <TextInput
                value={reason}
                onChangeText={(text) => {
                  setReason(text);
                  if (text.trim()) setShowError(false);
                }}
                placeholder={t('payments.voidReasonPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoFocus
                editable={!busy}
                className={
                  showError
                    ? 'min-h-14 rounded-xl border-2 border-red-500 bg-white px-4 text-lg text-slate-900 dark:bg-slate-950 dark:text-white'
                    : 'min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-lg text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white'
                }
              />
              {showError && (
                <Text className="text-sm font-medium text-red-600 dark:text-red-400">
                  {t('payments.voidReasonRequired')}
                </Text>
              )}
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={close}
                disabled={busy}
                accessibilityRole="button"
                className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
                <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                  {t('payments.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={confirm}
                disabled={busy}
                accessibilityRole="button"
                className="min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-red-600 active:bg-red-700">
                {busy && <ActivityIndicator color="#ffffff" />}
                <Text className="text-lg font-bold text-white">{t('payments.voidConfirm')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
