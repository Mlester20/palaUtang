import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t, type TranslationKey } from '@/i18n';
import {
  getAppLockSettings,
  getLockStatus,
  isAuthenticating,
  setAppLockEnabled,
  takeNoScreenLockNotice,
  unlockWithDevice,
  type UnlockResult,
} from '@/lib/appLock';
import { useThemeColors } from '@/lib/theme';

type Phase = 'checking' | 'locked' | 'unlocked';

// Wait for the splash fade before the first automatic prompt.
const AUTO_PROMPT_DELAY_MS = 700;
const NO_LOCK_NOTICE_DELAY_MS = 1500;

/**
 * Covers the whole app with the phone's own lock (fingerprint/face/PIN/pattern).
 * While locked or checking, the app content is NOT rendered at all, so no data can show.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const phaseRef = useRef<Phase>('checking');
  const backgroundAt = useRef<number | null>(null);

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // Cold start: decide once whether to lock.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { hasScreenLock } = await getLockStatus();
      let { enabled } = getAppLockSettings();
      if (enabled === null) {
        // Fresh install: ON only if the phone has a screen lock; stored so it never flips later.
        enabled = hasScreenLock;
        setAppLockEnabled(enabled);
      }
      if (cancelled) return;

      if (enabled && hasScreenLock) {
        go('locked');
        return;
      }
      // No screen lock (or App Lock off): never block the user.
      go('unlocked');
      if (!hasScreenLock && !enabled && takeNoScreenLockNotice()) {
        setTimeout(
          () =>
            Alert.alert(t('appLock.noScreenLockTitle'), t('appLock.noScreenLockMessage'), [
              { text: t('appLock.ok') },
            ]),
          NO_LOCK_NOTICE_DELAY_MS,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-lock after the app was in the background longer than the grace period.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // The unlock prompt itself (and the PIN screen behind it) moves the app to the
      // background and back; those changes must not lock the app again.
      if (isAuthenticating()) return;
      const { enabled, graceSeconds } = getAppLockSettings();

      if (next === 'background') {
        backgroundAt.current = Date.now();
        // "Immediately": lock now, so nothing is shown when the app comes back.
        if (enabled && graceSeconds === 0 && phaseRef.current === 'unlocked') go('locked');
        return;
      }
      // 'inactive' (brief interruptions such as dialogs) is ignored on purpose.
      if (next === 'active' && backgroundAt.current !== null) {
        const awayMs = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (enabled && phaseRef.current === 'unlocked' && awayMs >= graceSeconds * 1000) {
          go('locked');
        }
      }
    });
    return () => subscription.remove();
  }, []);

  if (phase === 'unlocked') return <>{children}</>;
  if (phase === 'checking') return <BlankScreen />;
  return <LockScreen onUnlocked={() => go('unlocked')} />;
}

function BlankScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
      <ActivityIndicator size="large" />
    </View>
  );
}

const MESSAGE: Record<Exclude<UnlockResult, 'success'>, TranslationKey> = {
  cancelled: 'appLock.cancelledMessage',
  failed: 'appLock.failedMessage',
  lockout: 'appLock.lockoutMessage',
};

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [message, setMessage] = useState<string | null>(null);
  const [prompting, setPrompting] = useState(false);

  const unlock = async () => {
    if (prompting) return;
    setPrompting(true);
    setMessage(null);
    const result = await unlockWithDevice();
    setPrompting(false);
    if (result === 'success') {
      onUnlocked();
      return;
    }
    // Never lock the user out: if the phone's screen lock was removed, let them in.
    const { hasScreenLock } = await getLockStatus();
    if (!hasScreenLock) {
      onUnlocked();
      return;
    }
    setMessage(t(MESSAGE[result]));
  };

  // Ask once automatically when the lock view appears; retries are manual (no prompt loop).
  useEffect(() => {
    const timer = setTimeout(unlock, AUTO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The back button must not get past the lock.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  return (
    <View
      className="flex-1 items-center justify-center gap-6 bg-slate-50 px-8 dark:bg-slate-950"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="h-24 w-24 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950">
        <Ionicons name="lock-closed" size={48} color={colors.primary} />
      </View>
      <View className="items-center gap-2">
        <Text className="text-3xl font-extrabold text-slate-900 dark:text-white">PeraHiram</Text>
        <Text className="text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
          {t('appLock.title')}
        </Text>
        <Text className="text-center text-base text-slate-600 dark:text-slate-300">
          {t('appLock.subtitle')}
        </Text>
      </View>

      {message && (
        <View className="w-full rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
          <Text className="text-center text-base text-amber-900 dark:text-amber-100">
            {message}
          </Text>
        </View>
      )}

      <Pressable
        onPress={unlock}
        disabled={prompting}
        accessibilityRole="button"
        accessibilityState={{ disabled: prompting, busy: prompting }}
        className={
          prompting
            ? 'min-h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 opacity-60 dark:bg-teal-500'
            : 'min-h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 active:bg-teal-800 dark:bg-teal-500'
        }>
        <Ionicons name="finger-print" size={24} color="#ffffff" />
        <Text className="text-lg font-bold text-white">{t('appLock.unlockButton')}</Text>
      </Pressable>
    </View>
  );
}
