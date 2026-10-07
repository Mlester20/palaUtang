import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/**
 * Light / Dark / System. Device-level preference: NOT in src/lib/backup.ts's
 * BACKUP_SETTING_KEYS, so it never travels with a backup. Default is 'light' (even for existing
 * installs with no key saved yet — that is intended, per the phase spec).
 *
 * How the override works: React Native's `Appearance.setColorScheme('light' | 'dark' |
 * 'unspecified')` is an APP-LEVEL override of what `useColorScheme()` reports (confirmed by
 * reading node_modules/react-native/Libraries/Utilities/Appearance.js directly). NativeWind v5's
 * own `useColorScheme` (node_modules/nativewind/dist/.../stylesheet.js) is a deprecated, literal
 * passthrough to this exact same RN API — so calling `Appearance.setColorScheme()` here is the
 * ONLY call needed: both `dark:` className variants and every `useColorScheme()`/
 * `useThemeColors()` call in the app follow it live, with no NativeWind import required.
 * 'unspecified' makes RN report the ACTUAL system scheme again (this is "System").
 *
 * No-flash startup: `apply()` runs as a MODULE-LEVEL side effect (same pattern as
 * src/store/app-state.ts's synchronous profile read) the moment this file is first imported —
 * src/app/_layout.tsx imports it before anything else, so the override is already in effect
 * before RootLayout's first render.
 */

export type AppearanceSetting = 'light' | 'dark' | 'system';

const KEY = 'app.appearance';
const DEFAULT_SETTING: AppearanceSetting = 'light';

function read(): AppearanceSetting {
  const raw = Storage.getItemSync(KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_SETTING;
}

function apply(next: AppearanceSetting) {
  Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
}

let setting: AppearanceSetting = read();
apply(setting);

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getAppearanceSetting(): AppearanceSetting {
  return setting;
}

export function useAppearanceSetting(): AppearanceSetting {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => setting,
  );
}

export function setAppearanceSetting(next: AppearanceSetting) {
  Storage.setItemSync(KEY, next);
  apply(next);
  setting = next;
  notify();
}

/** Settings → Reset app: back to the default (Light). */
export function clearAppearanceSetting() {
  Storage.removeItemSync(KEY);
  setting = DEFAULT_SETTING;
  apply(DEFAULT_SETTING);
  notify();
}
