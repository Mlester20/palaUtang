import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
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
import { getBorrowers } from '@/db/borrowers';
import { useThemeColors } from '@/lib/theme';
import type { Borrower } from '@/types/borrower';

const SEARCH_DEBOUNCE_MS = 250;

export default function BorrowersScreen() {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [borrowers, setBorrowers] = useState<Borrower[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  // Ignore results from an older request that finishes after a newer one.
  const requestId = useRef(0);

  // Wait until the user stops typing before querying.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const rows = await getBorrowers(db, { search, includeArchived });
      if (current === requestId.current) {
        setBorrowers(rows);
        setError(false);
      }
    } catch (error) {
      console.error('[Load borrowers failed]', error);
      if (current === requestId.current) setError(true);
    }
  }, [db, search, includeArchived]);

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
  const count = borrowers?.length ?? 0;
  const countLabel = `${count} ${count === 1 ? 'borrower' : 'borrowers'}${searching ? ' found' : ''}`;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlatList
        data={borrowers ?? []}
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
