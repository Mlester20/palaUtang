/**
 * Cash ledger logic. Pure: no database, no React; dates are parameters. Money = integer
 * centavos, dates = local 'YYYY-MM-DD'.
 *
 * CASH ON HAND is DERIVED, never stored. For movements dated from the ledger start date up to
 * the as-of date (future-dated rows are ignored):
 *     opening + capital in + cash collected − cash released for loans
 *     − owner withdrawals − business expenses ± cash count adjustments
 *  - cash collected = active payments EXCLUDING netted settlements (isCashPayment below; the
 *    same rule in SQL is cashPaymentCondition in src/db/cash-collected.ts);
 *  - cash released = derived from the loans table, dated loan.start_date, cancelled loans
 *    excluded: the principal, or for a renewal whose old loan was settled with a NETTED
 *    settlement, principal − that settlement (only the difference leaves the pocket).
 * Because collections and releases are derived, voiding a payment or cancelling a loan changes
 * cash on hand by itself; there are no "loan release" rows to keep in sync.
 *
 * PROFIT: net profit = interest earned − business expenses. Owner withdrawals are the owner
 * taking money out (personal use, bills, getting capital back); they lower cash on hand but are
 * NEVER a business cost, so they never reduce profit.
 *
 * Worked examples (ledger start Oct 1):
 *  A. Opening ₱20,000; a ₱5,000 loan starting Oct 1 → 20,000 − 5,000 = ₱15,000.
 *  B. Same day: ₱3,000 collected, ₱500 personal withdrawal, ₱100 fuel expense
 *     → 15,000 + 3,000 − 500 − 100 = ₱17,400.
 *  C. Interest earned ₱700 in that period → net profit 700 − 100 = ₱600 (the ₱500 withdrawal
 *     doesn't change it).
 *  D. Renewal: old balance ₱2,250 settled NETTED, new principal ₱5,000 → released ₱2,750; the
 *     ₱2,250 is not cash collected either, so cash on hand falls by exactly ₱2,750.
 *  E. Cancelling an unpaid loan removes its release (cash back up); voiding a ₱150 payment
 *     removes it from collected (cash down ₱150).
 *  F. Voiding a withdrawal adds it back; the voided row stays visible with its reason.
 *  H. Count: expected ₱17,400, counted ₱17,250 → adjustment ₱150 OUT → ₱17,250. Equal → none.
 *  I. Entries dated before the ledger start or in the future are rejected; payments and loans
 *     dated before the start simply aren't counted.
 */

// ───────────────────────── Kinds & categories ─────────────────────────

export type CashKind = 'opening' | 'capital_in' | 'withdrawal' | 'expense' | 'adjustment';
export type CashDirection = 'in' | 'out';
export type CashEntryStatus = 'active' | 'voided';

export const CASH_KINDS: readonly CashKind[] = [
  'opening',
  'capital_in',
  'withdrawal',
  'expense',
  'adjustment',
];

/** Owner taking money out: NOT a business cost. */
export const WITHDRAWAL_CATEGORIES = ['personal', 'bills', 'capital_return', 'other'] as const;
/** Business costs: reduce net profit. */
export const EXPENSE_CATEGORIES = [
  'transport',
  'load_data',
  'collector_pay',
  'supplies',
  'other',
] as const;

