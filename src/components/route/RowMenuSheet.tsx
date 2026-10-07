import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

type RowMenuSheetProps = {
  visible: boolean;
  onClose: () => void;
  max: number;
  onTop: () => void;
  onBottom: () => void;
  onToPosition: (position: number) => void;
};

/**
 * "Move to top / bottom / position…" for the row the "more" button was opened on. Callers key
 * this component by the open row's id (see src/app/route/*), so each open is a fresh mount —
 * no leftover position-input text from the row that was open last.
 */
export function RowMenuSheet({ visible, onClose, max, onTop, onBottom, onToPosition }: RowMenuSheetProps) {
  const colors = useThemeColors();
  const [positionText, setPositionText] = useState('');
  const [showPositionInput, setShowPositionInput] = useState(false);

  const parsed = Number(positionText);
  const positionValid = positionText.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= max;

  const confirmPosition = () => {
    if (!positionValid) return;
    onToPosition(parsed);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {showPositionInput ? (
        <View className="gap-3">
          <Text className="text-xl font-bold text-slate-900 dark:text-white">
            {t('route.moveToPosition')}
          </Text>
          <TextInput
            value={positionText}
            onChangeText={setPositionText}
            keyboardType="number-pad"
            placeholder={t('route.positionPrompt', { max })}
            placeholderTextColor={colors.textMuted}
            autoFocus
            className="min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-lg text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {positionText.trim() !== '' && !positionValid && (
            <Text className="text-sm font-medium text-red-600 dark:text-red-400">
              {t('route.positionInvalid', { max })}
            </Text>
          )}
          <View className="flex-row gap-3 pt-1">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
              <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {t('route.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={confirmPosition}
              disabled={!positionValid}
              accessibilityRole="button"
              className={
                positionValid
                  ? 'min-h-14 flex-1 items-center justify-center rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
                  : 'min-h-14 flex-1 items-center justify-center rounded-2xl bg-teal-700 opacity-50 dark:bg-teal-500'
              }>
              <Text className="text-lg font-bold text-white">{t('route.save')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="gap-1">
          <Pressable
            onPress={onTop}
            accessibilityRole="button"
            className="min-h-14 justify-center rounded-xl px-2 active:bg-slate-100 dark:active:bg-slate-800">
            <Text className="text-lg text-slate-900 dark:text-white">{t('route.moveToTop')}</Text>
          </Pressable>
          <Pressable
            onPress={onBottom}
            accessibilityRole="button"
            className="min-h-14 justify-center rounded-xl px-2 active:bg-slate-100 dark:active:bg-slate-800">
            <Text className="text-lg text-slate-900 dark:text-white">{t('route.moveToBottom')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowPositionInput(true)}
            accessibilityRole="button"
            className="min-h-14 justify-center rounded-xl px-2 active:bg-slate-100 dark:active:bg-slate-800">
            <Text className="text-lg text-slate-900 dark:text-white">{t('route.moveToPosition')}</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="min-h-14 justify-center rounded-xl px-2 active:bg-slate-100 dark:active:bg-slate-800">
            <Text className="text-lg font-semibold text-slate-500 dark:text-slate-400">
              {t('route.cancel')}
            </Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}
