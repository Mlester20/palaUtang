/**
 * Pure loan maths: no database, no React. Money is integer centavos; dates are 'YYYY-MM-DD'.
 *
 * Date rule: every date is built from local year/month/day parts (new Date(y, m - 1, d)).
 * Never toISOString()/UTC here: in UTC+8 that turns "Oct 3" into "Oct 2" for early-morning times.
 */

export type PaymentType = 'daily' | 'lump_sum';
export type LoanInputMode = 'rate' | 'installment';

/**
 * Daily loans: how many days after the start date the first collection is due.
 * 1 = start collecting the next day (most common). Set to 0 for lenders who collect on day one.
 */
export const DAILY_FIRST_DUE_OFFSET_DAYS = 1;

export const LOAN_LIMITS = {
  maxPrincipalCentavos: 10_000_000_00, // ₱10,000,000.00
  maxTerm: 365,
  maxRatePercent: 100,
} as const;

// ───────────────────────── Dates ─────────────────────────

/** 'YYYY-MM-DD' -> local Date at midnight. */
export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Local Date -> 'YYYY-MM-DD' (from local parts, never UTC). */
export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calendar-day addition; month/year rollover and DST are handled by the Date constructor. */
export function addDays(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  return toYmd(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

export function isSunday(ymd: string): boolean {
  return parseYmd(ymd).getDay() === 0;
}

export function todayYmd(): string {
  return toYmd(new Date());
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** '2026-10-02' -> "Friday, October 2, 2026". */
export function formatDisplayDate(ymd: string): string {
  const d = parseYmd(ymd);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** '2026-10-02' -> "Fri, Oct 2" (compact, for schedule rows). */
export function formatShortDate(ymd: string): string {
  const d = parseYmd(ymd);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}

/** '2026-10-02' -> "October 2026" (schedule month headers). */
export function formatMonthYear(ymd: string): string {
  const d = parseYmd(ymd);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ───────────────────────── Preview ─────────────────────────

export type LoanPreviewInput =
  | {
      mode: 'rate';
      paymentType: PaymentType;
      principalCentavos: number;
      ratePercent: number;
      /** Daily: number of installments. Lump sum: days until it is due. */
      term: number;
    }
  | {
      mode: 'installment';
      paymentType: PaymentType;
      principalCentavos: number;
      /** Daily: amount per installment. Lump sum: the single amount to pay back. */
      installmentCentavos: number;
      term: number;
    };

export interface LoanPreview {
  interestCentavos: number;
  totalPayableCentavos: number;
  numberOfInstallments: number;
  /** Regular installment (all but possibly the last). */
  installmentCentavos: number;
  /** Last installment: regular amount + rounding remainder. */
  lastInstallmentCentavos: number;
  /** Stored rate: the entered % in rate mode, null in installment mode. */
  ratePercent: number | null;
  /** Effective flat rate for display (= rate in rate mode, interest ÷ principal otherwise). */
  effectiveRatePercent: number;
  errors: string[];
  warnings: string[];
}

/**
 * Examples (₱ shown for readability; values are centavos):
 *  - rate: ₱5,000, 20%, 40 daily  -> interest ₱1,000, total ₱6,000, 40 × ₱150.00
 *  - rate: ₱5,000, 15%, 30 daily  -> interest ₱750, total ₱5,750, 29 × ₱191.66 + last ₱191.86
 *  - installment: ₱5,000, ₱150/day, 40 days -> total ₱6,000, interest ₱1,000, effective 20%
 *  - installment: ₱5,000, ₱100/day, 40 days -> total ₱4,000 < principal -> error
 *  - lump sum, rate: ₱10,000, 10%, due in 30 days -> 1 × ₱11,000
 */
export function computeLoanPreview(input: LoanPreviewInput): LoanPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const principal = Math.round(input.principalCentavos);
  const term = input.term;

  if (!Number.isFinite(principal) || principal <= 0) errors.push('Principal must be more than ₱0.');
  if (principal > LOAN_LIMITS.maxPrincipalCentavos) errors.push('Principal is too large.');
  if (!Number.isInteger(term) || term < 1) errors.push('Term must be at least 1.');
  if (term > LOAN_LIMITS.maxTerm) errors.push(`Term can be at most ${LOAN_LIMITS.maxTerm} days.`);

  const numberOfInstallments = input.paymentType === 'daily' ? Math.max(1, term) : 1;

  let interest = 0;
  let total = 0;
  let ratePercent: number | null = null;

  if (input.mode === 'rate') {
    ratePercent = input.ratePercent;
    if (!Number.isFinite(ratePercent) || ratePercent < 0)
      errors.push('Interest rate cannot be negative.');
    if (ratePercent > LOAN_LIMITS.maxRatePercent)
      errors.push(`Interest rate can be at most ${LOAN_LIMITS.maxRatePercent}%.`);
    interest = Math.round((principal * ratePercent) / 100);
    total = principal + interest;
    if (errors.length === 0 && ratePercent === 0) warnings.push('This loan has no interest (0%).');
  } else {
    const amount = Math.round(input.installmentCentavos);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Amount must be more than ₱0.');
    // Daily: amount × number of installments. Lump sum: the amount is the whole payback.
    total = input.paymentType === 'daily' ? amount * numberOfInstallments : amount;
    interest = total - principal;
    if (amount > 0 && principal > 0 && interest < 0) {
      errors.push(
        input.paymentType === 'daily'
          ? 'Daily amount × number of days is less than the principal.'
          : 'Amount to pay back is less than the principal.',
      );
    } else if (amount > 0 && principal > 0 && interest === 0) {
      warnings.push('Total payable equals the principal, so there is no interest.');
    }
  }

  const effectiveRatePercent = principal > 0 ? (interest / principal) * 100 : 0;
  const { regular, last } = splitAmount(Math.max(0, total), numberOfInstallments);

  return {
    interestCentavos: interest,
    totalPayableCentavos: total,
    numberOfInstallments,
    installmentCentavos: regular,
    lastInstallmentCentavos: last,
    ratePercent,
    effectiveRatePercent,
    errors,
    warnings,
  };
}

/** Splits centavos into n parts; the remainder goes on the last part so the sum is exact. */
export function splitAmount(totalCentavos: number, n: number): { regular: number; last: number } {
  const regular = Math.floor(totalCentavos / n);
  return { regular, last: totalCentavos - regular * (n - 1) };
}

// ───────────────────────── Schedule ─────────────────────────

export interface ScheduleRow {
  installmentNumber: number;
  dueDate: string;
  amountDueCentavos: number;
}

/**
 * Builds the installment rows.
 *  - daily: first due = startDate + DAILY_FIRST_DUE_OFFSET_DAYS, one per day; Sundays are
 *    skipped entirely (not counted) when skipSundays is on.
 *  - lump_sum: one row due on startDate + term days for the full amount.
 *
 * Example: start Fri 2026-10-02, 3 daily, skip Sundays -> Sat 10-03, Mon 10-05, Tue 10-06.
 */
export function generateSchedule(
  startDate: string,
  paymentType: PaymentType,
  numberOfInstallments: number,
  skipSundays: boolean,
  totalPayableCentavos: number,
  /** Lump sum only: days from start to the due date. */
  lumpSumTermDays = 0,
): ScheduleRow[] {
  if (paymentType === 'lump_sum') {
    return [
      {
        installmentNumber: 1,
        dueDate: addDays(startDate, lumpSumTermDays),
        amountDueCentavos: totalPayableCentavos,
      },
    ];
  }

  const { regular, last } = splitAmount(totalPayableCentavos, numberOfInstallments);
  const rows: ScheduleRow[] = [];
  let date = addDays(startDate, DAILY_FIRST_DUE_OFFSET_DAYS);
  while (rows.length < numberOfInstallments) {
    if (!(skipSundays && isSunday(date))) {
      const n = rows.length + 1;
      rows.push({
        installmentNumber: n,
        dueDate: date,
        amountDueCentavos: n === numberOfInstallments ? last : regular,
      });
    }
    date = addDays(date, 1);
  }
  return rows;
}

/** Formats a percent for display: 20 -> "20%", 15.5 -> "15.5%", 33.3333 -> "33.33%". */
export function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

// ───────────────────────── Profit check ─────────────────────────

/**
 * Profit per month above this % is flagged as unusually high, so the lender double-checks.
 * For reference, "5-6" (20% over ~40 days) is about 15% a month. Adjust to your own policy.
 */
export const HIGH_MONTHLY_RATE_PERCENT = 30;

/** Whole calendar days from one 'YYYY-MM-DD' to another (DST-safe: compares date parts only). */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  // Date.UTC here only turns the local date parts into a day count; no time zone shift happens.
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      dayMs,
  );
}

/**
 * COLLECTION days strictly after `fromYmd` up to and including `toYmd` (0 if toYmd <= fromYmd),
 * skipping Sundays when `skipSundays`. Used for "how many collection days late" (reliability,
 * src/lib/reliability.ts): due Saturday, paid Monday → 1 (the Sunday between them isn't a
 * collection day); due Oct 5, paid Oct 7 with no Sunday between → 2.
 *
 * Closed-form (not a day-by-day loop): a defaulted loan can be very late, and reliability scans
 * up to 60 installments per borrower, so an O(days-late) loop was measured to turn a 200-
 * borrower scan into several SECONDS. Sundays in (fromYmd, toYmd] are counted directly from the
 * calendar-day span instead.
 */
export function collectionDaysBetween(fromYmd: string, toYmd: string, skipSundays: boolean): number {
  if (toYmd <= fromYmd) return 0;
  const calendarDays = daysBetween(fromYmd, toYmd);
  if (!skipSundays) return calendarDays;
  const fromDow = parseYmd(fromYmd).getDay(); // 0 = Sunday
  // Days from `from` to the first Sunday strictly after it (7 when `from` is itself a Sunday).
  const toFirstSunday = fromDow === 0 ? 7 : 7 - fromDow;
  if (calendarDays < toFirstSunday) return calendarDays; // no Sunday falls in (from, to]
  const sundaysInRange = Math.floor((calendarDays - toFirstSunday) / 7) + 1;
  return calendarDays - sundaysInRange;
}

export type ProfitLevel = 'loss' | 'none' | 'normal' | 'high';

export interface ProfitCheck {
  /** Interest earned; negative means the borrower pays back less than was lent. */
  profitCentavos: number;
  /** Profit as % of the principal, for the whole loan. */
  ratePercent: number;
  /** Same profit spread over 30-day months, to compare loans of different lengths. */
  monthlyRatePercent: number;
  /** Calendar days from the start date to the last due date. */
  durationDays: number;
  level: ProfitLevel;
}

/**
 * How much the lender earns, and whether it looks off.
 * Examples:
 *  - ₱5,000 → ₱6,000 over 40 days: profit ₱1,000, 20%, ≈15%/month, normal
 *  - ₱10,000 → ₱3,000 (₱100 × 30 days): profit -₱7,000 (-70%), loss
 *  - ₱1,000 → ₱2,000 over 30 days: 100%/month, high
 */
export function assessProfit(
  principalCentavos: number,
  totalPayableCentavos: number,
  startDate: string,
  endDate: string,
): ProfitCheck {
  const profit = totalPayableCentavos - principalCentavos;
  const ratePercent = principalCentavos > 0 ? (profit / principalCentavos) * 100 : 0;
  const durationDays = Math.max(1, daysBetween(startDate, endDate));
  const monthlyRatePercent = ratePercent / (durationDays / 30);

  let level: ProfitLevel = 'normal';
  if (profit < 0) level = 'loss';
  else if (profit === 0) level = 'none';
  else if (monthlyRatePercent > HIGH_MONTHLY_RATE_PERCENT) level = 'high';

  return { profitCentavos: profit, ratePercent, monthlyRatePercent, durationDays, level };
}
