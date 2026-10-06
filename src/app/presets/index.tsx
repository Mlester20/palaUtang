import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { deletePreset, getPresets } from '@/db/presets';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import { presetSummaryText, type LoanPreset } from '@/lib/presets';
import { useThemeColors } from '@/lib/theme';

export default function PresetsScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const [presets, setPresets] = useState<LoanPreset[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getPresets(db)
      .then((rows) => {
        setPresets(rows);
        setError(false);
      })
      .catch((err) => {
        console.error('[Load presets failed]', err);
        setError(true);
      });
  }, [db]);

  useFocusEffect(load);

  const confirmDelete = (preset: LoanPreset) => {
    Alert.alert(
      t('presets.deleteTitle'),
      t('presets.deleteMessage', { name: preset.name }),
      [
        { text: t('presets.cancel'), style: 'cancel' },
        {
          text: t('presets.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePreset(db, preset.id);
              load();
            } catch (err) {
              showError(t('presets.deleteFailed'), err);
            }
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlatList
        data={presets ?? []}
        keyExtractor={(p) => String(p.id)}
        contentContainerClassName="gap-3 px-5 pb-28 pt-4"
        ListHeaderComponent={
          <Text className="pb-1 text-base text-slate-600 dark:text-slate-300">
            {t('presets.introHint')}
          </Text>
        }
        ListEmptyComponent={
          presets === null ? (
            <ActivityIndicator size="large" className="mt-10" />
          ) : error ? (
            <Text className="py-6 text-center text-base text-red-700 dark:text-red-300">
              {t('presets.loadFailed')}
            </Text>
          ) : (
            <EmptyState
              icon="bookmark-outline"
              title={t('presets.emptyTitle')}
              description={t('presets.emptyMessage')}
            />
          )
        }
        renderItem={({ item }) => (
          <View className="gap-2 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-white">
                {item.name}
              </Text>
            </View>
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {/* presetSummaryText only ever calls keys under 'presets.*', all present in en.ts. */}
              {presetSummaryText(item, t as (key: string, params?: Record<string, string | number>) => string)}
            </Text>
            <View className="flex-row gap-3 pt-1">
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/presets/[id]/edit', params: { id: String(item.id) } })
                }
                accessibilityRole="button"
                className="min-h-11 flex-row items-center gap-1.5 active:opacity-60">
                <Ionicons name="create-outline" size={18} color={colors.primary} />
                <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
                  {t('presets.edit')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => confirmDelete(item)}
                accessibilityRole="button"
                className="min-h-11 flex-row items-center gap-1.5 active:opacity-60">
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text className="text-base font-semibold text-red-600 dark:text-red-400">
                  {t('presets.delete')}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />
      <Pressable
        onPress={() => router.push('/presets/new')}
        accessibilityRole="button"
        accessibilityLabel={t('presets.addPreset')}
        className="absolute bottom-6 right-5 h-16 w-16 items-center justify-center rounded-full bg-teal-700 shadow-lg active:bg-teal-800 dark:bg-teal-500">
        <Ionicons name="add" size={34} color="#ffffff" />
      </Pressable>
    </View>
  );
}
