import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { buildEodText, type EodReportData } from '@/lib/eodReport';

/**
 * Share/copy helpers, same share-then-delete pattern as src/services/receipt.ts. Device
 * authentication (App Lock) is gated in the screen (src/app/eod.tsx), same convention as
 * src/app/cash/index.tsx's confirmVoid and Settings' confirmReset — these functions assume the
 * caller already confirmed the owner.
 */

export async function shareEodAsText(data: EodReportData) {
  await Share.share({ message: buildEodText(data) });
}

/** Returns the copied text (for a confirmation toast). */
export async function copyEodAsText(data: EodReportData): Promise<string> {
  const text = buildEodText(data);
  await Clipboard.setStringAsync(text);
  return text;
}

/** Shares an already-captured report PNG (captureRef's own tmpfile), then deletes it. */
export async function shareEodPng(uri: string) {
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: 'EndOfDayReport.png',
      UTI: 'public.png',
    });
  } finally {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}
