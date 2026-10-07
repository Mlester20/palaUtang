import { router, useFocusEffect } from 'expo-router';
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

import { RowMenuSheet } from '@/components/route/RowMenuSheet';
import { ReorderRow } from '@/components/route/ReorderRow';
import { useUnsavedGuard } from '@/components/route/useUnsavedGuard';
import { EmptyState } from '@/components/empty-state';
import { getAreasForRoute, type RouteAreaSummary } from '@/db/route';
import { t } from '@/i18n';
import { compareByAreaOrder } from '@/lib/areas';
import { showError } from '@/lib/errors';
import { moveItem, moveToBottom, moveToPosition, moveToTop } from '@/lib/reorder';
import { getAreaOrder, setAreaOrder } from '@/store/area-order';

/** A route area row always has a real name — "No area" is shown separately, never in the draft. */
type NamedArea = RouteAreaSummary & { area: string };

export default function RouteOrderScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<NamedArea>>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<NamedArea[]>([]);
  const [noAreaCount, setNoAreaCount] = useState(0);
  const [initialKeys, setInitialKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAreasForRoute(db)
      .then((rows) => {
        const order = getAreaOrder();
        const named = rows.filter((r): r is NamedArea => r.area !== null);
        named.sort((a, b) => compareByAreaOrder(a, b, order));
        setDraft(named);
        setInitialKeys(named.map((r) => r.area));
        setNoAreaCount(rows.find((r) => r.area === null)?.activeBorrowerCount ?? 0);
        setError(false);
      })
      .catch((err) => {
        console.error('[Load route areas failed]', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [db]);

  useFocusEffect(load);

  const dirty = draft.map((r) => r.area).join('\u0001') !== initialKeys.join('\u0001');
  useUnsavedGuard(dirty && !saving);

  const applyMove = (next: NamedArea[], movedArea: string) => {
    setDraft(next);
    const index = next.findIndex((r) => r.area === movedArea);
    setHighlighted(movedArea);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    });
    AccessibilityInfo.announceForAccessibility(
      t('route.movedAnnouncement', { name: movedArea, position: index + 1, total: next.length }),
    );
    setTimeout(() => setHighlighted((h) => (h === movedArea ? null : h)), 1500);
  };

  const sortAtoZ = () => {
    setDraft((prev) => [...prev].sort((a, b) => a.area.localeCompare(b.area)));
  };

  const save = async () => {
    setSaving(true);
    try {
      setAreaOrder(draft.map((r) => r.area));
      setInitialKeys(draft.map((r) => r.area));
      router.back();
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

  const menuArea = draft.find((r) => r.area === menuFor) ?? null;
  const menuIndex = menuArea ? draft.findIndex((r) => r.area === menuArea.area) : -1;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlatList
        ref={listRef}
        data={draft}
        keyExtractor={(r) => r.area}
        contentContainerClassName="gap-2 px-5 pb-28 pt-4"
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={
          <View className="flex-row items-center justify-between pb-2">
            <Text className="flex-1 text-base text-slate-600 dark:text-slate-300">
              {error ? t('route.loadFailed') : ''}
            </Text>
            {draft.length > 1 && (
              <Pressable
                onPress={sortAtoZ}
                accessibilityRole="button"
                className="min-h-11 justify-center rounded-full border border-slate-300 px-4 active:opacity-70 dark:border-slate-700">
                <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                  {t('route.sortAtoZ')}
                </Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              icon="map-outline"
              title={t('route.emptyAreasTitle')}
              description={t('route.emptyAreasMessage')}
            />
          ) : null
        }
        ListFooterComponent={
          <View className="mt-2 flex-row items-center gap-3 rounded-2xl bg-white p-4 opacity-70 dark:bg-slate-900">
            <View className="flex-1 gap-0.5">
              <Text className="text-lg font-bold text-slate-900 dark:text-white">
                {t('route.noArea')}
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">
                {noAreaCount === 1
                  ? t('route.oneBorrower')
                  : t('route.borrowerCount', { count: noAreaCount })}
              </Text>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <ReorderRow
            position={index + 1}
            highlighted={highlighted === item.area}
            disabledUp={index === 0}
            disabledDown={index === draft.length - 1}
            onMoveUp={() => applyMove(moveItem(draft, index, -1), item.area)}
            onMoveDown={() => applyMove(moveItem(draft, index, 1), item.area)}
            onOpenMenu={() => setMenuFor(item.area)}
            moveUpLabel={t('route.moveUpLabel', { name: item.area, position: index + 1, total: draft.length })}
            moveDownLabel={t('route.moveDownLabel', { name: item.area, position: index + 1, total: draft.length })}>
            <Pressable
              onPress={() => router.push({ pathname: '/route-order/area', params: { area: item.area } })}
              accessibilityRole="button"
              accessibilityLabel={t('route.openArea', { area: item.area })}
              className="gap-0.5 active:opacity-70">
              <Text className="text-lg font-bold text-slate-900 dark:text-white" numberOfLines={1}>
                {item.area}
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">
                {item.activeBorrowerCount === 1
                  ? t('route.oneBorrower')
                  : t('route.borrowerCount', { count: item.activeBorrowerCount })}
              </Text>
            </Pressable>
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
        key={menuFor ?? '__closed__'}
        visible={menuArea !== null}
        onClose={() => setMenuFor(null)}
        max={draft.length}
        onTop={() => {
          if (!menuArea) return;
          applyMove(moveToTop(draft, menuIndex), menuArea.area);
          setMenuFor(null);
        }}
        onBottom={() => {
          if (!menuArea) return;
          applyMove(moveToBottom(draft, menuIndex), menuArea.area);
          setMenuFor(null);
        }}
        onToPosition={(position) => {
          if (!menuArea) return;
          applyMove(moveToPosition(draft, menuIndex, position), menuArea.area);
          setMenuFor(null);
        }}
      />
    </View>
  );
}
