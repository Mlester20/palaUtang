import type { SQLiteDatabase } from 'expo-sqlite';

import { isoToLocalStamp } from '@/lib/backup';
import { money, type CsvValue } from '@/lib/csv';

/**
 * CSV datasets. Rows are read in CHUNKS by id (keyset paging: WHERE id > last ORDER BY id
 * LIMIT n), so thousands of rows never load or block at once. Voided rows and status columns
 * are included so nothing is hidden. Joined, readable fields sit next to the ids.
 */

export type ExportDataset = 'borrowers' | 'loans' | 'installments' | 'payments' | 'cash';

export const CHUNK_SIZE = 500;

export interface DatasetSpec {
  header: string[];
  /** Date column used by the optional range (payments, cash only). */
  ranged: boolean;
  /** One chunk of rows after `afterId`; returns [] when done. */
  fetchChunk: (
    db: SQLiteDatabase,
    afterId: number,
    range: { from: string; to: string } | null,
  ) => Promise<{ lastId: number; rows: CsvValue[][] }>;
}

const loanRef = (id: number | null) => (id === null ? null : `L-${id}`);

function chunk<T extends { id: number }>(rows: T[], map: (r: T) => CsvValue[]) {
  return { lastId: rows.length ? rows[rows.length - 1]!.id : -1, rows: rows.map(map) };
}

