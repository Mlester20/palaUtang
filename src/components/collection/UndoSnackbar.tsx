import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';

type UndoSnackbarProps = {
  /** null hides it. A new message (new key) restarts the timer. */
  message: { key: number; text: string; canUndo: boolean } | null;
  undoing: boolean;
  onUndo: () => void;
  onHide: () => void;
  durationMs?: number;
};

/** Bottom toast with an Undo action, auto-hidden after ~6 seconds. */
export function UndoSnackbar({
  message,
  undoing,
  onUndo,
  onHide,
  durationMs = 6000,
}: UndoSnackbarProps) {
  useEffect(() => {
    if (!message || undoing) return;
    const timer = setTimeout(onHide, durationMs);
    return () => clearTimeout(timer);
  }, [message, undoing, onHide, durationMs]);

  if (!message) return null;

  return (
    <View
      className="absolute bottom-4 left-4 right-4 min-h-14 flex-row items-center gap-3 rounded-2xl bg-slate-900 px-4 py-2 shadow-lg dark:bg-slate-100"
      accessibilityLiveRegion="polite">
      <Text className="flex-1 text-base font-semibold text-white dark:text-slate-900">
        {message.text}
      </Text>
      {message.canUndo &&
        (undoing ? (
          <ActivityIndicator />
        ) : (
          <Pressable
            onPress={onUndo}
            hitSlop={8}
            accessibilityRole="button"
            className="min-h-12 justify-center px-3 active:opacity-60">
            <Text className="text-base font-extrabold uppercase text-teal-300 dark:text-teal-700">
              {t('collection.undo')}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}
