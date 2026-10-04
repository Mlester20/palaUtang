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

import { BorrowerListItem } from '@/components/borrowers/BorrowerListItem';
import { EmptyState } from '@/components/empty-state';
import { flagChipLabel } from '@/components/flags/flag-text';
import { getBorrowers } from '@/db/borrowers';
import { getFlaggedBorrowers } from '@/db/flags';
import { t } from '@/i18n';
import { isFlagged, type BorrowerFlag } from '@/lib/flags';
import { todayYmd } from '@/lib/loan';
import { useThemeColors } from '@/lib/theme';
import { useFlagThresholds } from '@/store/flag-settings';
import type { Borrower } from '@/types/borrower';

type ListFilter = 'all' | 'flagged';

const SEARCH_DEBOUNCE_MS = 250;

export default function BorrowersScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const thresholds = useFlagThresholds();
  // Home / Reports open this tab with ?filter=flagged.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<ListFilter>(() =>
    filterParam === 'flagged' ? 'flagged' : 'all',
  );
  const [flags, setFlags] = useState<Map<number, BorrowerFlag>>(new Map());
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
      const [rows, behind] = await Promise.all([
        getBorrowers(db, { search, includeArchived }),
        getFlaggedBorrowers(db, todayYmd(), { thresholds, minSeverity: 'late' }),
      ]);
      if (current === requestId.current) {
        setBorrowers(rows);
        setFlags(new Map(behind.map((f) => [f.borrowerId, f])));
        setError(false);
      }
    } catch (error) {
      console.error('[Load borrowers failed]', error);
      if (current === requestId.current) setError(true);
    }
  }, [db, search, includeArchived, thresholds]);

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
        : borrowers;
  const count = visible?.length ?? 0;
  const countLabel = `${count} ${count === 1 ? 'borrower' : 'borrowers'}${searching ? ' found' : ''}`;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlatList
        data={visible ?? []}
        keyExtractor={(b) => String(b.id)}
        keyboardShouldPersistTaps="handled"
        // pb-28 leaves room so the last row isn't hidden behind the + button.
        contentContainerClassName="gap-3 px-5 pb-28 pt-4"
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
                placeholderTextColor="#94a3b8"
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
            <View className="flex-row gap-2" accessibilityRole="radiogroup">
              {(['all', 'flagged'] as const).map((value) => {
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
                    {value === 'flagged' && (
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
                      {value === 'all' ? t('flags.filterAll') : t('flags.filterFlagged')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

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
                  trackColor={{ true: colors.primary, false: '#cbd5e1' }}
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
            archived={item.archivedAt !== null}
            badge={badgeFor(flags.get(item.id))}
            onPress={() =>
              router.push({ pathname: '/borrower/[id]', params: { id: String(item.id) } })
            }
          />
        )}
      />

      {/* Add borrower */}
      <Pressable
        onPress={() => router.push('/borrower/new')}
        accessibilityRole="button"
        accessibilityLabel="Add borrower"
        className="absolute bottom-6 right-5 h-16 w-16 items-center justify-center rounded-full bg-teal-700 shadow-lg active:bg-teal-800 dark:bg-teal-500">
        <Ionicons name="add" size={34} color="#ffffff" />
      </Pressable>
    </View>
  );
}

function badgeFor(flag: BorrowerFlag | undefined) {
  if (!flag || flag.severity === 'none') return null;
  return { label: flagChipLabel(flag), tone: flag.severity };
}
