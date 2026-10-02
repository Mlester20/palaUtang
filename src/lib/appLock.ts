import * as LocalAuthentication from 'expo-local-authentication';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { t } from '@/i18n';

export type UnlockResult = 'success' | 'cancelled' | 'failed' | 'lockout';

export const LOCK_GRACE_OPTIONS = [0, 30, 60, 300] as const;
export const DEFAULT_LOCK_GRACE_SECONDS = 30;

const KEYS = {
  enabled: 'appLock.enabled',
  graceSeconds: 'appLock.graceSeconds',
  noScreenLockNoticeShown: 'appLock.noScreenLockNoticeShown',
} as const;

// ───────────────────────── Device ─────────────────────────

/**
 * Whether the phone has ANY screen lock (PIN/pattern/password or biometrics).
 * getEnrolledLevelAsync is used instead of isEnrolledAsync, which ignores PIN/pattern-only phones.
 */
export async function getLockStatus(): Promise<{ hasScreenLock: boolean }> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return { hasScreenLock: level !== LocalAuthentication.SecurityLevel.NONE };
  } catch (error) {
    console.warn('[App Lock] Could not read the screen lock level', error);
    return { hasScreenLock: false };
  }
}

// The system prompt (and the PIN/pattern screen behind it) can send the app to the background.
// The gate checks this so the prompt doesn't re-lock the app it is unlocking.
let authInProgress = false;
let lastAuthEndedAt = 0;
const AUTH_SETTLE_MS = 1500;

/** True while a prompt is open, and briefly after it closes (its AppState events arrive late). */
export function isAuthenticating(): boolean {
  return authInProgress || Date.now() - lastAuthEndedAt < AUTH_SETTLE_MS;
}

/**
 * Shows the phone's own unlock prompt. Device PIN/pattern fallback is allowed
 * (disableDeviceFallback is not set). Never throws.
 */
export async function unlockWithDevice(): Promise<UnlockResult> {
  if (authInProgress) return 'cancelled';
  authInProgress = true;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('appLock.promptMessage'),
      cancelLabel: t('appLock.cancelLabel'),
    });
    if (result.success) return 'success';
    switch (result.error) {
      case 'user_cancel':
      case 'system_cancel':
      case 'app_cancel':
      case 'user_fallback':
        return 'cancelled';
      case 'lockout':
        return 'lockout';
      default:
        return 'failed';
    }
  } catch (error) {
    console.warn('[App Lock] Authentication error', error);
    return 'failed';
  } finally {
    authInProgress = false;
    lastAuthEndedAt = Date.now();
  }
}

// ───────────────────────── Settings (kv-store) ─────────────────────────

export type AppLockSettings = {
  /** null = never decided yet (fresh install); the gate decides once and stores it. */
  enabled: boolean | null;
  graceSeconds: number;
};

function readSettings(): AppLockSettings {
  const enabled = Storage.getItemSync(KEYS.enabled);
  const rawGrace = Storage.getItemSync(KEYS.graceSeconds);
  const grace = rawGrace === null ? NaN : Number(rawGrace);
  return {
    enabled: enabled === null ? null : enabled === 'true',
    graceSeconds: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_LOCK_GRACE_SECONDS,
  };
}

let settings = readSettings();
const listeners = new Set<() => void>();

function update(next: Partial<AppLockSettings>) {
  settings = { ...settings, ...next };
  listeners.forEach((listener) => listener());
}

export function getAppLockSettings(): AppLockSettings {
  return settings;
}

export function useAppLockSettings(): AppLockSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => settings,
  );
}

export function setAppLockEnabled(enabled: boolean) {
  Storage.setItemSync(KEYS.enabled, String(enabled));
  update({ enabled });
}

export function setLockGraceSeconds(seconds: number) {
  Storage.setItemSync(KEYS.graceSeconds, String(seconds));
  update({ graceSeconds: seconds });
}

/** One-time "set a phone screen lock" recommendation. Returns true only the first time. */
export function takeNoScreenLockNotice(): boolean {
  if (Storage.getItemSync(KEYS.noScreenLockNoticeShown) === 'true') return false;
  Storage.setItemSync(KEYS.noScreenLockNoticeShown, 'true');
  return true;
}

/** Used by Reset app: the next launch decides App Lock again like a fresh install. */
export function clearAppLockSettings() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  update({ enabled: null, graceSeconds: DEFAULT_LOCK_GRACE_SECONDS });
}
