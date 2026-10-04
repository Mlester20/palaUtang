import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadDashboard, type DashboardSnapshot } from '@/db/dashboard';
import { reconcileAllActiveLoans } from '@/db/payments';
import { todayYmd } from '@/lib/loan';
import { useFlagThresholds } from '@/store/flag-settings';

/**
 * Live Home dashboard data. Loads on screen focus, on pull-to-refresh, and when the app comes
 * back to the foreground (the lock gate unmounts the screens while locked, so after an unlock
 * the focus load runs). `today` is taken at each load, so midnight is followed.
 */
export function useDashboard() {
  const db = useSQLiteContext();
  const thresholds = useFlagThresholds();
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Ignore an older load that finishes after a newer one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    const today = todayYmd();
    try {
      await reconcileAllActiveLoans(db, today);
      const snapshot = await loadDashboard(db, today, thresholds);
      if (current === requestId.current) {
        setData(snapshot);
        setError(false);
      }
    } catch (e) {
      console.error('[Load dashboard failed]', e);
      if (current === requestId.current) setError(true);
    }
  }, [db, thresholds]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => subscription.remove();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, refreshing, refresh, thresholds };
}
