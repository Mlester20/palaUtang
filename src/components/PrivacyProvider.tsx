import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { getPrivacySettings, setPrivacyEnabled, usePrivacySettings } from '@/store/privacy';

const PEEK_MS = 10_000;

export type MoneyKind = 'total' | 'borrower';

interface PrivacyContextValue {
  enabled: boolean;
  hideBorrowerAmounts: boolean;
  peeking: boolean;
  /** Whether a value of this kind should currently be shown as the mask placeholder. */
  isMasked: (kind: MoneyKind) => boolean;
  /** Eye/eye-off icon: instant toggle, saved, no peek carried over. */
  toggleEnabled: () => void;
  /** Reveals every masked amount for 10s; a second call while peeking restarts the window. */
  peek: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

/**
 * ONE provider for the whole app (mounted once in the root layout, outside the Stack so route
 * changes never remount it). `settings` is read synchronously at import time in
 * src/store/privacy.ts, so the very first render already reflects the saved state — no
 * unmasked-then-masked flash.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const settings = usePrivacySettings();
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPeekTimer = useCallback(() => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  }, []);

  const peek = useCallback(() => {
    clearPeekTimer();
    setPeeking(true);
    peekTimer.current = setTimeout(() => setPeeking(false), PEEK_MS);
  }, [clearPeekTimer]);

  const toggleEnabled = useCallback(() => {
    clearPeekTimer();
    setPeeking(false);
    setPrivacyEnabled(!getPrivacySettings().enabled);
  }, [clearPeekTimer]);

  // A peek ends immediately when the app leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        clearPeekTimer();
        setPeeking(false);
      }
    });
    return () => subscription.remove();
  }, [clearPeekTimer]);

  useEffect(() => clearPeekTimer, [clearPeekTimer]);

  const value = useMemo<PrivacyContextValue>(() => {
    const isMasked = (kind: MoneyKind) => {
      if (!settings.enabled || peeking) return false;
      return kind === 'total' || settings.hideBorrowerAmounts;
    };
    return {
      enabled: settings.enabled,
      hideBorrowerAmounts: settings.hideBorrowerAmounts,
      peeking,
      isMasked,
      toggleEnabled,
      peek,
    };
  }, [settings.enabled, settings.hideBorrowerAmounts, peeking, toggleEnabled, peek]);

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy must be used within PrivacyProvider');
  return ctx;
}
