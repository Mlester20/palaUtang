import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

type QuickActionButtonProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
};

export function QuickActionButton({ icon, label, onPress }: QuickActionButtonProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 items-center gap-2 active:opacity-60">
      <View className="h-16 w-16 items-center justify-center rounded-2xl bg-white dark:bg-slate-900">
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text
        className="text-center text-sm font-semibold text-slate-800 dark:text-slate-100"
        numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}
