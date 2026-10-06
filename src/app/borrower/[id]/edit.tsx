import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { BorrowerForm } from '@/components/borrowers/BorrowerForm';
import { getMostUsedAreas } from '@/db/areas';
import { findBorrowersWithSameName, getBorrowerById, updateBorrower } from '@/db/borrowers';
import type { Borrower } from '@/types/borrower';

export default function EditBorrowerScreen() {
  const db = useSQLiteContext();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [borrower, setBorrower] = useState<Borrower | null | undefined>(undefined);
  const [areaSuggestions, setAreaSuggestions] = useState<string[]>([]);

  useEffect(() => {
    getBorrowerById(db, id)
      .then(setBorrower)
      .catch((error) => {
        console.error('[Load borrower failed]', error);
        setBorrower(null);
      });
    getMostUsedAreas(db)
      .then(setAreaSuggestions)
      .catch((error) => console.error('[Load areas failed]', error));
  }, [db, id]);

  if (borrower === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (borrower === null) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          This borrower could not be found.
        </Text>
      </View>
    );
  }

  return (
    <BorrowerForm
      submitLabel="Save changes"
      initialValues={borrower}
      areaSuggestions={areaSuggestions}
      countSameName={async (fullName) => (await findBorrowersWithSameName(db, fullName, id)).length}
      onSubmit={async (input) => {
        await updateBorrower(db, id, input);
        // Back to the details page, which reloads on focus.
        router.back();
        Alert.alert('Changes saved', `${input.fullName.trim()} was updated.`);
      }}
    />
  );
}
