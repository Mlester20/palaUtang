import '@/global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppLockGate } from '@/components/AppLockGate';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/db/migrations';
import { useThemeColors } from '@/lib/theme';
import { useAppState } from '@/store/app-state';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = useThemeColors();
  const { hasCompletedOnboarding, profile } = useAppState();
  const showOnboarding = !hasCompletedOnboarding;
  const hasProfile = profile !== null;

  // Only one group is reachable at a time. Any blocked route (including the initial "/")
  // redirects to the first available screen, so this decides the launch flow:
  // lock gate -> onboarding (first run only) -> setup (first run only) -> (tabs) and screens above.
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* The lock comes first: while locked, nothing below (not even the database) is rendered. */}
      <AppLockGate>
        {/* Migrations run in onInit before any screen renders, so screens can always query. */}
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
          <Stack
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700' },
              headerShadowVisible: false,
            }}>
            <Stack.Protected guard={showOnboarding}>
              <Stack.Screen name="onboarding" />
            </Stack.Protected>
            <Stack.Protected guard={!showOnboarding && !hasProfile}>
              <Stack.Screen name="setup" />
            </Stack.Protected>
            <Stack.Protected guard={!showOnboarding && hasProfile}>
              <Stack.Screen name="(tabs)" />
              {/* Borrower screens open on top of the tabs, with a header + back button. */}
              <Stack.Screen
                name="borrower/new"
                options={{ headerShown: true, title: 'New Borrower' }}
              />
              <Stack.Screen
                name="borrower/[id]/index"
                options={{ headerShown: true, title: 'Borrower' }}
              />
              <Stack.Screen
                name="borrower/[id]/edit"
                options={{ headerShown: true, title: 'Edit Borrower' }}
              />
              <Stack.Screen name="loan/new" options={{ headerShown: true, title: 'New Loan' }} />
              <Stack.Screen name="loan/[id]" options={{ headerShown: true, title: 'Loan' }} />
              {/* Settings → View intro again (same slides, no data or flags changed). */}
              <Stack.Screen name="intro" />
            </Stack.Protected>
          </Stack>
        </SQLiteProvider>
      </AppLockGate>
      <AnimatedSplashOverlay />
    </ThemeProvider>
  );
}
