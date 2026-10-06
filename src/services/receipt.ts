import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Share } from 'react-native';

import { getReceiptData } from '@/db/documents';
import {
  buildReceiptText,
  computeAppliedBreakdown,
  computeBalanceAsOfPayment,
  receiptNumber,
  type ReceiptData,
  type ReceiptKind,
} from '@/lib/receipt';
import { getAppStateSnapshot } from '@/store/app-state';
import { getDocumentSettings } from '@/store/document-settings';

/**
 * Loads one payment's full ReceiptData (DB fields via src/db/documents.ts, combined with the
 * business profile and receipt settings from kv-store). Returns null for a missing OR voided
 * payment: a voided payment's allocations are already gone (recomputeInTransaction clears them),
 * so there is nothing truthful left to show.
 */
export async function loadReceiptData(
  db: SQLiteDatabase,
  paymentId: number,
): Promise<ReceiptData | null> {
  const row = await getReceiptData(db, paymentId);
  if (!row || row.paymentStatus !== 'active') return null;

  const isActiveSettlement = row.paymentType === 'settlement';
  const applied = computeAppliedBreakdown(row.allocations, row.paidOn);
  const { totalPaid, balance } = computeBalanceAsOfPayment({
    totalPayable: row.totalPayable,
    totalPaidUpToAndIncluding: row.totalPaidUpToAndIncluding,
    isActiveSettlement,
    discountAmount: row.discountAmount,
  });

  const kind: ReceiptKind =
    row.paymentType === 'settlement' ? (row.isNetted ? 'settlementNetted' : 'settlement') : 'regular';
  const settings = getDocumentSettings();
  const profile = getAppStateSnapshot().profile;

  return {
    receiptNo: receiptNumber(paymentId),
    businessName: profile?.businessName ?? '',
    businessPhone: settings.businessPhone,
    businessAddress: settings.businessAddress,
    paidOn: row.paidOn,
    borrowerName: row.borrowerName,
    loanId: row.loanId,
    loanPrincipal: row.loanPrincipal,
    amountReceived: row.amountReceived,
    kind,
    applied,
    totalPaid,
    balance,
    discountAmount: isActiveSettlement ? row.discountAmount : 0,
  };
}

/** "Share as text": the system share sheet with no attachment (SMS/Messenger-friendly). */
export async function shareReceiptAsText(data: ReceiptData) {
  const text = buildReceiptText(data, getDocumentSettings());
  await Share.share({ message: text });
}

/** "Copy as text": to the clipboard. Returns the text that was copied (for a confirmation toast). */
export async function copyReceiptAsText(data: ReceiptData): Promise<string> {
  const text = buildReceiptText(data, getDocumentSettings());
  await Clipboard.setStringAsync(text);
  return text;
}

/**
 * Shares an already-captured receipt PNG (captureRef's own tmpfile) via the system share sheet,
 * then deletes it. Capturing itself happens in the UI (it needs a component ref); this just
 * follows the same share-then-delete pattern as src/services/backup.ts / export.ts.
 */
export async function shareReceiptPng(uri: string, receiptNo: string) {
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: `${receiptNo}.png`,
      UTI: 'public.png',
    });
  } finally {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}
