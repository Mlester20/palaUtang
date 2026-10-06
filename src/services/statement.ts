import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getStatementData } from '@/db/documents';
import { t } from '@/i18n';
import { todayYmd } from '@/lib/loan';
import {
  buildStatementHtml,
  paperSizeDimensions,
  type StatementOptions,
  type StatementScope,
} from '@/lib/statementHtml';
import { getAppStateSnapshot } from '@/store/app-state';
import { getDocumentSettings } from '@/store/document-settings';

export type StatementShareResult = 'done' | 'empty';

/**
 * Builds the statement PDF (Print.printToFileAsync writes its own temp file in cache) and shares
 * it via expo-sharing — the SAME share-then-delete pattern as src/services/backup.ts / export.ts
 * / receipt.ts, just with expo-print's own temp file instead of one in tempDirectory(). Returns
 * 'empty' instead of generating anything when the borrower has no (non-cancelled) loans.
 */
export async function shareStatement(
  db: SQLiteDatabase,
  scope: StatementScope,
  options: StatementOptions,
): Promise<StatementShareResult> {
  const today = todayYmd();
  const raw = await getStatementData(db, scope, options, today);
  if (!raw || raw.loans.length === 0) return 'empty';

  const profile = getAppStateSnapshot().profile;
  const settings = getDocumentSettings();
  const data = {
    ...raw,
    businessName: profile?.businessName ?? '',
    businessPhone: settings.businessPhone,
    businessAddress: settings.businessAddress,
  };

  const html = buildStatementHtml(data, options, today);
  const { width, height } = paperSizeDimensions(options.paperSize);
  const { uri } = await Print.printToFileAsync({ html, width, height, base64: false });
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `${t('statements.screenTitle')}.pdf`,
      UTI: 'com.adobe.pdf',
    });
  } finally {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
  return 'done';
}
