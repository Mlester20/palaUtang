import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { InitialsAvatar } from '@/components/dashboard';
import { useThemeColors } from '@/lib/theme';

type BorrowerListItemProps = {
  fullName: string;
  nickname: string | null;
  phone: string | null;
  archived: boolean;
  onPress: () => void;
};

export function BorrowerListItem({
  fullName,
  nickname,
  phone,
  archived,
  onPress,
}: BorrowerListItemProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fullName}${archived ? ', archived' : ''}`}
      className="min-h-20 flex-row items-center gap-3 rounded-2xl bg-white px-4 py-3 active:opacity-70 dark:bg-slate-900">
      <View className={archived ? 'opacity-50' : undefined}>
        <InitialsAvatar name={fullName} />
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-shrink text-lg font-semibold text-slate-900 dark:text-white"
            numberOfLines={1}>
            {fullName}
          </Text>
          {archived && (
            <View className="rounded-full bg-slate-200 px-2 py-0.5 dark:bg-slate-700">
              <Text className="text-xs font-bold text-slate-700 dark:text-slate-200">Archived</Text>
            </View>
          )}
        </View>
        {nickname && (
          <Text className="text-sm text-slate-600 dark:text-slate-300" numberOfLines={1}>
            “{nickname}”
          </Text>
        )}
        {phone && (
          <Text className="text-sm text-slate-500 dark:text-slate-400" numberOfLines={1}>
            {phone}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
    </Pressable>
  );
}
