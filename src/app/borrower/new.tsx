import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { BorrowerForm } from '@/components/borrowers/BorrowerForm';
import { getMostUsedAreas } from '@/db/areas';
import { createBorrower, findBorrowersWithSameName } from '@/db/borrowers';

export default function NewBorrowerScreen() {
  const db = useSQLiteContext();
  const [areaSuggestions, setAreaSuggestions] = useState<string[]>([]);

  useEffect(() => {
    getMostUsedAreas(db)
      .then(setAreaSuggestions)
      .catch((error) => console.error('[Load areas failed]', error));
  }, [db]);

  return (
    <BorrowerForm
      submitLabel="Save"
      areaSuggestions={areaSuggestions}
      countSameName={async (fullName) => (await findBorrowersWithSameName(db, fullName)).length}
      onSubmit={async (input) => {
        const id = await createBorrower(db, input);
        // Replace the form with the new borrower's page, so Back goes to the list, not the form.
        router.replace({ pathname: '/borrower/[id]', params: { id: String(id) } });
        Alert.alert('Borrower added', `${input.fullName.trim()} was saved.`);
      }}
    />
  );
}
