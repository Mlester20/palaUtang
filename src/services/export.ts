import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DATASETS, type ExportDataset } from '@/db/export';
import { csvFileName } from '@/lib/backup';
import { CSV_BOM, csvRow } from '@/lib/csv';

import { tempDirectory } from './backup';

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Writes one dataset as a CSV into the temp folder chunk by chunk (append), shares it, and
 * always deletes the file afterwards. Returns the number of data rows.
 */
export async function exportCsv(
  db: SQLiteDatabase,
  dataset: ExportDataset,
  range: { from: string; to: string } | null,
  now = new Date(),
): Promise<number> {
  const spec = DATASETS[dataset];
  const dir = tempDirectory();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, csvFileName(dataset, now));
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(CSV_BOM + csvRow(spec.header));
    let afterId = 0;
    let total = 0;
    for (;;) {
      const { lastId, rows } = await spec.fetchChunk(db, afterId, spec.ranged ? range : null);
      if (rows.length === 0) break;
      file.write(rows.map(csvRow).join(''), { append: true });
      total += rows.length;
      afterId = lastId;
      await yieldToUi(); // keep the spinner moving on big exports
    }
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: file.name, UTI: 'public.comma-separated-values-text' });
    return total;
  } finally {
    if (file.exists) file.delete();
  }
}
