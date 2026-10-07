import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getAreas, type AreaSummary } from '@/db/areas';
import { BorrowerListItem } from '@/components/borrowers/BorrowerListItem';
import { EmptyState } from '@/components/empty-state';
import { useTabBarInset } from '@/components/navigation/FloatingTabBar';
import { flagChipLabel } from '@/components/flags/flag-text';
import { tierBadge } from '@/components/reliability/reliability-text';
import { getBorrowers } from '@/db/borrowers';
import { getFlaggedBorrowers } from '@/db/flags';
import { getReliabilityRatings } from '@/db/reliability';
import { t } from '@/i18n';
import { isFlagged, type BorrowerFlag } from '@/lib/flags';
import { todayYmd } from '@/lib/loan';
import type { ReliabilityResult } from '@/lib/reliability';
import { useThemeColors } from '@/lib/theme';
import { useFlagThresholds } from '@/store/flag-settings';
import type { Borrower } from '@/types/borrower';

type ListFilter = 'all' | 'flagged' | 'risky';

const SEARCH_DEBOUNCE_MS = 250;

export default function BorrowersScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const thresholds = useFlagThresholds();
  const tabBarInset = useTabBarInset();
  // Home / Reports open this tab with ?filter=flagged.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<ListFilter>(() =>
    filterParam === 'flagged' ? 'flagged' : 'all',
  );
  const [flags, setFlags] = useState<Map<number, BorrowerFlag>>(new Map());
  const [reliability, setReliability] = useState<Map<number, ReliabilityResult>>(new Map());
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [areaFilter, setAreaFilter] = useState<string | null>(null); // null = All areas
  // Only meaningful with an area filter active; the full list (no filter) is always A-Z.
  const [areaSort, setAreaSort] = useState<'route' | 'name'>('route');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [borrowers, setBorrowers] = useState<Borrower[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  // Ignore results from an older request that finishes after a newer one.
  const requestId = useRef(0);

  // Apply a new ?filter=flagged once (during render, React's "adjust state on prop change"
  // pattern), then clear the param so the next plain visit to the tab isn't stuck on it.
  const [seenParam, setSeenParam] = useState(filterParam);
  if (filterParam !== seenParam) {
    setSeenParam(filterParam);
    if (filterParam === 'flagged') setFilter('flagged');
  }
  useEffect(() => {
    if (filterParam) router.setParams({ filter: undefined });
  }, [filterParam]);

  // Wait until the user stops typing before querying.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const today = todayYmd();
      const [rows, behind, areaRows] = await Promise.all([
        getBorrowers(db, {
          search,
          includeArchived,
          area: areaFilter === null ? undefined : areaFilter,
          sort: areaFilter !== null && areaSort === 'route' ? 'route' : 'name',
        }),
        getFlaggedBorrowers(db, today, { thresholds, minSeverity: 'late' }),
        getAreas(db),
      ]);
      // Ratings for exactly the rows on screen — a fixed small number of queries, not one each.
      const ratings = await getReliabilityRatings(
        db,
        rows.map((b) => b.id),
        today,
        thresholds,
      );
      if (current === requestId.current) {
        setBorrowers(rows);
        setFlags(new Map(behind.map((f) => [f.borrowerId, f])));
        setReliability(ratings);
        setAreas(areaRows);
        setError(false);
      }
    } catch (error) {
      console.error('[Load borrowers failed]', error);
      if (current === requestId.current) setError(true);
    }
  }, [db, search, includeArchived, areaFilter, areaSort, thresholds]);

  // Reloads when the tab is focused (e.g. after adding/editing) and when search/filter change.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const searching = search.trim() !== '';
  // Flagged view: Flagged + Critical only, worst first (same order as Needs attention).
  // Risky view: tier 'risky' only, worst on-time rate first.
  const visible =
    borrowers === null
      ? null
      : filter === 'flagged'
        ? borrowers
            .filter((b) => {
              const flag = flags.get(b.id);
              return flag !== undefined && isFlagged(flag.severity);
            })
            .sort((a, b) => {
              const fa = flags.get(a.id)!;
              const fb = flags.get(b.id)!;
              return fb.daysBehind - fa.daysBehind || fb.totalOverdue - fa.totalOverdue;
            })
        : filter === 'risky'
          ? borrowers
              .filter((b) => reliability.get(b.id)?.tier === 'risky')
              .sort(
                (a, b) =>
                  (reliability.get(a.id)?.onTimeRate ?? 1) - (reliability.get(b.id)?.onTimeRate ?? 1),
              )
          : borrowers;
  const count = visible?.length ?? 0;
  const countLabel = `${count} ${count === 1 ? 'borrower' : 'borrowers'}${searching ? ' found' : ''}`;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlatList
        data={visible ?? []}
        keyExtractor={(b) => String(b.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: tabBarInset }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            {/* Search */}
            <View className="min-h-14 flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
              <Ionicons name="search" size={20} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search name, nickname, or phone"
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                autoCorrect={false}
                className="flex-1 py-3 text-lg text-slate-900 dark:text-white"
              />
              {query !== '' && (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {/* Filter chips */}
            <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
              {(['all', 'flagged', 'risky'] as const).map((value) => {
                const selected = filter === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setFilter(value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    className={
                      selected
                        ? 'min-h-11 flex-row items-center gap-1.5 rounded-full bg-teal-700 px-4 dark:bg-teal-500'
                        : 'min-h-11 flex-row items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
                    }>
                    {(value === 'flagged' || value === 'risky') && (
                      <Ionicons
                        name="alert-circle"
                        size={18}
                        color={selected ? '#ffffff' : colors.warning}
                      />
                    )}
                    <Text
                      className={
                        selected
                          ? 'text-base font-bold text-white'
                          : 'text-base font-semibold text-slate-700 dark:text-slate-200'
                      }>
                      {value === 'all'
                        ? t('flags.filterAll')
                        : value === 'flagged'
                          ? t('flags.filterFlagged')
                          : t('reliability.filterRisky')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Area chips */}
            {areas.length > 0 && (
              <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                {[null, ...areas.map((a) => a.area)].map((value) => {
                  const selected = areaFilter === value;
                  const label = value === null ? t('areas.filterAll') : value;
                  return (
                    <Pressable
                      key={value ?? '__all__'}
                      onPress={() => setAreaFilter(value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className={
                        selected
                          ? 'min-h-10 justify-center rounded-full bg-teal-700 px-3 dark:bg-teal-500'
                          : 'min-h-10 justify-center rounded-full border border-slate-300 bg-white px-3 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
                      }>
                      <Text
                        className={
                          selected
                            ? 'text-sm font-bold text-white'
                            : 'text-sm font-semibold text-slate-700 dark:text-slate-200'
                        }
                        numberOfLines={1}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Route order | A-Z — only meaningful with an area filter active */}
            {areaFilter !== null && (
              <View className="flex-row flex-wrap items-center gap-2" accessibilityRole="radiogroup">
                {(['route', 'name'] as const).map((value) => {
                  const selected = areaSort === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setAreaSort(value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className={
                        selected
                          ? 'min-h-10 justify-center rounded-full bg-slate-700 px-3 dark:bg-slate-200'
                          : 'min-h-10 justify-center rounded-full border border-slate-300 bg-white px-3 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
                      }>
                      <Text
                        className={
                          selected
                            ? 'text-sm font-bold text-white dark:text-slate-900'
                            : 'text-sm font-semibold text-slate-700 dark:text-slate-200'
                        }>
                        {value === 'route' ? t('borrowers.sortRoute') : t('borrowers.sortAtoZ')}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => router.push({ pathname: '/route-order/area', params: { area: areaFilter } })}
                  accessibilityRole="button"
                  className="min-h-10 flex-row items-center gap-1 rounded-full border border-slate-300 px-3 active:opacity-70 dark:border-slate-700">
                  <Ionicons name="reorder-four-outline" size={16} color={colors.primary} />
                  <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('borrowers.reorderAction')}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Count + archived toggle */}
            <View className="min-h-12 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                {borrowers ? countLabel : ' '}
              </Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-sm text-slate-600 dark:text-slate-300">Show archived</Text>
                <Switch
                  value={includeArchived}
                  onValueChange={setIncludeArchived}
                  trackColor={{ true: colors.primary, false: colors.switchTrackOff }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>

            {error && (
              <View className="rounded-xl bg-red-50 p-4 dark:bg-red-950">
                <Text className="text-base text-red-700 dark:text-red-300">
                  Could not load borrowers. Pull down to try again.
                </Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          borrowers === null ? (
            <ActivityIndicator size="large" className="mt-10" />
          ) : filter === 'flagged' ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title={t('flags.noFlaggedTitle')}
              description={t('flags.noFlaggedMessage', { days: thresholds.flagAfter })}
            />
          ) : filter === 'risky' ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title={t('reliability.noRiskyTitle')}
              description={t('reliability.noRiskyMessage')}
            />
          ) : searching ? (
            <EmptyState
              icon="search-outline"
              title="No results"
              description={`No borrower matches "${search.trim()}". Try a different name, nickname, or phone number.`}
            />
          ) : (
            <EmptyState
              icon="people-outline"
              title="No borrowers yet"
              description="Tap the + button to add your first borrower."
            />
          )
        }
        renderItem={({ item }) => (
          <BorrowerListItem
            fullName={item.fullName}
            nickname={item.nickname}
            phone={item.phone}
            area={item.area}
            routeNumber={
              areaFilter !== null && areaSort === 'route' ? item.routePosition : null
            }
            archived={item.archivedAt !== null}
            badge={badgeFor(flags.get(item.id))}
            reliabilityBadge={
              reliability.has(item.id) ? tierBadge(reliability.get(item.id)!) : null
            }
            onPress={() =>
              router.push({ pathname: '/borrower/[id]', params: { id: String(item.id) } })
            }
          />
        )}
      />

      {/* Add borrower — sits above the floating tab bar (bar inset + 16dp breathing room). */}
      <Pressable
        onPress={() => router.push('/borrower/new')}
        accessibilityRole="button"
        accessibilityLabel="Add borrower"
        style={{ bottom: tabBarInset + 16 }}
        className="absolute right-5 h-16 w-16 items-center justify-center rounded-full bg-teal-700 shadow-lg active:bg-teal-800 dark:bg-teal-500">
        <Ionicons name="add" size={34} color="#ffffff" />
      </Pressable>
    </View>
  );
}

function badgeFor(flag: BorrowerFlag | undefined) {
  if (!flag || flag.severity === 'none') return null;
  return { label: flagChipLabel(flag), tone: flag.severity };
}
