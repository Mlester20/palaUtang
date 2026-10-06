import type { SQLiteDatabase } from 'expo-sqlite';

import {
  MAX_PRESETS,
  validatePresetInput,
  type LoanPreset,
  type PresetInput,
} from '@/lib/presets';
import type { LoanInputMode, PaymentType } from '@/lib/loan';

import { writeTransaction } from './transaction';

type PresetRow = {
  id: number;
  name: string;
  payment_type: PaymentType;
  input_mode: LoanInputMode;
  principal: number | null;
  interest_rate: number | null;
  installment_amount: number | null;
  number_of_installments: number;
  skip_sundays: number;
  created_at: string;
  updated_at: string;
};

function toPreset(row: PresetRow): LoanPreset {
  return {
    id: row.id,
    name: row.name,
    paymentType: row.payment_type,
    inputMode: row.input_mode,
    principal: row.principal,
    interestRate: row.interest_rate,
    installmentAmount: row.installment_amount,
    numberOfInstallments: row.number_of_installments,
    skipSundays: row.skip_sundays === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPresets(db: SQLiteDatabase): Promise<LoanPreset[]> {
  const rows = await db.getAllAsync<PresetRow>(
    'SELECT * FROM loan_presets ORDER BY name COLLATE NOCASE',
  );
  return rows.map(toPreset);
}

export async function getPresetById(db: SQLiteDatabase, id: number): Promise<LoanPreset | null> {
  const row = await db.getFirstAsync<PresetRow>('SELECT * FROM loan_presets WHERE id = ?', [id]);
  return row ? toPreset(row) : null;
}

export type PresetErrorCode = 'nameRequired' | 'nameTooLong' | 'nameTaken' | 'invalid' | 'tooMany' | 'notFound';

export class PresetError extends Error {
  readonly code: PresetErrorCode;
  readonly previewErrors: string[];
  constructor(code: PresetErrorCode, previewErrors: string[] = []) {
    super(`Preset rejected: ${code}`);
    this.name = 'PresetError';
    this.code = code;
    this.previewErrors = previewErrors;
  }
}

function validateOrThrow(input: PresetInput) {
  const { nameError, previewErrors } = validatePresetInput(input);
  if (nameError) {
    throw new PresetError(
      input.name.trim() === '' ? 'nameRequired' : 'nameTooLong',
    );
  }
  if (previewErrors.length > 0) throw new PresetError('invalid', previewErrors);
}

function params(input: PresetInput) {
  return [
    input.name.trim(),
    input.paymentType,
    input.inputMode,
    input.principal,
    input.inputMode === 'rate' ? input.interestRate : null,
    input.inputMode === 'installment' ? input.installmentAmount : null,
    input.numberOfInstallments,
    input.paymentType === 'daily' && input.skipSundays ? 1 : 0,
  ];
}

/** Returns the new preset's id. Throws PresetError on a bad name, bad numbers, or the 20-preset cap. */
export async function createPreset(db: SQLiteDatabase, input: PresetInput): Promise<number> {
  validateOrThrow(input);
  return writeTransaction(db, async () => {
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM loan_presets');
    if ((count?.n ?? 0) >= MAX_PRESETS) throw new PresetError('tooMany');
    try {
      const now = new Date().toISOString();
      const result = await db.runAsync(
        `INSERT INTO loan_presets (name, payment_type, input_mode, principal, interest_rate,
           installment_amount, number_of_installments, skip_sundays, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...params(input), now, now],
      );
      return result.lastInsertRowId;
    } catch (error) {
      if (errorMentions(error, 'loan_presets.name')) throw new PresetError('nameTaken');
      throw error;
    }
  });
}

export async function updatePreset(db: SQLiteDatabase, id: number, input: PresetInput) {
  validateOrThrow(input);
  return writeTransaction(db, async () => {
    try {
      const result = await db.runAsync(
        `UPDATE loan_presets
         SET name = ?, payment_type = ?, input_mode = ?, principal = ?, interest_rate = ?,
             installment_amount = ?, number_of_installments = ?, skip_sundays = ?, updated_at = ?
         WHERE id = ?`,
        [...params(input), new Date().toISOString(), id],
      );
      if (result.changes === 0) throw new PresetError('notFound');
    } catch (error) {
      if (error instanceof PresetError) throw error;
      if (errorMentions(error, 'loan_presets.name')) throw new PresetError('nameTaken');
      throw error;
    }
  });
}

/** No foreign key references loan_presets, so this never touches any existing loan. */
export async function deletePreset(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM loan_presets WHERE id = ?', [id]);
}

function errorMentions(error: unknown, text: string): boolean {
  return error instanceof Error && error.message.includes(text);
}
