import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert } from 'react-native';

import { BorrowerForm } from '@/components/borrowers/BorrowerForm';
import { createBorrower, findBorrowersWithSameName } from '@/db/borrowers';

export default function NewBorrowerScreen() {
  const db = useSQLiteContext();

  return (
    <BorrowerForm
      submitLabel="Save"
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
