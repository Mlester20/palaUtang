import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { ReorderRow } from '@/components/route/ReorderRow';
import { RowMenuSheet } from '@/components/route/RowMenuSheet';
import { useUnsavedGuard } from '@/components/route/useUnsavedGuard';
import { getRouteBorrowers, saveAreaRoute, type RouteBorrower } from '@/db/route';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import { todayYmd } from '@/lib/loan';
import { moveItem, moveToBottom, moveToPosition, moveToTop, reverseList } from '@/lib/reorder';
import { useThemeColors } from '@/lib/theme';

export default function RouteAreaScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { area } = useLocalSearchParams<{ area: string }>();
  const listRef = useRef<FlatList<RouteBorrower>>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<RouteBorrower[]>([]);
  const [initialKeys, setInitialKeys] = useState('');
  const [saving, setSaving] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!area) return;
    setLoading(true);
    getRouteBorrowers(db, area, todayYmd())
      .then((rows) => {
        setDraft(rows);
        setInitialKeys(rows.map((b) => b.id).join(','));
        setError(false);
      })
      .catch((err) => {
        console.error('[Load route borrowers failed]', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [db, area]);

  useFocusEffect(load);

  const dirty = draft.map((b) => b.id).join(',') !== initialKeys;
  useUnsavedGuard(dirty && !saving);

  const applyMove = (next: RouteBorrower[], movedId: number, name: string) => {
    setDraft(next);
    const index = next.findIndex((b) => b.id === movedId);
    setHighlighted(movedId);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    });
    AccessibilityInfo.announceForAccessibility(
      t('route.movedAnnouncement', { name, position: index + 1, total: next.length }),
    );
    setTimeout(() => setHighlighted((h) => (h === movedId ? null : h)), 1500);
  };

  const sortAtoZ = () => setDraft((prev) => [...prev].sort((a, b) => a.fullName.localeCompare(b.fullName)));
  const sortMostOverdueFirst = () =>
    setDraft((prev) => [...prev].sort((a, b) => Number(b.hasOverdueBalance) - Number(a.hasOverdueBalance)));
  const sortReverse = () => setDraft((prev) => reverseList(prev));

  const save = async () => {
    if (!area) return;
    setSaving(true);
    try {
      await saveAreaRoute(db, area, draft.map((b) => b.id));
      setInitialKeys(draft.map((b) => b.id).join(','));
    } finally {
      setSaving(false);
    }
  };

  if (loading && draft.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const menuBorrower = draft.find((b) => b.id === menuFor) ?? null;
  const menuIndex = menuBorrower ? draft.findIndex((b) => b.id === menuBorrower.id) : -1;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <Stack.Screen options={{ title: t('route.areaScreenTitle', { area: area ?? '' }) }} />
      <FlatList
        ref={listRef}
        data={draft}
        keyExtractor={(b) => String(b.id)}
        contentContainerClassName="gap-2 px-5 pb-28 pt-4"
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={
          <View className="gap-2 pb-2">
            {error && (
              <Text className="text-base text-red-700 dark:text-red-300">{t('route.loadFailed')}</Text>
            )}
            {draft.length > 1 && (
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  onPress={sortAtoZ}
                  accessibilityRole="button"
                  className="min-h-11 justify-center rounded-full border border-slate-300 px-4 active:opacity-70 dark:border-slate-700">
                  <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                    {t('route.sortAtoZ')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={sortMostOverdueFirst}
                  accessibilityRole="button"
                  className="min-h-11 justify-center rounded-full border border-slate-300 px-4 active:opacity-70 dark:border-slate-700">
                  <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                    {t('route.mostOverdueFirst')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={sortReverse}
                  accessibilityRole="button"
                  className="min-h-11 justify-center rounded-full border border-slate-300 px-4 active:opacity-70 dark:border-slate-700">
                  <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                    {t('route.reverse')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              icon="people-outline"
              title={t('route.emptyBorrowersTitle')}
              description={t('route.emptyBorrowersMessage')}
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <ReorderRow
            position={index + 1}
            highlighted={highlighted === item.id}
            disabledUp={index === 0}
            disabledDown={index === draft.length - 1}
            onMoveUp={() => applyMove(moveItem(draft, index, -1), item.id, item.fullName)}
            onMoveDown={() => applyMove(moveItem(draft, index, 1), item.id, item.fullName)}
            onOpenMenu={() => setMenuFor(item.id)}
            moveUpLabel={t('route.moveUpLabel', {
              name: item.fullName,
              position: index + 1,
              total: draft.length,
            })}
            moveDownLabel={t('route.moveDownLabel', {
              name: item.fullName,
              position: index + 1,
              total: draft.length,
            })}>
            <View className="gap-0.5">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-lg font-bold text-slate-900 dark:text-white" numberOfLines={1}>
                  {item.fullName}
                </Text>
                {item.nickname && (
                  <Text className="text-sm text-slate-500 dark:text-slate-400" numberOfLines={1}>
                    “{item.nickname}”
                  </Text>
                )}
              </View>
              {item.address && (
                <Text className="text-sm text-slate-600 dark:text-slate-400" numberOfLines={1}>
                  {item.address}
                </Text>
              )}
              {item.hasOverdueBalance && (
                <View className="flex-row items-center gap-1 pt-0.5">
                  <Ionicons name="alert-circle" size={14} color={colors.danger} />
                  <Text className="text-xs font-semibold text-red-600 dark:text-red-400">
                    {t('route.overdueMarker')}
                  </Text>
                </View>
              )}
            </View>
          </ReorderRow>
        )}
      />

      {dirty && (
        <View
          className="absolute inset-x-0 bottom-0 flex-row gap-3 border-t border-slate-200 bg-white px-5 pt-3 dark:border-slate-800 dark:bg-slate-900"
          style={{ paddingBottom: insets.bottom + 12 }}>
          <Pressable
            onPress={load}
            disabled={saving}
            accessibilityRole="button"
            className="min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 active:opacity-70 dark:border-slate-700">
            <Text className="text-lg font-semibold text-slate-700 dark:text-slate-200">
              {t('route.cancel')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              save().catch((err) => {
                showError(t('route.saveFailed'), err);
              })
            }
            disabled={saving}
            accessibilityRole="button"
            className={
              saving
                ? 'min-h-14 flex-1 items-center justify-center rounded-2xl bg-teal-700 opacity-60 dark:bg-teal-500'
                : 'min-h-14 flex-1 items-center justify-center rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
            }>
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-lg font-bold text-white">{t('route.save')}</Text>
            )}
          </Pressable>
        </View>
      )}

      <RowMenuSheet
        key={menuFor ?? -1}
        visible={menuBorrower !== null}
        onClose={() => setMenuFor(null)}
        max={draft.length}
        onTop={() => {
          if (!menuBorrower) return;
          applyMove(moveToTop(draft, menuIndex), menuBorrower.id, menuBorrower.fullName);
          setMenuFor(null);
        }}
        onBottom={() => {
          if (!menuBorrower) return;
          applyMove(moveToBottom(draft, menuIndex), menuBorrower.id, menuBorrower.fullName);
          setMenuFor(null);
        }}
        onToPosition={(position) => {
          if (!menuBorrower) return;
          applyMove(moveToPosition(draft, menuIndex, position), menuBorrower.id, menuBorrower.fullName);
          setMenuFor(null);
        }}
      />
    </View>
  );
}
