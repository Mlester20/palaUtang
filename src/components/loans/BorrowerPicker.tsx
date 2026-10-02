import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { BorrowerListItem } from '@/components/borrowers/BorrowerListItem';
import { EmptyState } from '@/components/empty-state';
import { useThemeColors } from '@/lib/theme';
import type { Borrower } from '@/types/borrower';

type BorrowerPickerProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** null while loading. */
  borrowers: Borrower[] | null;
  onSelect: (borrower: Borrower) => void;
  onAddBorrower: () => void;
};

/** Searchable list for choosing who the loan is for (step 1 of New Loan when opened from Home). */
export function BorrowerPicker({
  query,
  onQueryChange,
  borrowers,
  onSelect,
  onAddBorrower,
}: BorrowerPickerProps) {
  const colors = useThemeColors();

  return (
    <FlatList
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerClassName="gap-3 px-5 pb-10 pt-4"
      data={borrowers ?? []}
      keyExtractor={(b) => String(b.id)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View className="gap-3 pb-1">
          <Text className="text-xl font-bold text-slate-900 dark:text-white">
            Who is this loan for?
          </Text>
          <View className="min-h-14 flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
            <Ionicons name="search" size={20} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder="Search name, nickname, or phone"
              placeholderTextColor="#94a3b8"
              autoCorrect={false}
              autoFocus
              className="flex-1 py-3 text-lg text-slate-900 dark:text-white"
            />
          </View>
        </View>
      }
      ListEmptyComponent={
        borrowers === null ? (
          <ActivityIndicator size="large" className="mt-10" />
        ) : (
          <View className="gap-4">
            <EmptyState
              icon="people-outline"
              title={query.trim() ? 'No matching borrower' : 'No borrowers yet'}
              description="Add the borrower first, then create their loan."
            />
            <Pressable
              onPress={onAddBorrower}
              accessibilityRole="button"
              className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
              <Ionicons name="person-add" size={22} color="#ffffff" />
              <Text className="text-lg font-bold text-white">New Borrower</Text>
            </Pressable>
          </View>
        )
      }
      renderItem={({ item }) => (
        <BorrowerListItem
          fullName={item.fullName}
          nickname={item.nickname}
          phone={item.phone}
          archived={false}
          onPress={() => onSelect(item)}
        />
      )}
    />
  );
}
