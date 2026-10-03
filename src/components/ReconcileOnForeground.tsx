import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { reconcileAllActiveLoans } from '@/db/payments';
import { todayYmd } from '@/lib/loan';

function reconcile(db: ReturnType<typeof useSQLiteContext>) {
  reconcileAllActiveLoans(db, todayYmd()).catch((error) =>
    console.error('[Reconcile loans failed]', error),
  );
}

/**
 * Brings every active loan up to date (new balda days, make-ups) when the app content mounts
 * — i.e. after the lock gate lets the user in — and whenever the app returns to the foreground.
 * Renders nothing. Reconcile is idempotent, so extra runs are harmless.
 */
export function ReconcileOnForeground() {
  const db = useSQLiteContext();

  useEffect(() => {
    reconcile(db);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile(db);
    });
    return () => subscription.remove();
  }, [db]);

  return null;
}
