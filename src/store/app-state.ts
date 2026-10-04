import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

export const CURRENCIES = [{ code: 'PHP', symbol: '₱', label: 'Philippine Peso' }] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export type BusinessProfile = {
  businessName: string;
  currency: CurrencyCode;
  /** Charge a fixed penalty for each missed ("balda") payment day. */
  baldaPenaltyEnabled: boolean;
  /** Penalty per balda day, in the selected currency. Only used when enabled. */
  baldaPenaltyAmount: number;
  /** Default early-payoff calculation (can be changed per transaction). */
  settlementMode: DefaultSettlementMode;
};

export type DefaultSettlementMode = 'full' | 'prorata';

export type AppState = {
  /** Saved: the onboarding was finished (Skip or Get Started). It never shows automatically again. */
  hasCompletedOnboarding: boolean;
  profile: BusinessProfile | null;
};

const KEYS = {
  hasCompletedOnboarding: 'app.hasCompletedOnboarding',
  /** Older builds' "Don't show this again" flag; still honoured so upgraded users aren't re-shown it. */
  legacyHideOnboarding: 'app.hideOnboarding',
  profile: 'app.businessProfile',
} as const;

function readProfile(): BusinessProfile | null {
  const raw = Storage.getItemSync(KEYS.profile);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<BusinessProfile>;
    // Profiles saved before Phase 8 have no settlementMode: default to 'full'.
    return {
      ...saved,
      settlementMode: saved.settlementMode === 'prorata' ? 'prorata' : 'full',
    } as BusinessProfile;
  } catch {
    return null;
  }
}

function readState(): AppState {
  const profile = readProfile();
  return {
    // Anyone who already set up a profile has been through onboarding.
    hasCompletedOnboarding:
      Storage.getItemSync(KEYS.hasCompletedOnboarding) === 'true' ||
      Storage.getItemSync(KEYS.legacyHideOnboarding) === 'true' ||
      profile !== null,
    profile,
  };
}

// Read synchronously once at startup so the first render already knows where to route.
let state: AppState = readState();
const listeners = new Set<() => void>();

function setState(next: AppState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Called by BOTH Skip and Get Started on the first-run onboarding. */
export function completeOnboarding() {
  Storage.setItemSync(KEYS.hasCompletedOnboarding, 'true');
  setState({ ...state, hasCompletedOnboarding: true });
}

/** Settings → Early payoff default. */
export function setDefaultSettlementMode(mode: DefaultSettlementMode) {
  if (!state.profile) return;
  saveProfile({ ...state.profile, settlementMode: mode });
}

export function saveProfile(profile: BusinessProfile) {
  Storage.setItemSync(KEYS.profile, JSON.stringify(profile));
  setState({ ...state, profile });
}

/**
 * Re-reads everything from kv-store (e.g. after a restore wrote new values underneath), so
 * every screen sees them at once.
 */
export function reloadAppState() {
  setState(readState());
}

/** Clears the onboarding flag + profile so the first-run flow shows again (Settings → Reset app). */
export function resetAppState() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  setState({ hasCompletedOnboarding: false, profile: null });
}
