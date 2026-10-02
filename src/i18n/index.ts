import { en, type Translations } from './en';

/** Every dotted path to a string in the translations, e.g. 'appLock.unlockButton'. */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<Translations>;

// Only English for now. A language setting can switch this object later.
const current: Translations = en;

/** Looks up a string; `{placeholders}` are replaced from `params`. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  let value: unknown = current;
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part];
  let text = typeof value === 'string' ? value : key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return text;
}
