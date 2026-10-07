import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import { todayYmd } from '@/lib/loan';
import type { PaperSize } from '@/lib/statementHtml';
import { useThemeColors } from '@/lib/theme';
import {
  setPaperSize as persistPaperSize,
  setShowInterest as persistShowInterest,
  useDocumentSettings,
} from '@/store/document-settings';

type StatementOptionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Runs the actual build + share; throwing shows an error, resolving 'empty' shows the empty message. */
  onGenerate: (options: {
    includePayments: boolean;
    includeSchedule: boolean;
    showInterest: boolean;
    paymentsFromDate: string | null;
    paperSize: PaperSize;
  }) => Promise<'done' | 'empty'>;
};

/** Options sheet shared by Borrower "Share statement" and Loan "Share loan statement". */
export function StatementOptionsSheet({ visible, onClose, onGenerate }: StatementOptionsSheetProps) {
  const colors = useThemeColors();
  const settings = useDocumentSettings();
  const [includePayments, setIncludePayments] = useState(true);
  const [includeSchedule, setIncludeSchedule] = useState(false);
  const [showInterest, setShowInterest] = useState(settings.showInterest);
  const [paperSize, setPaperSize] = useState<PaperSize>(settings.paperSize);
  const [fromDateEnabled, setFromDateEnabled] = useState(false);
  const [fromDate, setFromDate] = useState(todayYmd());
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      persistShowInterest(showInterest);
      persistPaperSize(paperSize);
      const result = await onGenerate({
        includePayments,
        includeSchedule,
        showInterest,
        paymentsFromDate: includePayments && fromDateEnabled ? fromDate : null,
        paperSize,
      });
      if (result === 'empty') {
        Alert.alert(t('statements.noLoansTitle'), t('statements.noLoansMessage'));
      } else {
        onClose();
      }
    } catch (error) {
      showError(t('statements.shareFailed'), error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} locked={busy}>
      <View className="gap-4 py-1">
        <Text className="text-xl font-bold text-slate-900 dark:text-white">
          {t('statements.optionsTitle')}
        </Text>

        <ToggleRow
          label={t('statements.includePayments')}
          value={includePayments}
          onValueChange={setIncludePayments}
          colors={colors}
        />
        {includePayments && (
          <View className="gap-2 pl-2">
            <ToggleRow
              label={t('statements.paymentsFromDate')}
              value={fromDateEnabled}
              onValueChange={setFromDateEnabled}
              colors={colors}
            />
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {t('statements.paymentsFromHint')}
            </Text>
            {fromDateEnabled && (
              <DateField label={t('statements.paymentsFromDate')} value={fromDate} onChange={setFromDate} />
            )}
          </View>
        )}
        <ToggleRow
          label={t('statements.includeSchedule')}
          value={includeSchedule}
          onValueChange={setIncludeSchedule}
          colors={colors}
        />
        <ToggleRow
          label={t('statements.showInterest')}
          value={showInterest}
          onValueChange={setShowInterest}
          colors={colors}
        />

        <SegmentedControl
          label={t('statements.paperSize')}
          value={paperSize}
          onChange={setPaperSize}
          options={[
            { value: 'A4', label: t('statements.paperA4') },
            { value: 'Letter', label: t('statements.paperLetter') },
          ]}
        />

        <Pressable
          onPress={generate}
          disabled={busy}
          accessibilityRole="button"
          className={
            busy
              ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 opacity-50 dark:bg-teal-500'
              : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500'
          }>
          {busy && <ActivityIndicator color="#ffffff" />}
          <Text className="text-lg font-bold text-white">
            {busy ? t('statements.generating') : t('statements.generate')}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
  colors,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View className="min-h-12 flex-row items-center justify-between gap-4">
      <Text className="flex-1 text-base text-slate-900 dark:text-white">{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.primary, false: colors.switchTrackOff }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

