import type { Centavos } from '@/types/dashboard';

/**
 * Formats integer centavos as pesos: 150000 -> "₱1,500.00".
 * Done by hand (no Intl) so the output is identical on every device and JS engine.
 */
export function formatPeso(centavos: Centavos): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.round(centavos));
  const pesos = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${sign}₱${pesos}.${cents}`;
}

/**
 * Parses what the user typed into centavos without floating-point maths:
 * "5,000" -> 500000, "₱1,500.5" -> 150050, "0.05" -> 5. Returns null for anything invalid
 * (letters, more than 2 decimals, empty).
 */
export function parsePesoToCentavos(text: string): Centavos | null {
  const cleaned = text.replace(/[₱,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const pesos = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const value = pesos * 100 + cents;
  return Number.isSafeInteger(value) ? value : null;
}
