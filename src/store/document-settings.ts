import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Settings → "Receipts & statements" (Phase 13). Business phone/address are kept here, NOT on
 * BusinessProfile (app-state.ts), because they are receipt/statement-only fields. All six keys
 * are whitelisted in src/lib/backup.ts (BACKUP_SETTING_KEYS) so they travel with a backup; an
 * older backup made before Phase 13 simply has none of them, and restore falls back to defaults.
 */

export type PaperSize = 'A4' | 'Letter';

export const FOOTER_NOTE_MAX_LENGTH = 100;

export interface DocumentSettings {
  /** Shown at the bottom of every receipt; null = none. Already trimmed, max 100 chars. */
  footerNote: string | null;
  businessPhone: string | null;
  businessAddress: string | null;
  showBalance: boolean;
  showInterest: boolean;
  paperSize: PaperSize;
}

const KEYS = {
  footerNote: 'receipts.footerNote',
  businessPhone: 'receipts.businessPhone',
  businessAddress: 'receipts.businessAddress',
  showBalance: 'receipts.showBalance',
  showInterest: 'statements.showInterest',
  paperSize: 'statements.paperSize',
} as const;

function read(): DocumentSettings {
  return {
    footerNote: Storage.getItemSync(KEYS.footerNote) || null,
    businessPhone: Storage.getItemSync(KEYS.businessPhone) || null,
    businessAddress: Storage.getItemSync(KEYS.businessAddress) || null,
    showBalance: Storage.getItemSync(KEYS.showBalance) !== 'false',
    showInterest: Storage.getItemSync(KEYS.showInterest) !== 'false',
    paperSize: Storage.getItemSync(KEYS.paperSize) === 'Letter' ? 'Letter' : 'A4',
  };
}

let settings: DocumentSettings = read();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getDocumentSettings(): DocumentSettings {
  return settings;
}

export function useDocumentSettings(): DocumentSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => settings,
  );
}

function setTextSetting(key: (typeof KEYS)[keyof typeof KEYS], value: string | null, max?: number) {
  const trimmed = value?.trim().slice(0, max ?? Infinity) || null;
  if (trimmed) Storage.setItemSync(key, trimmed);
  else Storage.removeItemSync(key);
  return trimmed;
}

export function setFooterNote(note: string | null) {
  const trimmed = setTextSetting(KEYS.footerNote, note, FOOTER_NOTE_MAX_LENGTH);
  settings = { ...settings, footerNote: trimmed };
  notify();
}

export function setBusinessPhone(phone: string | null) {
  const trimmed = setTextSetting(KEYS.businessPhone, phone);
  settings = { ...settings, businessPhone: trimmed };
  notify();
}

export function setBusinessAddress(address: string | null) {
  const trimmed = setTextSetting(KEYS.businessAddress, address);
  settings = { ...settings, businessAddress: trimmed };
  notify();
}

export function setShowBalance(show: boolean) {
  Storage.setItemSync(KEYS.showBalance, show ? 'true' : 'false');
  settings = { ...settings, showBalance: show };
  notify();
}

export function setShowInterest(show: boolean) {
  Storage.setItemSync(KEYS.showInterest, show ? 'true' : 'false');
  settings = { ...settings, showInterest: show };
  notify();
}

export function setPaperSize(size: PaperSize) {
  Storage.setItemSync(KEYS.paperSize, size);
  settings = { ...settings, paperSize: size };
  notify();
}

/** Re-reads everything from kv-store (e.g. right after a restore wrote new values underneath). */
export function reloadDocumentSettings() {
  settings = read();
  notify();
}

/** Settings → Reset app: back to defaults (no footer note/phone/address, balance+interest shown, A4). */
export function clearDocumentSettings() {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  settings = read();
  notify();
}
