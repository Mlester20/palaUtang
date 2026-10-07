import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { InitialsAvatar, StatusChip } from '@/components/dashboard';
import { useThemeColors } from '@/lib/theme';
import type { ChipTone } from '@/types/dashboard';

type BorrowerListItemProps = {
  fullName: string;
  nickname: string | null;
  phone: string | null;
  archived: boolean;
  /** Balda severity badge (Late / Flagged / Critical), if the borrower is behind. */
  badge?: { label: string; tone: ChipTone } | null;
  /** Reliability tier badge (New / Reliable / Fair / Risky) — shown for every borrower. */
  reliabilityBadge?: { label: string; tone: ChipTone } | null;
  area?: string | null;
  /** Shown only when the list is sorted by route (see Borrowers tab's area-filtered sort toggle). */
  routeNumber?: number | null;
  onPress: () => void;
};

export function BorrowerListItem({
  fullName,
  nickname,
  phone,
  area,
  routeNumber,
  archived,
  badge,
  reliabilityBadge,
  onPress,
}: BorrowerListItemProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${routeNumber ? `Stop ${routeNumber}, ` : ''}${fullName}${archived ? ', archived' : ''}${badge ? `, ${badge.label}` : ''}`}
      className="min-h-20 flex-row items-center gap-3 rounded-2xl bg-white px-4 py-3 active:opacity-70 dark:bg-slate-900">
      {routeNumber ? (
        <View className="h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Text className="text-base font-extrabold text-slate-700 dark:text-slate-200">
            {routeNumber}
          </Text>
        </View>
      ) : (
        <View className={archived ? 'opacity-50' : undefined}>
          <InitialsAvatar name={fullName} />
        </View>
      )}
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
        {area && (
          <Text className="text-xs text-slate-500 dark:text-slate-400" numberOfLines={1}>
            {area}
          </Text>
        )}
        {(badge || reliabilityBadge) && (
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {badge && <StatusChip label={badge.label} tone={badge.tone} size="sm" />}
            {reliabilityBadge && (
              <StatusChip label={reliabilityBadge.label} tone={reliabilityBadge.tone} size="sm" />
            )}
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
    </Pressable>
  );
}
