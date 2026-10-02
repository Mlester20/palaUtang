import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Text, View } from 'react-native';

type EmptyStateProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
};

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <View className="items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 dark:border-slate-700 dark:bg-slate-900">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950">
        <Ionicons name={icon} size={32} color="#14b8a6" />
      </View>
      <Text className="text-center text-lg font-semibold text-slate-900 dark:text-white">
        {title}
      </Text>
      <Text className="text-center text-sm text-slate-600 dark:text-slate-400">{description}</Text>
    </View>
  );
}
