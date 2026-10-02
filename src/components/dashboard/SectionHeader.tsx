import { Pressable, Text, View } from 'react-native';

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-xl font-bold text-slate-900 dark:text-white">{title}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={12}
          accessibilityRole="button"
          className="min-h-12 justify-center px-2 active:opacity-60">
          <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
