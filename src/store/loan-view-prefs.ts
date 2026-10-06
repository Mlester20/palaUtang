import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Loan detail's Schedule|Calendar segmented control: a UI preference, NOT whitelisted in
 * src/lib/backup.ts (BACKUP_SETTING_KEYS), so it never travels with a backup.
 */

export type LoanView = 'schedule' | 'calendar';

const KEY = 'loan.view';

function read(): LoanView | null {
  const raw = Storage.getItemSync(KEY);
  return raw === 'schedule' || raw === 'calendar' ? raw : null;
}

/** null = no explicit choice yet; the screen picks a default from the loan's payment type. */
let view: LoanView | null = read();
const listeners = new Set<() => void>();

export function getLoanView(): LoanView | null {
  return view;
}

export function useLoanView(): LoanView | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
  );
}

export function setLoanView(next: LoanView) {
  Storage.setItemSync(KEY, next);
  view = next;
  listeners.forEach((l) => l());
}

/** Settings → Reset app: back to no explicit preference (payment-type default applies again). */
export function clearLoanViewPref() {
  Storage.removeItemSync(KEY);
  view = null;
  listeners.forEach((l) => l());
}
