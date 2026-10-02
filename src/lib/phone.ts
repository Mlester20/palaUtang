/** Removes spaces, dashes, dots and brackets people often type: "0917 123-4567" -> "09171234567". */
export function normalizePhPhone(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '');
}

/** Lenient Philippine mobile check: 09XXXXXXXXX or +639XXXXXXXXX (after normalising). */
export function isValidPhPhone(raw: string): boolean {
  return /^(09\d{9}|\+639\d{9})$/.test(normalizePhPhone(raw));
}
