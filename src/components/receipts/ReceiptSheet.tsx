import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { BottomSheet } from '@/components/BottomSheet';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import type { ReceiptData } from '@/lib/receipt';
import { useThemeColors } from '@/lib/theme';
import {
  copyReceiptAsText,
  loadReceiptData,
  shareReceiptAsText,
  shareReceiptPng,
} from '@/services/receipt';
import { useDocumentSettings } from '@/store/document-settings';

import { ReceiptView } from './ReceiptView';

/** PNG target width in real pixels (accounts for device PixelRatio via captureRef's resize). */
const TARGET_PNG_WIDTH = 1080;

type ReceiptSheetProps = {
  /** null hides the sheet (unless sampleData is given). Changing it reloads for the new payment. */
  paymentId: number | null;
  /** Settings → Preview with no real payments yet: shows this instead of loading from the DB. */
  sampleData?: ReceiptData | null;
  onClose: () => void;
};

/**
 * "Receipt" action target: loads ONE payment's receipt and offers Share as image / Share as
 * text / Copy as text. The full receipt (ReceiptView) is always mounted off-screen so it can be
 * captured with captureRef the moment "Share as image" is tapped, even before that button is
 * pressed once — capturing on first tap would otherwise race the off-screen view's first layout.
 */
export function ReceiptSheet({ paymentId, sampleData, onClose }: ReceiptSheetProps) {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const settings = useDocumentSettings();
  // Keyed by the payment id it was loaded for, so a paymentId change shows "loading" again
  // immediately (without a synchronous setState at the top of the effect below).
  const [loaded, setLoaded] = useState<{ id: number; data: ReceiptData | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const receiptRef = useRef<View>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  const visible = paymentId !== null || !!sampleData;
  // Sample data (Settings → Preview with no real payments) never touches the DB or this state.
  const data = sampleData ?? (loaded && loaded.id === paymentId ? loaded.data : undefined);

  useEffect(() => {
    if (sampleData || paymentId === null) return;
    let active = true;
    loadReceiptData(db, paymentId)
      .then((d) => active && setLoaded({ id: paymentId, data: d }))
      .catch((error) => {
        console.error('[Load receipt failed]', error);
        if (active) setLoaded({ id: paymentId, data: null });
      });
    return () => {
      active = false;
    };
  }, [db, paymentId, sampleData]);

  const onLayoutReceipt = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) size.current = { width, height };
  };

  const captureImage = async (): Promise<string | null> => {
    if (!receiptRef.current || !size.current) return null;
    const targetHeight = Math.round((TARGET_PNG_WIDTH / size.current.width) * size.current.height);
    return captureRef(receiptRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      width: TARGET_PNG_WIDTH,
      height: targetHeight,
    });
  };

  const onShareImage = async () => {
    if (busy || !data) return;
    setBusy(true);
    try {
      const uri = await captureImage();
      if (!uri) throw new Error('Receipt image is not ready yet.');
      await shareReceiptPng(uri, data.receiptNo);
    } catch (error) {
      showError(t('receipts.generateFailed'), error);
    } finally {
      setBusy(false);
    }
  };

  const onShareText = async () => {
    if (busy || !data) return;
    setBusy(true);
    try {
      await shareReceiptAsText(data);
    } catch (error) {
      showError(t('receipts.generateFailed'), error);
    } finally {
      setBusy(false);
    }
  };

  const onCopyText = async () => {
    if (busy || !data) return;
    setBusy(true);
    try {
      await copyReceiptAsText(data);
      Alert.alert(t('receipts.title'), t('receipts.copied'));
    } catch (error) {
      showError(t('receipts.generateFailed'), error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} locked={busy}>
        {data === undefined ? (
          <View className="items-center py-6">
            <ActivityIndicator size="large" />
          </View>
        ) : data === null ? (
          <View className="gap-3 py-2">
            <Text className="text-lg font-bold text-slate-900 dark:text-white">
              {t('receipts.receiptNotAvailable')}
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            <Text className="pb-1 text-xl font-bold text-slate-900 dark:text-white" numberOfLines={1}>
              {data.borrowerName}
            </Text>
            <Text className="pb-2 text-base text-slate-600 dark:text-slate-300">
              {data.receiptNo} {'·'} {formatPeso(data.amountReceived)}
            </Text>
            <Action
              icon="image-outline"
              label={t('receipts.shareAsImage')}
              busy={busy}
              onPress={onShareImage}
              colors={colors}
            />
            <Action
              icon="chatbox-ellipses-outline"
              label={t('receipts.shareAsText')}
              busy={busy}
              onPress={onShareText}
              colors={colors}
            />
            <Action
              icon="copy-outline"
              label={t('receipts.copyAsText')}
              busy={busy}
              onPress={onCopyText}
              colors={colors}
            />
          </View>
        )}
        <Pressable
          onPress={onClose}
          disabled={busy}
          accessibilityRole="button"
          className="mt-1 min-h-14 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
          <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
            {t('receipts.done')}
          </Text>
        </Pressable>
      </BottomSheet>

      {/* Off-screen: never visible, always laid out so captureRef has real pixels to read. */}
      {data && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: -9999, opacity: 0 }}>
          <View ref={receiptRef} collapsable={false} onLayout={onLayoutReceipt}>
            <ReceiptView data={data} settings={settings} />
          </View>
        </View>
      )}
    </>
  );
}

function Action({
  icon,
  label,
  busy,
  onPress,
  colors,
}: {
  icon: 'image-outline' | 'chatbox-ellipses-outline' | 'copy-outline';
  label: string;
  busy: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3 active:opacity-70 dark:bg-slate-800">
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text className="flex-1 text-lg font-semibold text-slate-900 dark:text-white">{label}</Text>
      {busy && <ActivityIndicator />}
    </Pressable>
  );
}
