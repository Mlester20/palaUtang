/**
 * CSV building for exports. Pure; no files or database.
 *
 * Rules (opens cleanly in Excel and Google Sheets):
 *  - UTF-8 with a BOM, so names (ñ, é) and the ₱ sign in text show correctly in Excel;
 *  - CRLF line endings and a header row;
 *  - a cell containing a comma, quote, CR or LF is quoted, and quotes are doubled;
 *  - CSV injection: a TEXT cell starting with =, +, -, @, tab or CR gets a leading apostrophe,
 *    so a borrower named =HYPERLINK("x") is shown as text, never run as a formula;
 *  - money as pesos with 2 decimals and NO currency sign ("1500.00", "-150.00") so it is a
 *    number in the spreadsheet; money cells are trusted and never get the apostrophe;
 *  - dates as YYYY-MM-DD (stored that way).
 *
 * Examples: csvCell('Santos, Maria') → "Santos, Maria" (quoted); csvCell('He said "hi"')
 * → "He said ""hi""" ; csvCell('=1+1') → '=1+1 prefixed with an apostrophe; csvCell(money(150050)) → 1500.50.
 */

export const CSV_BOM = '﻿';
export const CSV_EOL = '\r\n';

/** A numeric cell written as-is (no injection prefix). */
export interface CsvNumber {
  readonly csvNumber: string;
}

export type CsvValue = string | number | boolean | null | undefined | CsvNumber;

/** Integer centavos → "1500.00" (sign kept, no ₱). */
export function money(centavos: number | null | undefined): CsvNumber | null {
  if (centavos === null || centavos === undefined) return null;
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.round(centavos));
  return { csvNumber: `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}` };
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value.csvNumber;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',') + CSV_EOL;
}

/** A whole file: BOM + header + rows. Large exports join chunks of csvRow() instead. */
export function buildCsv(header: string[], rows: CsvValue[][]): string {
  return CSV_BOM + csvRow(header) + rows.map(csvRow).join('');
}
