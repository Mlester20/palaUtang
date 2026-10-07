import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

type ReorderRowProps = {
  position: number;
  highlighted: boolean;
  disabledUp: boolean;
  disabledDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenMenu: () => void;
  moveUpLabel: string;
  moveDownLabel: string;
  children: ReactNode;
};

/**
 * One row in a Route order draft list: a position badge, the caller's own content, then
 * up/down (44dp) and a "more" button (Move to top/bottom/position…). Shared by src/app/route/*.
 */
export function ReorderRow({
  position,
  highlighted,
  disabledUp,
  disabledDown,
  onMoveUp,
  onMoveDown,
  onOpenMenu,
  moveUpLabel,
  moveDownLabel,
  children,
}: ReorderRowProps) {
  const colors = useThemeColors();
  return (
    <View
      className={
        highlighted
          ? 'flex-row items-center gap-2 rounded-2xl border-2 border-teal-500 bg-teal-50 p-3 dark:bg-teal-950'
          : 'flex-row items-center gap-2 rounded-2xl bg-white p-3 dark:bg-slate-900'
      }>
      <View className="h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <Text className="text-base font-extrabold text-slate-700 dark:text-slate-200">{position}</Text>
      </View>
      <View className="flex-1">{children}</View>
      <View className="flex-row items-center gap-1">
        <Pressable
          onPress={onMoveUp}
          disabled={disabledUp}
          accessibilityRole="button"
          accessibilityLabel={moveUpLabel}
          accessibilityState={{ disabled: disabledUp }}
          hitSlop={4}
          className={
            disabledUp
              ? 'h-11 w-11 items-center justify-center rounded-xl opacity-25'
              : 'h-11 w-11 items-center justify-center rounded-xl active:bg-slate-100 dark:active:bg-slate-800'
          }>
          <Ionicons name="chevron-up" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={disabledDown}
          accessibilityRole="button"
          accessibilityLabel={moveDownLabel}
          accessibilityState={{ disabled: disabledDown }}
          hitSlop={4}
          className={
            disabledDown
              ? 'h-11 w-11 items-center justify-center rounded-xl opacity-25'
              : 'h-11 w-11 items-center justify-center rounded-xl active:bg-slate-100 dark:active:bg-slate-800'
          }>
          <Ionicons name="chevron-down" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={onOpenMenu}
          accessibilityRole="button"
          accessibilityLabel={t('route.more')}
          hitSlop={4}
          className="h-11 w-11 items-center justify-center rounded-xl active:bg-slate-100 dark:active:bg-slate-800">
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}
