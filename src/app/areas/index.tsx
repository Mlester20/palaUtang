import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { router, useFocusEffect, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { EmptyState } from '@/components/empty-state';
import { AreaError, getAreas, removeArea, renameArea, type AreaSummary } from '@/db/areas';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import { useThemeColors } from '@/lib/theme';
import { removeFromAreaOrder, renameInAreaOrder } from '@/store/area-order';

export default function AreasScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const [areas, setAreas] = useState<AreaSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [renaming, setRenaming] = useState<AreaSummary | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getAreas(db)
      .then((rows) => {
        setAreas(rows);
        setError(false);
      })
      .catch((err) => {
        console.error('[Load areas failed]', err);
        setError(true);
      });
  }, [db]);

  useFocusEffect(load);

  const openRename = (area: AreaSummary) => {
    setRenaming(area);
    setNewName(area.area);
  };
  const closeRename = () => {
    if (saving) return;
    setRenaming(null);
    setNewName('');
  };

  const confirmRename = () => {
    if (!renaming) return;
    const trimmed = newName.trim();
    if (trimmed === '') return;
    const merging =
      trimmed.toLowerCase() !== renaming.area.toLowerCase() &&
      areas?.some((a) => a.area.toLowerCase() === trimmed.toLowerCase());
    const doRename = async () => {
      setSaving(true);
      try {
        await renameArea(db, renaming.area, trimmed);
        if (merging) removeFromAreaOrder(renaming.area);
        else renameInAreaOrder(renaming.area, trimmed);
        closeRename();
        load();
      } catch (err) {
        if (err instanceof AreaError) {
          Alert.alert(t('areas.renameFailed'), t('areas.errTooLong', { max: 40 }));
        } else {
          showError(t('areas.renameFailed'), err);
        }
      } finally {
        setSaving(false);
      }
    };
    if (merging) {
      Alert.alert(t('areas.mergeTitle'), t('areas.mergeMessage', { from: renaming.area, to: trimmed }), [
        { text: t('areas.cancel'), style: 'cancel' },
        { text: t('areas.merge'), onPress: doRename },
      ]);
      return;
    }
    doRename();
  };

  const confirmRemove = (area: AreaSummary) => {
    Alert.alert(
      t('areas.removeTitle'),
      t('areas.removeMessage', { name: area.area, count: area.borrowerCount }),
      [
        { text: t('areas.cancel'), style: 'cancel' },
        {
          text: t('areas.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeArea(db, area.area);
              removeFromAreaOrder(area.area);
              load();
            } catch (err) {
              showError(t('areas.removeFailed'), err);
            }
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlatList
        data={areas ?? []}
        keyExtractor={(a) => a.area}
        contentContainerClassName="gap-3 px-5 pb-10 pt-4"
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {t('areas.introHint')}
            </Text>
            <Pressable
              // '/route-order' is the collapsed path for src/app/route-order/index.tsx — same
              // pattern as the working '/cash' (Stack.Screen name="cash/index"). The cast is
              // only because typed routes haven't regenerated for this brand-new screen yet
              // (regenerates automatically next time the dev server runs); never push the
              // literal '/route-order/index' form — that's what produced "Unmatched Route".
              onPress={() => router.push('/route-order' as Href)}
              accessibilityRole="button"
              className="flex-row items-center gap-3 rounded-2xl bg-white p-4 active:opacity-70 dark:bg-slate-900">
              <Ionicons name="reorder-four-outline" size={22} color={colors.primary} />
              <View className="flex-1 gap-0.5">
                <Text className="text-base font-semibold text-slate-900 dark:text-white">
                  {t('areas.setRouteOrder')}
                </Text>
                <Text className="text-sm text-slate-600 dark:text-slate-400">
                  {t('areas.setRouteOrderHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          areas === null ? (
            <ActivityIndicator size="large" className="mt-10" />
          ) : error ? (
            <Text className="py-6 text-center text-base text-red-700 dark:text-red-300">
              {t('areas.loadFailed')}
            </Text>
          ) : (
            <EmptyState
              icon="map-outline"
              title={t('areas.emptyTitle')}
              description={t('areas.emptyMessage')}
            />
          )
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <View className="flex-1 gap-0.5">
              <Text className="text-lg font-bold text-slate-900 dark:text-white" numberOfLines={1}>
                {item.area}
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">
                {item.borrowerCount === 1
                  ? t('areas.oneBorrower')
                  : t('areas.borrowerCount', { count: item.borrowerCount })}
              </Text>
            </View>
            <Pressable
              onPress={() => openRename(item)}
              accessibilityRole="button"
              hitSlop={8}
              className="min-h-11 min-w-11 items-center justify-center active:opacity-60">
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => confirmRemove(item)}
              accessibilityRole="button"
              hitSlop={8}
              className="min-h-11 min-w-11 items-center justify-center active:opacity-60">
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </Pressable>
          </View>
        )}
      />

      <BottomSheet visible={renaming !== null} onClose={closeRename} locked={saving}>
        <Text className="text-xl font-bold text-slate-900 dark:text-white">
          {t('areas.renameTitle', { name: renaming?.area ?? '' })}
        </Text>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          autoCapitalize="words"
          placeholder={t('areas.renamePlaceholder')}
          placeholderTextColor={colors.textMuted}
          className="min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-lg text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        <View className="flex-row gap-3 pt-2">
          <Pressable
            onPress={closeRename}
            disabled={saving}
            accessibilityRole="button"
            className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
            <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
              {t('areas.cancel')}
            </Text>
          </Pressable>
          <Pressable
            onPress={confirmRename}
            disabled={saving || newName.trim() === ''}
            accessibilityRole="button"
            className={
              saving || newName.trim() === ''
                ? 'min-h-14 flex-1 items-center justify-center rounded-2xl bg-teal-700 opacity-60 dark:bg-teal-500'
                : 'min-h-14 flex-1 items-center justify-center rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
            }>
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-lg font-bold text-white">{t('areas.save')}</Text>
            )}
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}
