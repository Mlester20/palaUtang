import '@/global.css';

// Per-weight imports so only these 3 font files are bundled (the package index pulls in all 18).
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppLockGate } from '@/components/AppLockGate';
import { RestoreOverlay } from '@/components/backup/RestoreOverlay';
import { ReconcileOnForeground } from '@/components/ReconcileOnForeground';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/db/migrations';
import { reconcileAllActiveLoans } from '@/db/payments';
import { t } from '@/i18n';
import { todayYmd } from '@/lib/loan';
import { useThemeColors } from '@/lib/theme';
import { recoverInterruptedRestore } from '@/services/backup';
import { useAppState } from '@/store/app-state';
import { useDataGeneration } from '@/store/backup-state';

SplashScreen.preventAutoHideAsync();

/**
 * Before any screen renders: finish/undo an interrupted restore (and clean temp files),
 * migrate, then bring loans up to today (balda, make-ups).
 */
async function initDatabase(db: SQLiteDatabase) {
  try {
    const recovered = await recoverInterruptedRestore(db);
    if (recovered === 'rolledBack') console.warn('[Restore] Unfinished restore rolled back');
  } catch (error) {
    console.error('[Restore recovery failed]', error);
  }
  await migrateDbIfNeeded(db);
  try {
    await reconcileAllActiveLoans(db, todayYmd());
  } catch (error) {
    // Never block the app on this; screens recompute their loan on open anyway.
    console.error('[Reconcile on start failed]', error);
  }
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = useThemeColors();
  // Poppins (names in `fonts`, src/lib/theme.ts). On failure the system font is used instead.
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  const fontsReady = fontsLoaded || fontError !== null;
  useEffect(() => {
    if (fontError) console.warn('[Fonts] Poppins failed to load; using the system font', fontError);
  }, [fontError]);
  const { hasCompletedOnboarding, profile } = useAppState();
  // A restore bumps this: the provider (and every screen under it) remounts with fresh data.
  const dataGeneration = useDataGeneration();
  const showOnboarding = !hasCompletedOnboarding;
  const hasProfile = profile !== null;

  // Only one group is reachable at a time. Any blocked route (including the initial "/")
  // redirects to the first available screen, so this decides the launch flow:
  // lock gate -> onboarding (first run only) -> setup (first run only) -> (tabs) and screens above.
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* The lock comes first: while locked, nothing below (not even the database) is rendered. */}
      {/* Nothing is rendered until fonts are ready; the splash overlay covers the wait. */}
      {fontsReady && (
        <AppLockGate>
          {/* Migrations run in onInit before any screen renders, so screens can always query. */}
          <SQLiteProvider key={dataGeneration} databaseName={DATABASE_NAME} onInit={initDatabase}>
            <ReconcileOnForeground />
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
                <Stack.Screen
                  name="loan/settle"
                  options={{ headerShown: true, title: t('settlement.screenTitle') }}
                />
                <Stack.Screen
                  name="payment/new"
                  options={{ headerShown: true, title: t('payments.newTitle') }}
                />
                <Stack.Screen
                  name="cash/index"
                  options={{ headerShown: true, title: t('cash.screenTitle') }}
                />
                <Stack.Screen
                  name="cash/new"
                  options={{ headerShown: true, title: t('cash.newTitle') }}
                />
                <Stack.Screen
                  name="cash/count"
                  options={{ headerShown: true, title: t('cash.countTitle') }}
                />
                <Stack.Screen
                  name="cash/setup"
                  options={{ headerShown: true, title: t('cash.setupTitle') }}
                />
                <Stack.Screen
                  name="backup/index"
                  options={{ headerShown: true, title: t('backup.screenTitle') }}
                />
                <Stack.Screen
                  name="backup/export"
                  options={{ headerShown: true, title: t('backup.exportTitle') }}
                />
                <Stack.Screen
                  name="reports"
                  options={{ headerShown: true, title: t('reports.title') }}
                />
                {/* Settings → View intro again (same slides, no data or flags changed). */}
                <Stack.Screen name="intro" />
              </Stack.Protected>
              {/*
                Restore is reachable from onboarding, setup and Settings. Registered LAST and
                unguarded so it's always reachable via router.push — but ordering also decides
                the fallback for the initial "/" when nothing matches (see the note above): put
                first, it would hijack every cold launch into this screen instead of onboarding/
                setup/tabs, which is exactly the bug this comment is warning about. Last keeps it
                out of that race while still letting onboarding/setup push to it directly.
              */}
              <Stack.Screen
                name="backup/restore"
                options={{ headerShown: true, title: t('backup.restoreTitle') }}
              />
            </Stack>
            <RestoreOverlay />
          </SQLiteProvider>
        </AppLockGate>
      )}
      <AnimatedSplashOverlay ready={fontsReady} />
    </ThemeProvider>
  );
}
