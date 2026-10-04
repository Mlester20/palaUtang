import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

/** Shown instead of ANY cash number until cash tracking is set up. */
export function CashSetupCard({ compact = false }: { compact?: boolean }) {
  const colors = useThemeColors();
  return (
    <View className="gap-3 rounded-2xl border border-dashed border-teal-300 bg-white p-4 dark:border-teal-800 dark:bg-slate-900">
      <View className="flex-row items-center gap-3">
        <Ionicons name="wallet-outline" size={26} color={colors.primary} />
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-bold text-slate-900 dark:text-white">
            {t('cash.setupCardTitle')}
          </Text>
          {!compact && (
            <Text className="text-sm text-slate-600 dark:text-slate-300">
              {t('cash.setupCardMessage')}
            </Text>
          )}
        </View>
      </View>
      <Pressable
        onPress={() => router.push('/cash/setup')}
        accessibilityRole="button"
        className="min-h-12 items-center justify-center rounded-xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
        <Text className="text-base font-bold text-white">{t('cash.setupButton')}</Text>
      </Pressable>
    </View>
  );
}
