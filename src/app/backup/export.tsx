import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmOwnerOrExplain, confirmPrivacy, dataErrorText } from '@/components/backup/backup-actions';
import { DateField } from '@/components/DateField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { DATASETS, type ExportDataset } from '@/db/export';
import { t, type TranslationKey } from '@/i18n';
import { todayYmd } from '@/lib/loan';
import { lastMonthRange, monthRange, validateCustomRange, type DateRange } from '@/lib/ranges';
import { useThemeColors } from '@/lib/theme';
import { exportCsv } from '@/services/export';
import { runDataOperation, useDataOperation } from '@/store/backup-state';

const DATASET_LABEL: Record<ExportDataset, TranslationKey> = {
  borrowers: 'backup.dsBorrowers',
  loans: 'backup.dsLoans',
  installments: 'backup.dsInstallments',
  payments: 'backup.dsPayments',
  cash: 'backup.dsCash',
};

type RangePreset = 'thisMonth' | 'lastMonth' | 'all' | 'custom';

/** CSV export: one dataset per file, shared one at a time. */
export default function ExportScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const operation = useDataOperation();
  const [dataset, setDataset] = useState<ExportDataset>('payments');
  const [preset, setPreset] = useState<RangePreset>('all');
  const [today] = useState(todayYmd);
  const [custom, setCustom] = useState<DateRange>(() => ({ from: monthRange(todayYmd()).from, to: todayYmd() }));

  const ranged = DATASETS[dataset].ranged;
  const customError = ranged && preset === 'custom' ? validateCustomRange(custom, today) : null;

  const rangeFor = (): DateRange | null => {
    if (!ranged || preset === 'all') return null;
    if (preset === 'thisMonth') return monthRange(today);
    if (preset === 'lastMonth') return lastMonthRange(today);
    return custom;
  };

  const run = async () => {
    if (operation !== null || customError) return;
    if (!(await confirmPrivacy())) return;
    if (!(await confirmOwnerOrExplain())) return;
    try {
      const rows = await runDataOperation('export', () => exportCsv(db, dataset, rangeFor()));
      Alert.alert(t('backup.exportDoneTitle'), t('backup.exportDoneMessage', { count: rows }));
    } catch (error) {
      console.error('[Export failed]', error instanceof Error ? error.message : 'unknown');
      Alert.alert(t('backup.failedTitle'), dataErrorText(error));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerClassName="gap-5 p-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <Text className="text-base text-slate-700 dark:text-slate-200">{t('backup.exportIntro')}</Text>

      <View className="gap-2" accessibilityRole="radiogroup">
        {(Object.keys(DATASET_LABEL) as ExportDataset[]).map((key) => {
          const selected = key === dataset;
          return (
            <Pressable
              key={key}
              onPress={() => setDataset(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`min-h-14 flex-row items-center gap-3 rounded-2xl px-4 ${
                selected ? 'border-2 border-teal-700 bg-teal-50 dark:border-teal-400 dark:bg-teal-950' : 'bg-white dark:bg-slate-900'
              }`}>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={24}
                color={selected ? colors.primary : colors.textMuted}
              />
              <Text className="text-lg font-semibold text-slate-900 dark:text-white">{t(DATASET_LABEL[key])}</Text>
            </Pressable>
          );
        })}
      </View>

      {ranged && (
        <View className="gap-3">
          <SegmentedControl
            label={t('backup.rangeLabel')}
            value={preset}
            onChange={setPreset}
            options={[
              { value: 'thisMonth', label: t('backup.rangeThisMonth') },
              { value: 'lastMonth', label: t('backup.rangeLastMonth') },
              { value: 'all', label: t('backup.rangeAll') },
              { value: 'custom', label: t('backup.rangeCustom') },
            ]}
          />
          {preset === 'custom' && (
            <View className="gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
              <DateField label={t('reports.from')} value={custom.from} maxDate={today} onChange={(from) => setCustom((c) => ({ ...c, from }))} />
              <DateField label={t('reports.to')} value={custom.to} maxDate={today} onChange={(to) => setCustom((c) => ({ ...c, to }))} />
              {customError && (
                <Text className="text-base font-semibold text-red-600 dark:text-red-400">
                  {customError === 'futureDate' ? t('reports.errorFuture') : t('reports.errorFromAfterTo')}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={run}
        disabled={operation !== null || customError !== null}
        accessibilityRole="button"
        className={`min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 dark:bg-teal-500 ${
          operation !== null || customError ? 'opacity-50' : 'active:bg-teal-800'
        }`}>
        {operation === 'export' && <ActivityIndicator color="#ffffff" />}
        <Text className="text-lg font-bold text-white">
          {operation === 'export' ? t('backup.exporting') : t('backup.exportButton')}
        </Text>
      </Pressable>
      <Text className="text-sm text-slate-600 dark:text-slate-400">{t('backup.exportNote')}</Text>
    </ScrollView>
  );
}
