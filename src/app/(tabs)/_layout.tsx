import { Tabs } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { useThemeColors } from '@/lib/theme';
import { refreshCollectionBadge, useCollectionBadge } from '@/store/collection-badge';

export default function TabsLayout() {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const toCollect = useCollectionBadge();

  // Badge = loans still to collect today. Refreshed on mount, on every tab focus (e.g. after
  // recording a payment elsewhere) and when the app returns to the foreground.
  useEffect(() => {
    refreshCollectionBadge(db);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshCollectionBadge(db);
    });
    return () => subscription.remove();
  }, [db]);

  return (
    <Tabs
      screenListeners={{ focus: () => refreshCollectionBadge(db) }}
      // Icons/badge/active-state are drawn by FloatingTabBar itself (reads route.name + each
      // screen's options.tabBarBadge below); tabBarIcon/tabBarStyle options are unused now.
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        // Home draws its own greeting header (dashboard), so the default one is hidden.
        options={{ title: 'Home', headerShown: false }}
      />
      <Tabs.Screen
        name="collection"
        options={{ title: 'Collection', tabBarBadge: toCollect > 0 ? toCollect : undefined }}
      />
      <Tabs.Screen name="borrowers" options={{ title: 'Borrowers' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