export type WithdrawalCategory = (typeof WITHDRAWAL_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Valid categories for a kind ([] = the kind takes no category). */
export function categoriesFor(kind: CashKind): readonly string[] {
  if (kind === 'withdrawal') return WITHDRAWAL_CATEGORIES;
  if (kind === 'expense') return EXPENSE_CATEGORIES;
  return [];
}

/** Fixed direction per kind; null = either (adjustment). */
export function fixedDirection(kind: CashKind): CashDirection | null {
  if (kind === 'opening' || kind === 'capital_in') return 'in';
  if (kind === 'withdrawal' || kind === 'expense') return 'out';
  return null;
}

/** ₱10,000,000.00: anything bigger is almost certainly a typo. */
export const MAX_CASH_AMOUNT = 1_000_000_000;

/** The JavaScript twin of cashPaymentCondition (src/db/cash-collected.ts). */
export function isCashPayment(payment: { status: string; isNetted: boolean }): boolean {
  return payment.status === 'active' && !payment.isNetted;
}

// ───────────────────────── Validation ─────────────────────────

export type CashEntryError =
  | 'notSetUp'
  | 'kindInvalid'
  | 'directionInvalid'
  | 'categoryInvalid'
  | 'amountInvalid'
  | 'amountTooLarge'
  | 'beforeStart'
  | 'futureDate';

export interface CashEntryInput {
  kind: CashKind;
  /** Required for 'adjustment'; ignored (fixed) for the other kinds. */
  direction?: CashDirection;
  category?: string | null;
  amount: number;
  entryDate: string;
  note?: string | null;
}

export function validateEntryDate(
  entryDate: string,
  ledgerStartDate: string | null,
  today: string,
): CashEntryError[] {
  const errors: CashEntryError[] = [];
  if (ledgerStartDate === null) errors.push('notSetUp');
  else if (entryDate < ledgerStartDate) errors.push('beforeStart');
  if (entryDate > today) errors.push('futureDate');
  return errors;
}

export function validateAmount(amount: number, allowZero = false): CashEntryError[] {
  if (!Number.isSafeInteger(amount) || amount < 0 || (!allowZero && amount === 0)) {
    return ['amountInvalid'];
  }
  return amount > MAX_CASH_AMOUNT ? ['amountTooLarge'] : [];
}

/** Every rule for a manual entry (opening rows are made by setupCash, not here). */
export function validateCashEntry(
  input: CashEntryInput,
  ledgerStartDate: string | null,
  today: string,
): CashEntryError[] {
  const errors: CashEntryError[] = [];
  if (!CASH_KINDS.includes(input.kind) || input.kind === 'opening') errors.push('kindInvalid');
  const fixed = CASH_KINDS.includes(input.kind) ? fixedDirection(input.kind) : null;
  if (input.kind === 'adjustment' && input.direction !== 'in' && input.direction !== 'out') {
    errors.push('directionInvalid');
  }
  if (fixed && input.direction && input.direction !== fixed) errors.push('directionInvalid');
  const allowed = CASH_KINDS.includes(input.kind) ? categoriesFor(input.kind) : [];
  const category = input.category ?? null;
  if (allowed.length > 0 ? category === null || !allowed.includes(category) : category !== null) {
    errors.push('categoryInvalid');
  }
  errors.push(...validateAmount(input.amount));
  errors.push(...validateEntryDate(input.entryDate, ledgerStartDate, today));
  return errors;
}

/** The direction actually stored for an entry. */
export function resolveDirection(input: Pick<CashEntryInput, 'kind' | 'direction'>): CashDirection {
  return fixedDirection(input.kind) ?? input.direction ?? 'in';
}

// ───────────────────────── Cash on hand ─────────────────────────

export interface CashParts {
  opening: number;
  capitalIn: number;
  collected: number;
  released: number;
  withdrawals: number;
  expenses: number;
  adjustmentsIn: number;
  adjustmentsOut: number;
}

export const EMPTY_PARTS: CashParts = {
  opening: 0,
  capitalIn: 0,
  collected: 0,
  released: 0,
  withdrawals: 0,
  expenses: 0,
  adjustmentsIn: 0,
  adjustmentsOut: 0,
};

export function computeCashOnHand(p: CashParts): number {
  return (
    p.opening +
    p.capitalIn +
    p.collected -
    p.released -
    p.withdrawals -
    p.expenses +
    p.adjustmentsIn -
    p.adjustmentsOut
  );
}

/** Adds one manual entry's amount to the right part. */
export function addEntryToParts(
  parts: CashParts,
  entry: { kind: CashKind; direction: CashDirection; amount: number },
): CashParts {
  const next = { ...parts };
  switch (entry.kind) {
    case 'opening':
      next.opening += entry.amount;
      break;
    case 'capital_in':
      next.capitalIn += entry.amount;
      break;
    case 'withdrawal':
      next.withdrawals += entry.amount;
      break;
    case 'expense':
      next.expenses += entry.amount;
      break;
    default:
      if (entry.direction === 'in') next.adjustmentsIn += entry.amount;
      else next.adjustmentsOut += entry.amount;
  }
  return next;
}

/**
 * Cash that left the pocket for a loan: 0 if cancelled; principal − the old loan's NETTED
 * settlement for a renewal (never below 0); the principal otherwise.
 */
export function computeLoanRelease(
  loan: { principal: number; status: string },
  nettedSettlementAmount: number | null,
): number {
  if (loan.status === 'cancelled') return 0;
  return Math.max(0, loan.principal - (nettedSettlementAmount ?? 0));
}

/** Withdrawals are deliberately NOT a parameter: they are never a business cost. */
export function computeNetProfit(interestEarned: number, businessExpenses: number): number {
  return interestEarned - businessExpenses;
}

/** Cash count: positive difference = more cash than expected (adjustment IN). */
export function cashCountDifference(expected: number, counted: number) {
  const difference = counted - expected;
  return {
    difference,
    direction: (difference >= 0 ? 'in' : 'out') as CashDirection,
    amount: Math.abs(difference),
  };
}

// ───────────────────────── Ledger timeline ─────────────────────────

export interface CashEntry {
  id: number;
  kind: CashKind;
  direction: CashDirection;
  category: string | null;
  amount: number;
  entryDate: string;
  note: string | null;
  status: CashEntryStatus;
  voidReason: string | null;
  createdAt: string;
}

export interface LoanRelease {
  loanId: number;
  borrowerName: string;
  startDate: string;
  principal: number;
  /** The old loan's netted settlement, for a renewal (else null). */
  nettedAmount: number | null;
  /** Cash that actually left (computeLoanRelease). */
  amount: number;
}

export type LedgerItem =
  | { type: 'collection'; key: string; date: string; amount: number; count: number }
  | { type: 'release'; key: string; release: LoanRelease }
  | { type: 'entry'; key: string; entry: CashEntry };

export interface LedgerDay {
  date: string;
  /** Money in that day (collections, opening, capital, adjustments in). */
  dayIn: number;
  /** Money out that day (releases, withdrawals, expenses, adjustments out). */
  dayOut: number;
  collected: number;
  /** Cash on hand at the end of the day. */
  balance: number;
  /** Newest entry first; collections and releases before manual entries. */
  items: LedgerItem[];
}

/**
 * Groups a range's movements by day, newest day first, with the running cash on hand after
 * each day. `balanceBefore` = cash on hand at the end of the day before the range. Voided
 * entries are listed (struck through in the UI) but never counted.
 */
export function buildLedger({
  balanceBefore,
  collections,
  releases,
  entries,
}: {
  balanceBefore: number;
  collections: { date: string; amount: number; count: number }[];
  releases: LoanRelease[];
  entries: CashEntry[];
}): LedgerDay[] {
  const days = new Map<string, LedgerDay>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { date, dayIn: 0, dayOut: 0, collected: 0, balance: 0, items: [] };
      days.set(date, d);
    }
    return d;
  };
  for (const c of collections) {
    if (c.amount <= 0) continue;
    const d = day(c.date);
    d.collected += c.amount;
    d.dayIn += c.amount;
    d.items.push({ type: 'collection', key: `c-${c.date}`, ...c });
  }
  for (const r of releases) {
    const d = day(r.startDate);
    d.dayOut += r.amount;
    d.items.push({ type: 'release', key: `r-${r.loanId}`, release: r });
  }
  for (const e of [...entries].sort((a, b) => b.id - a.id)) {
    const d = day(e.entryDate);
    if (e.status === 'active') {
      if (e.direction === 'in') d.dayIn += e.amount;
      else d.dayOut += e.amount;
    }
    d.items.push({ type: 'entry', key: `e-${e.id}`, entry: e });
  }
  const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  let balance = balanceBefore;
  for (const d of ordered) {
    balance += d.dayIn - d.dayOut;
    d.balance = balance;
  }
  return ordered.reverse();
}

/** The parts that moved inside a ledger range (for the Cash screen's range summary). */
export function partsFromLedger(days: LedgerDay[]): CashParts {
  let parts = { ...EMPTY_PARTS };
  for (const d of days) {
    parts.collected += d.collected;
    for (const item of d.items) {
      if (item.type === 'release') parts.released += item.release.amount;
      else if (item.type === 'entry' && item.entry.status === 'active') {
        parts = addEntryToParts(parts, item.entry);
      }
    }
  }
  return parts;
}
