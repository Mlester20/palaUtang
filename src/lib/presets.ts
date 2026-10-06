/**
 * Loan presets: a saved shortcut that fills the New Loan form. Pure: no database, no React.
 * A preset never affects an existing loan (no foreign key; the loan copies the values once).
 *
 * Validation REUSES computeLoanPreview (src/lib/loan.ts) — the exact function the loan form
 * itself calls — so a preset can never pass a check the live form would reject. When a preset
 * leaves the principal open, a nominal ₱1.00 stand-in (NOMINAL_PRINCIPAL) runs the same
 * rate/term/amount checks; it is never stored, shown, or itself a source of an error (it is
 * always a valid, tiny principal).
 */

import { computeLoanPreview, type LoanInputMode, type PaymentType } from './loan';
import { money } from './csv';

export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME_LENGTH = 40;
const NOMINAL_PRINCIPAL = 100; // ₱1.00 stand-in, only to validate rate/term/amount

export interface LoanPreset {
  id: number;
  name: string;
  paymentType: PaymentType;
  inputMode: LoanInputMode;
  /** Centavos; null = left for the user to type each time. */
  principal: number | null;
  interestRate: number | null;
  installmentAmount: number | null;
  numberOfInstallments: number;
  skipSundays: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PresetInput {
  name: string;
  paymentType: PaymentType;
  inputMode: LoanInputMode;
  principal: number | null;
  interestRate: number | null;
  installmentAmount: number | null;
  numberOfInstallments: number;
  skipSundays: boolean;
}

export interface PresetValidation {
  nameError: string | null;
  /** Rate/term/amount-vs-principal problems, verbatim from computeLoanPreview. */
  previewErrors: string[];
}

/** Same rate/term/amount checks as the loan form; a stand-in principal is used when none is set. */
export function validatePresetInput(input: PresetInput): PresetValidation {
  const name = input.name.trim();
  const nameError =
    name === ''
      ? 'Enter a name for this preset.'
      : name.length > MAX_PRESET_NAME_LENGTH
        ? `Keep the name under ${MAX_PRESET_NAME_LENGTH} characters.`
        : null;

  const principalForCheck = input.principal ?? NOMINAL_PRINCIPAL;
  const preview = computeLoanPreview(
    input.inputMode === 'rate'
      ? {
          mode: 'rate',
          paymentType: input.paymentType,
          principalCentavos: principalForCheck,
          ratePercent: input.interestRate ?? NaN,
          term: input.numberOfInstallments,
        }
      : {
          mode: 'installment',
          paymentType: input.paymentType,
          principalCentavos: principalForCheck,
          installmentCentavos: input.installmentAmount ?? NaN,
          term: input.numberOfInstallments,
        },
  );
  return { nameError, previewErrors: preview.errors };
}

const peso = (centavos: number) => `₱${money(centavos)!.csvNumber}`;

/**
 * One-line summary for a preset row, e.g. "₱5,000 · 20% · 40 daily, skip Sundays → ₱150/day",
 * or without a principal: "20% · 40 daily". `t` is the i18n lookup (kept generic so this stays
 * pure and testable without importing the i18n module).
 */
export function presetSummaryText(
  preset: LoanPreset,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  if (preset.principal !== null) parts.push(peso(preset.principal));
  parts.push(
    preset.inputMode === 'rate'
      ? `${preset.interestRate}%`
      : `${peso(preset.installmentAmount ?? 0)}/${preset.paymentType === 'daily' ? t('presets.perDay') : t('presets.total')}`,
  );
  parts.push(
    preset.paymentType === 'daily'
      ? t('presets.dailyTerm', { count: preset.numberOfInstallments })
      : t('presets.lumpTerm', { count: preset.numberOfInstallments }),
  );
  if (preset.skipSundays) parts.push(t('presets.skipSundaysShort'));

  let summary = parts.join(' · ');
  if (preset.principal !== null && preset.inputMode === 'rate') {
    const preview = computeLoanPreview({
      mode: 'rate',
      paymentType: preset.paymentType,
      principalCentavos: preset.principal,
      ratePercent: preset.interestRate ?? 0,
      term: preset.numberOfInstallments,
    });
    if (preview.errors.length === 0) {
      summary += ` → ${peso(preview.installmentCentavos)}${preset.paymentType === 'daily' ? t('presets.perDaySuffix') : ''}`;
    }
  }
  return summary;
}
