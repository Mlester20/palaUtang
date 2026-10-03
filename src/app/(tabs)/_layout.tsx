import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, type ComponentProps } from 'react';
import { AppState, type ColorValue } from 'react-native';

import { useThemeColors } from '@/lib/theme';
import { refreshCollectionBadge, useCollectionBadge } from '@/store/collection-badge';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Filled icon when the tab is active, outline when it isn't. */
function tabIcon(name: IconName, outline: IconName) {
  return function TabIcon({
    focused,
    color,
    size,
  }: {
    focused: boolean;
    color: ColorValue;
    size: number;
  }) {
    return <Ionicons name={focused ? name : outline} color={color} size={size} />;
  };
}

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
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        // Home draws its own greeting header (dashboard), so the default one is hidden.
        options={{ title: 'Home', headerShown: false, tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          title: 'Collection',
          tabBarIcon: tabIcon('cash', 'cash-outline'),
          tabBarBadge: toCollect > 0 ? toCollect : undefined,
        }}
      />
      <Tabs.Screen
        name="borrowers"
        options={{ title: 'Borrowers', tabBarIcon: tabIcon('people', 'people-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('settings', 'settings-outline') }}
      />
    </Tabs>
  );
}