export const DATASETS: Record<ExportDataset, DatasetSpec> = {
  borrowers: {
    header: ['Borrower ID', 'Full name', 'Nickname', 'Phone', 'Address', 'Notes', 'Status', 'Archived at', 'Added at'],
    ranged: false,
    fetchChunk: async (db, afterId) =>
      chunk(
        await db.getAllAsync<{
          id: number; full_name: string; nickname: string | null; phone: string | null;
          address: string | null; notes: string | null; archived_at: string | null; created_at: string;
        }>(
          `SELECT id, full_name, nickname, phone, address, notes, archived_at, created_at
           FROM borrowers WHERE id > ? ORDER BY id LIMIT ?`,
          [afterId, CHUNK_SIZE],
        ),
        (r) => [r.id, r.full_name, r.nickname, r.phone, r.address, r.notes,
          r.archived_at ? 'archived' : 'active', isoToLocalStamp(r.archived_at), isoToLocalStamp(r.created_at)],
      ),
  },
  loans: {
    header: ['Loan ref', 'Borrower ID', 'Borrower', 'Principal', 'Interest', 'Total payable', 'Paid (active)',
      'Balance', 'Discount', 'Payment type', 'Installments', 'Installment amount', 'Start date', 'End date',
      'Skip Sundays', 'Status', 'Closed early on', 'Settlement mode', 'Renewed from', 'Notes'],
    ranged: false,
    fetchChunk: async (db, afterId) =>
      chunk(
        await db.getAllAsync<{
          id: number; borrower_id: number; borrower_name: string; principal: number; interest_amount: number;
          total_payable: number; paid: number; discount_amount: number; payment_type: string;
          number_of_installments: number; installment_amount: number; start_date: string; end_date: string;
          skip_sundays: number; status: string; closed_at: string | null; settlement_mode: string | null;
          renewed_from_loan_id: number | null; notes: string | null;
        }>(
          `SELECT l.id, l.borrower_id, b.full_name AS borrower_name, l.principal, l.interest_amount,
                  l.total_payable,
                  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                   WHERE p.loan_id = l.id AND +p.status = 'active') AS paid,
                  l.discount_amount, l.payment_type, l.number_of_installments, l.installment_amount,
                  l.start_date, l.end_date, l.skip_sundays, l.status, l.closed_at, l.settlement_mode,
                  l.renewed_from_loan_id, l.notes
           FROM loans l JOIN borrowers b ON b.id = l.borrower_id
           WHERE l.id > ? ORDER BY l.id LIMIT ?`,
          [afterId, CHUNK_SIZE],
        ),
        (r) => [loanRef(r.id), r.borrower_id, r.borrower_name, money(r.principal), money(r.interest_amount),
          money(r.total_payable), money(r.paid),
          money(r.status === 'cancelled' ? 0 : Math.max(0, r.total_payable - r.paid - r.discount_amount)),
          money(r.discount_amount), r.payment_type, r.number_of_installments, money(r.installment_amount),
          r.start_date, r.end_date, r.skip_sundays === 1, r.status, r.closed_at, r.settlement_mode,
          loanRef(r.renewed_from_loan_id), r.notes],
      ),
  },
  installments: {
    header: ['Installment ID', 'Loan ref', 'Borrower', 'No.', 'Due date', 'Original due date', 'Amount due',
      'Amount paid', 'Waived', 'Status', 'Make-up day'],
    ranged: false,
    fetchChunk: async (db, afterId) =>
      chunk(
        await db.getAllAsync<{
          id: number; loan_id: number; borrower_name: string; installment_number: number; due_date: string;
          original_due_date: string; amount_due: number; amount_paid: number; waived_amount: number;
          status: string; is_makeup: number;
        }>(
          `SELECT i.id, i.loan_id, b.full_name AS borrower_name, i.installment_number, i.due_date,
                  i.original_due_date, i.amount_due, i.amount_paid, i.waived_amount, i.status, i.is_makeup
           FROM installments i JOIN loans l ON l.id = i.loan_id JOIN borrowers b ON b.id = l.borrower_id
           WHERE i.id > ? ORDER BY i.id LIMIT ?`,
          [afterId, CHUNK_SIZE],
        ),
        (r) => [r.id, loanRef(r.loan_id), r.borrower_name, r.installment_number, r.due_date,
          r.original_due_date, money(r.amount_due), money(r.amount_paid), money(r.waived_amount), r.status,
          r.is_makeup === 1],
      ),
  },
  payments: {
    header: ['Payment ID', 'Paid on', 'Loan ref', 'Borrower', 'Amount', 'Type', 'Cash or netted', 'Status',
      'Void reason', 'Voided at', 'Note', 'Entered at'],
    ranged: true,
    fetchChunk: async (db, afterId, range) =>
      chunk(
        await db.getAllAsync<{
          id: number; paid_on: string; loan_id: number; borrower_name: string; amount: number; type: string;
          is_netted: number; status: string; void_reason: string | null; voided_at: string | null;
          note: string | null; created_at: string;
        }>(
          `SELECT p.id, p.paid_on, p.loan_id, b.full_name AS borrower_name, p.amount, p.type, p.is_netted,
                  p.status, p.void_reason, p.voided_at, p.note, p.created_at
           FROM payments p JOIN loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id
           WHERE p.id > $after AND ($from IS NULL OR p.paid_on BETWEEN $from AND $to)
           ORDER BY p.id LIMIT $limit`,
          { $after: afterId, $from: range?.from ?? null, $to: range?.to ?? null, $limit: CHUNK_SIZE },
        ),
        (r) => [r.id, r.paid_on, loanRef(r.loan_id), r.borrower_name, money(r.amount),
          r.type === 'settlement' ? 'early payoff' : 'regular', r.is_netted === 1 ? 'netted' : 'cash', r.status,
          r.void_reason, isoToLocalStamp(r.voided_at), r.note, isoToLocalStamp(r.created_at)],
      ),
  },
  cash: {
    header: ['Entry ID', 'Date', 'Kind', 'Direction', 'Category', 'Amount', 'Note', 'Status', 'Void reason',
      'Voided at', 'Entered at'],
    ranged: true,
    fetchChunk: async (db, afterId, range) =>
      chunk(
        await db.getAllAsync<{
          id: number; entry_date: string; kind: string; direction: string; category: string | null;
          amount: number; note: string | null; status: string; void_reason: string | null;
          voided_at: string | null; created_at: string;
        }>(
          `SELECT id, entry_date, kind, direction, category, amount, note, status, void_reason, voided_at,
                  created_at
           FROM cash_entries
           WHERE id > $after AND ($from IS NULL OR entry_date BETWEEN $from AND $to)
           ORDER BY id LIMIT $limit`,
          { $after: afterId, $from: range?.from ?? null, $to: range?.to ?? null, $limit: CHUNK_SIZE },
        ),
        (r) => [r.id, r.entry_date, r.kind, r.direction, r.category, money(r.amount), r.note, r.status,
          r.void_reason, isoToLocalStamp(r.voided_at), isoToLocalStamp(r.created_at)],
      ),
  },
};
