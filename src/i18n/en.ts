/**
 * English strings for features that use `t()`. To add another language later, create a file
 * with the same shape (typed as `Translations`) and pick it in `src/i18n/index.ts`.
 * `{name}` placeholders are filled in by `t(key, { name })`.
 */
export const en = {
  appLock: {
    title: 'PeraHiram is locked',
    subtitle: 'Use your fingerprint, face, or phone PIN/pattern to continue.',
    unlockButton: 'Unlock',
    promptMessage: 'Unlock PeraHiram',
    cancelLabel: 'Cancel',
    cancelledMessage: 'Unlock was cancelled. Tap Unlock to try again.',
    failedMessage: 'Could not verify it is you. Tap Unlock to try again.',
    lockoutMessage:
      'Too many attempts. Wait a moment, or unlock your phone with its PIN/pattern, then try again.',
    noScreenLockTitle: 'Protect your records',
    noScreenLockMessage:
      'Your phone has no screen lock, so App Lock is off. Set a PIN, pattern, or fingerprint in your phone’s Settings, then turn on App Lock in PeraHiram Settings.',
    ok: 'OK',
  },
  settings: {
    appLockSection: 'App Lock',
    requireUnlock: 'Require unlock to open the app',
    requireUnlockHint: 'Uses your phone’s fingerprint, face, or PIN/pattern.',
    lockAfter: 'Lock after',
    lockAfterImmediately: 'Immediately',
    lockAfter30s: '30 sec',
    lockAfter1m: '1 min',
    lockAfter5m: '5 min',
    lockAfterHint: 'How long the app can stay in the background before it locks again.',
    noScreenLockTitle: 'No phone screen lock',
    noScreenLockMessage:
      'Set a PIN, pattern, or fingerprint in your phone’s Settings first, then turn on App Lock.',
    screenLockRemovedBanner:
      'App Lock is on, but your phone no longer has a screen lock, so PeraHiram opens without unlocking. Set a phone screen lock to protect your records again.',
    enableFailedTitle: 'App Lock not turned on',
    disableFailedTitle: 'App Lock is still on',
    authFailedMessage: 'Could not verify it is you. Please try again.',
    viewIntroAgain: 'View intro again',
    viewIntroAgainHint: 'See the app introduction. Your data is not changed.',
    resetAuthFailedTitle: 'Reset cancelled',
    resetAuthFailedMessage: 'Unlock is required to reset the app.',
  },
};

export type Translations = typeof en;
