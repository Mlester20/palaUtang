import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { InitialsAvatar } from '@/components/dashboard';
import { BorrowerPicker } from '@/components/loans/BorrowerPicker';
import { LoanPreviewCard } from '@/components/loans/LoanPreviewCard';
import { PresetChips } from '@/components/loans/PresetChips';
import { ProfitCheckCard } from '@/components/loans/ProfitCheckCard';
import { SavePresetSheet } from '@/components/loans/SavePresetSheet';
import { SegmentedControl } from '@/components/SegmentedControl';
import { getBorrowerById, getBorrowers } from '@/db/borrowers';
import { getBorrowerFlag } from '@/db/flags';
import { createLoanWithSchedule } from '@/db/loans';
import { getPresets } from '@/db/presets';
import { getBorrowerReliability } from '@/db/reliability';
import { previewSettlement, settleAndRenew } from '@/db/settlement';
import { settleErrorText } from '@/components/loans/settlement-messages';
import { t } from '@/i18n';
import { showError } from '@/lib/errors';
import type { BorrowerFlag } from '@/lib/flags';
import { money } from '@/lib/csv';
import {
  assessProfit,
  computeLoanPreview,
  formatDisplayDate,
  formatPercent,
  generateSchedule,
  LOAN_LIMITS,
  todayYmd,
  type LoanInputMode,
  type PaymentType,
} from '@/lib/loan';
import { formatPeso, parsePesoToCentavos } from '@/lib/money';
import type { LoanPreset } from '@/lib/presets';
import type { ReliabilityResult } from '@/lib/reliability';
import { computeRenewal } from '@/lib/settlement';
import { useThemeColors } from '@/lib/theme';
import { useFlagThresholds } from '@/store/flag-settings';
import type { Borrower } from '@/types/borrower';
import type { SettlementMode } from '@/types/loan';

const SEARCH_DEBOUNCE_MS = 250;

export default function NewLoanScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{
    borrowerId?: string;
    // Renewal (from Settle & Renew): the old loan is settled when THIS form is saved.
    renewedFromLoanId?: string;
    settleDate?: string;
    settleMode?: SettlementMode;
    settleDiscount?: string;
    settleNote?: string;
  }>();
  const fixedBorrowerId = params.borrowerId ? Number(params.borrowerId) : null;
  const renewal = params.renewedFromLoanId
    ? {
        loanId: Number(params.renewedFromLoanId),
        settlementDate: params.settleDate ?? todayYmd(),
        mode: (params.settleMode ?? 'full') as SettlementMode,
        discount: params.settleDiscount ? Number(params.settleDiscount) : undefined,
        note: params.settleNote || null,
      }
    : null;
  const [renewalAmount, setRenewalAmount] = useState<number | null>(null);
  const [renewalCtx, setRenewalCtx] = useState({
    startDate: '',
    latestPaymentDate: null as string | null,
    balance: 0,
  });

  // ── Borrower (fixed from the borrower page, or picked here) ──
  const [borrower, setBorrower] = useState<Borrower | null | undefined>(
    fixedBorrowerId ? undefined : null,
  );
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<Borrower[] | null>(null);

  const renewalKey = renewal ? JSON.stringify(renewal) : '';
  useEffect(() => {
    if (!renewalKey) return;
    const r = JSON.parse(renewalKey) as NonNullable<typeof renewal>;
    previewSettlement(db, r, todayYmd())
      .then((p) => {
        if (!p) return;
        setRenewalAmount(
          p.errors.length === 0 && p.dateErrors.length === 0 ? p.settlementAmount : null,
        );
        setRenewalCtx({
          startDate: '',
          latestPaymentDate: p.latestPaymentDate,
          balance: p.remainingBalance,
        });
      })
      .catch((error) => console.error('[Renewal preview failed]', error));
  }, [db, renewalKey]);

  useEffect(() => {
    if (!fixedBorrowerId) return;
    getBorrowerById(db, fixedBorrowerId)
      .then(setBorrower)
      .catch((error) => {
        console.error('[Load borrower failed]', error);
        setBorrower(null);
      });
  }, [db, fixedBorrowerId]);

  useEffect(() => {
    if (fixedBorrowerId || borrower) return;
    let active = true;
    const timer = setTimeout(() => {
      getBorrowers(db, { search: pickerQuery })
        .then((rows) => active && setPickerResults(rows))
        .catch((error) => {
          console.error('[Load borrowers failed]', error);
          if (active) setPickerResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [db, pickerQuery, fixedBorrowerId, borrower]);

  // ── Loan fields ──
  const [principalText, setPrincipalText] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('daily');
  const [mode, setMode] = useState<LoanInputMode>('rate');
  const [rateText, setRateText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [termText, setTermText] = useState('');
  const [startDate, setStartDate] = useState(todayYmd());
  const [skipSundays, setSkipSundays] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  // ── Presets (PART A2) ──
  const thresholds = useFlagThresholds();
  const [presets, setPresets] = useState<LoanPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  // Whether the CURRENT principal value came from the applied preset (only then does editing
  // it also drop back to Custom; a preset that left the principal open never controls it).
  const [presetControlledPrincipal, setPresetControlledPrincipal] = useState(false);
  const [savePresetVisible, setSavePresetVisible] = useState(false);

  useEffect(() => {
    getPresets(db)
      .then(setPresets)
      .catch((error) => console.error('[Load presets failed]', error));
  }, [db]);

  const applyPreset = (preset: LoanPreset) => {
    setSelectedPresetId(preset.id);
    setPaymentType(preset.paymentType);
    setMode(preset.inputMode);
    setSkipSundays(preset.paymentType === 'daily' ? preset.skipSundays : false);
    setTermText(String(preset.numberOfInstallments));
    setRateText(
      preset.inputMode === 'rate' && preset.interestRate !== null ? String(preset.interestRate) : '',
    );
    setAmountText(
      preset.inputMode === 'installment' && preset.installmentAmount !== null
        ? money(preset.installmentAmount)!.csvNumber
        : '',
    );
    const hasPrincipal = preset.principal !== null;
    setPresetControlledPrincipal(hasPrincipal);
    if (hasPrincipal) setPrincipalText(money(preset.principal!)!.csvNumber);
  };

  /** Any manual edit to a preset-controlled field drops the form back to "Custom". */
  const unapplyPreset = () => setSelectedPresetId(null);

  // ── Borrower reliability / overdue banner (PART B) ──
  const [borrowerFlag, setBorrowerFlag] = useState<BorrowerFlag | null>(null);
  const [borrowerReliability, setBorrowerReliability] = useState<ReliabilityResult | null>(null);
  useEffect(() => {
    let active = true;
    const today = todayYmd();
    // Always resolve through a promise (even the "no borrower" case), so the state update
    // never happens synchronously inside the effect body.
    const task = borrower
      ? Promise.all([
          getBorrowerFlag(db, borrower.id, today, thresholds),
          getBorrowerReliability(db, borrower.id, today, thresholds),
        ])
      : Promise.resolve([null, null] as const);
    task
      .then(([f, r]) => {
        if (!active) return;
        setBorrowerFlag(f);
        setBorrowerReliability(r);
      })
      .catch((error) => console.error('[Load borrower risk info failed]', error));
    return () => {
      active = false;
    };
  }, [db, borrower, thresholds]);

  const isDaily = paymentType === 'daily';
  const principal = parsePesoToCentavos(principalText);
  const term = /^\d+$/.test(termText.trim()) ? Number(termText.trim()) : null;
  const rate = /^\d+(\.\d+)?$/.test(rateText.trim()) ? Number(rateText.trim()) : null;
  const amount = parsePesoToCentavos(amountText);

  const renewalCheck =
    renewal && renewalAmount !== null && principal !== null
      ? computeRenewal({ settlementAmount: renewalAmount, newPrincipal: principal })
      : null;

  const fieldErrors = {
    principal: principal === null ? 'Enter the amount lent, e.g. 5000.' : null,
    term:
      term === null
        ? isDaily
          ? 'Enter the number of daily payments, e.g. 40.'
          : 'Enter how many days until it is due, e.g. 30.'
        : null,
    rate: mode === 'rate' && rate === null ? 'Enter the interest in %, e.g. 20.' : null,
    amount:
      mode === 'installment' && amount === null
        ? isDaily
          ? 'Enter the daily amount, e.g. 150.'
          : 'Enter the amount to pay back, e.g. 5500.'
        : null,
  };
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);

  const preview =
    !hasFieldErrors && principal !== null && term !== null
      ? computeLoanPreview(
          mode === 'rate'
            ? { mode, paymentType, principalCentavos: principal, ratePercent: rate!, term }
            : {
                mode,
                paymentType,
                principalCentavos: principal,
                installmentCentavos: amount!,
                term,
              },
        )
      : null;
  const previewValid = preview !== null && preview.errors.length === 0;
  // Built even when the numbers are wrong (e.g. a loss), so the profit check can still show;
  // saving still requires previewValid.
  const canBuildSchedule =
    preview !== null &&
    term !== null &&
    term >= 1 &&
    term <= LOAN_LIMITS.maxTerm &&
    preview.totalPayableCentavos > 0;
  const schedule =
    canBuildSchedule && preview && term !== null
      ? generateSchedule(
          startDate,
          paymentType,
          preview.numberOfInstallments,
          isDaily && skipSundays,
          preview.totalPayableCentavos,
          term,
        )
      : null;
  const endDate = schedule ? schedule[schedule.length - 1]!.dueDate : null;
  const profit =
    preview && endDate && principal !== null && principal > 0
      ? assessProfit(principal, preview.totalPayableCentavos, startDate, endDate)
      : null;

  // ── Save ──
  const save = async () => {
    if (!borrower || !preview || !schedule || !endDate || principal === null) return;
    const loanInput = {
      principal,
      interestRate: preview.ratePercent,
      interestAmount: preview.interestCentavos,
      totalPayable: preview.totalPayableCentavos,
      paymentType,
      numberOfInstallments: preview.numberOfInstallments,
      installmentAmount: preview.installmentCentavos,
      startDate,
      endDate,
      skipSundays: isDaily && skipSundays,
      notes: notes.trim() || null,
      schedule: schedule.map((row) => ({
        installmentNumber: row.installmentNumber,
        dueDate: row.dueDate,
        amountDue: row.amountDueCentavos,
      })),
    };
    if (renewal && renewalAmount !== null) {
      try {
        // ONE transaction: settle the old loan (netted) + create this one. All or nothing.
        const result = await settleAndRenew(
          db,
          { ...renewal, expectedAmount: renewalAmount },
          loanInput,
          todayYmd(),
        );
        // Drop this form and the Settle screen from the stack, then show the new loan.
        router.dismiss(2);
        router.push({ pathname: '/loan/[id]', params: { id: String(result.newLoanId) } });
        Alert.alert(
          t('settlement.renewalSaved'),
          t('settlement.renewalSavedMessage', { amount: formatPeso(result.cashToRelease) }),
        );
      } catch (error) {
        const text = settleErrorText(error, renewalCtx);
        if (text) Alert.alert(t('settlement.renewalFailed'), text);
        else showError(t('settlement.renewalFailed'), error);
      } finally {
        busy.current = false;
        setSaving(false);
      }
      return;
    }
    try {
      const id = await createLoanWithSchedule(db, {
        borrowerId: borrower.id,
        principal,
        interestRate: preview.ratePercent,
        interestAmount: preview.interestCentavos,
        totalPayable: preview.totalPayableCentavos,
        paymentType,
        numberOfInstallments: preview.numberOfInstallments,
        installmentAmount: preview.installmentCentavos,
        startDate,
        endDate,
        skipSundays: isDaily && skipSundays,
        notes: notes.trim() || null,
        schedule: schedule.map((row) => ({
          installmentNumber: row.installmentNumber,
          dueDate: row.dueDate,
          amountDue: row.amountDueCentavos,
        })),
      });
      // Replace the form so Back from the loan page doesn't return to a stale form.
      router.replace({ pathname: '/loan/[id]', params: { id: String(id) } });
      Alert.alert(
        'Loan created',
        `${formatPeso(principal)} loan for ${borrower.fullName} was saved.`,
      );
    } catch (error) {
      showError('Could not save the loan', error);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const onPressSave = () => {
    setSubmitted(true);
    if (!borrower || hasFieldErrors || !previewValid || !schedule || !endDate || busy.current) {
      return;
    }
    if (renewal && (renewalAmount === null || renewalCheck?.error)) return;
    busy.current = true;
    setSaving(true);

    const lines = [
      `Borrower: ${borrower.fullName}`,
      `Principal: ${formatPeso(principal!)}`,
      `Interest: ${formatPeso(preview.interestCentavos)} (${formatPercent(preview.effectiveRatePercent)})`,
      `Total payable: ${formatPeso(preview.totalPayableCentavos)}`,
      isDaily
        ? `${preview.numberOfInstallments} daily × ${formatPeso(preview.installmentCentavos)}`
        : `Pay once on ${formatDisplayDate(endDate)}`,
      isDaily ? `First due: ${formatDisplayDate(schedule[0]!.dueDate)}` : null,
      isDaily ? `Last due: ${formatDisplayDate(endDate)}` : null,
    ].filter(Boolean);

    Alert.alert(
      'Create this loan?',
      lines.join('\n'),
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            busy.current = false;
            setSaving(false);
          },
        },
        { text: 'Create loan', onPress: save },
      ],
      { cancelable: false },
    );
  };

  // ── Render ──
  if (borrower === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (fixedBorrowerId && (borrower === null || borrower.archivedAt)) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          {borrower
            ? 'This borrower is archived. Restore them first to add a loan.'
            : 'This borrower could not be found.'}
        </Text>
      </View>
    );
  }

  if (!borrower) {
    return (
      <BorrowerPicker
        query={pickerQuery}
        onQueryChange={setPickerQuery}
        borrowers={pickerResults}
        onSelect={setBorrower}
        onAddBorrower={() => router.push('/borrower/new')}
      />
    );
  }

  const previewErrors = preview?.errors ?? [];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="gap-5 p-5" style={{ paddingBottom: insets.bottom + 24 }}>
          {/* Borrower */}
          <View className="flex-row items-center gap-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
            <InitialsAvatar name={borrower.fullName} />
            <View className="flex-1">
              <Text className="text-sm text-slate-500 dark:text-slate-400">Borrower</Text>
              <Text className="text-lg font-bold text-slate-900 dark:text-white" numberOfLines={1}>
                {borrower.fullName}
              </Text>
            </View>
            {!fixedBorrowerId && (
              <Pressable
                onPress={() => setBorrower(null)}
                hitSlop={8}
                accessibilityRole="button"
                className="min-h-12 justify-center px-2 active:opacity-60">
                <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
                  Change
                </Text>
              </Pressable>
            )}
          </View>

          {/* Risky rating or an overdue balance right now — informational, never blocks saving. */}
          {borrowerReliability?.tier === 'risky' ? (
            <View className="flex-row gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <Ionicons name="alert-circle" size={22} color={colors.danger} />
              <Text className="flex-1 text-base text-red-800 dark:text-red-100">
                {t('reliability.riskyBanner', {
                  percent: Math.round((borrowerReliability.onTimeRate ?? 0) * 100),
                })}
              </Text>
            </View>
          ) : (
            borrowerFlag &&
            borrowerFlag.totalOverdue > 0 && (
              <View className="flex-row gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                <Ionicons name="warning" size={22} color="#d97706" />
                <Text className="flex-1 text-base text-amber-900 dark:text-amber-100">
                  {t('reliability.overdueBanner', {
                    name: borrower?.fullName ?? '',
                    amount: formatPeso(borrowerFlag.totalOverdue),
                  })}
                </Text>
              </View>
            )
          )}

          {renewal && (
            <View className="gap-3 rounded-2xl border-2 border-sky-500 bg-sky-50 p-5 dark:border-sky-700 dark:bg-sky-950">
              <Text className="text-sm font-bold uppercase text-sky-800 dark:text-sky-200">
                {t('settlement.renewalTitle')}
              </Text>
              <View className="flex-row justify-between gap-3">
                <Text className="text-base text-slate-700 dark:text-slate-200">
                  {t('settlement.renewalPreviousBalance')}
                </Text>
                <Text className="text-base font-bold text-slate-900 dark:text-white">
                  {renewalAmount === null ? '—' : formatPeso(renewalAmount)}
                </Text>
              </View>
              <View className="flex-row justify-between gap-3 border-t border-sky-200 pt-3 dark:border-sky-800">
                <Text className="text-base font-semibold text-slate-700 dark:text-slate-200">
                  {t('settlement.renewalCashToRelease')}
                </Text>
                <Text className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {renewalCheck && !renewalCheck.error
                    ? formatPeso(renewalCheck.cashToRelease)
                    : '—'}
                </Text>
              </View>
              {renewalCheck?.error && (
                <Text className="text-sm font-medium text-red-600 dark:text-red-400">
                  {t('settlement.renewalPrincipalTooLow', {
                    amount: formatPeso(renewalAmount ?? 0),
                  })}
                </Text>
              )}
            </View>
          )}

          {presets.length > 0 && (
            <PresetChips
              presets={presets}
              selectedId={selectedPresetId}
              onSelect={applyPreset}
              customLabel={t('presets.custom')}
            />
          )}

          <FormField
            label="Principal"
            hint="Amount lent"
            prefix="₱"
            value={principalText}
            onChangeText={(v) => {
              setPrincipalText(v);
              if (presetControlledPrincipal) {
                setPresetControlledPrincipal(false);
                unapplyPreset();
              }
            }}
            placeholder="5000"
            keyboardType="decimal-pad"
            error={submitted ? fieldErrors.principal : null}
          />

          <SegmentedControl
            label="Payment type"
            value={paymentType}
            onChange={(v) => {
              setPaymentType(v);
              unapplyPreset();
            }}
            options={[
              { value: 'daily', label: 'Daily installments' },
              { value: 'lump_sum', label: 'Lump sum' },
            ]}
          />

          <SegmentedControl
            label="Compute by"
            value={mode}
            onChange={(v) => {
              setMode(v);
              unapplyPreset();
            }}
            options={[
              { value: 'rate', label: 'Interest %' },
              { value: 'installment', label: isDaily ? 'Daily amount' : 'Amount to pay' },
            ]}
          />

          {mode === 'rate' ? (
            <FormField
              label="Interest rate"
              hint="Flat, for the whole term"
              suffix="%"
              value={rateText}
              onChangeText={(v) => {
                setRateText(v);
                unapplyPreset();
              }}
              placeholder="20"
              keyboardType="decimal-pad"
              error={submitted ? fieldErrors.rate : null}
            />
          ) : (
            <FormField
              label={isDaily ? 'Daily amount (hulog)' : 'Amount to pay back'}
              prefix="₱"
              value={amountText}
              onChangeText={(v) => {
                setAmountText(v);
                unapplyPreset();
              }}
              placeholder={isDaily ? '150' : '5500'}
              keyboardType="decimal-pad"
              error={submitted ? fieldErrors.amount : null}
            />
          )}

          <FormField
            label={isDaily ? 'Number of daily payments' : 'Due in how many days'}
            hint="Max 365"
            suffix="days"
            value={termText}
            onChangeText={(v) => {
              setTermText(v);
              unapplyPreset();
            }}
            placeholder={isDaily ? '40' : '30'}
            keyboardType="number-pad"
            error={submitted ? fieldErrors.term : null}
          />

          <DateField label="Start date (release date)" value={startDate} onChange={setStartDate} />

          {isDaily && (
            <View className="min-h-14 flex-row items-center justify-between gap-4 rounded-2xl bg-white px-4 py-3 dark:bg-slate-900">
              <View className="flex-1 gap-0.5">
                <Text className="text-base font-semibold text-slate-900 dark:text-white">
                  Skip Sundays
                </Text>
                <Text className="text-sm text-slate-600 dark:text-slate-400">
                  No collection on Sundays; the schedule moves to Monday.
                </Text>
              </View>
              <Switch
                value={skipSundays}
                onValueChange={(v) => {
                  setSkipSundays(v);
                  unapplyPreset();
                }}
                trackColor={{ true: colors.primary, false: '#cbd5e1' }}
                thumbColor="#ffffff"
              />
            </View>
          )}

          <Pressable
            onPress={() => setSavePresetVisible(true)}
            accessibilityRole="button"
            className="min-h-12 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-teal-400 active:opacity-70 dark:border-teal-700">
            <Ionicons name="bookmark-outline" size={18} color={colors.primary} />
            <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">
              {t('presets.saveAsPreset')}
            </Text>
          </Pressable>

          <FormField
            label="Notes"
            hint="Optional"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything to remember about this loan"
            multiline
          />

          {/* How much the lender earns (or loses), shown as soon as the numbers are in */}
          {profit && preview && principal !== null && (
            <ProfitCheckCard
              {...profit}
              principalCentavos={principal}
              totalPayableCentavos={preview.totalPayableCentavos}
            />
          )}

          {/* Problems with the numbers */}
          {previewErrors.length > 0 && (
            <View className="gap-1 rounded-xl bg-red-50 p-4 dark:bg-red-950">
              {previewErrors.map((e) => (
                <Text key={e} className="text-base font-medium text-red-700 dark:text-red-300">
                  • {e}
                </Text>
              ))}
            </View>
          )}
          {preview && preview.warnings.length > 0 && previewValid && (
            <View className="gap-1 rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
              {preview.warnings.map((w) => (
                <Text key={w} className="text-base text-amber-800 dark:text-amber-200">
                  • {w}
                </Text>
              ))}
            </View>
          )}

          {/* Live preview */}
          {previewValid && schedule && endDate ? (
            <LoanPreviewCard
              interestCentavos={preview.interestCentavos}
              totalPayableCentavos={preview.totalPayableCentavos}
              installmentCentavos={preview.installmentCentavos}
              lastInstallmentCentavos={preview.lastInstallmentCentavos}
              numberOfInstallments={preview.numberOfInstallments}
              derivedRatePercent={mode === 'installment' ? preview.effectiveRatePercent : undefined}
              endDate={endDate}
              firstDueDates={schedule.slice(0, 5).map((r) => r.dueDate)}
              isLumpSum={!isDaily}
            />
          ) : (
            <View className="rounded-2xl border border-dashed border-slate-300 p-5 dark:border-slate-700">
              <Text className="text-center text-base text-slate-500 dark:text-slate-400">
                Fill in the amounts to see the total, the hulog, and the due dates.
              </Text>
            </View>
          )}

          <Pressable
            onPress={onPressSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
            className={
              saving
                ? 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 opacity-60 dark:bg-teal-500'
                : 'min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 active:bg-teal-800 dark:bg-teal-500'
            }>
            {saving && <ActivityIndicator color="#ffffff" />}
            <Text className="text-lg font-bold text-white">{saving ? 'Saving…' : 'Save loan'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <SavePresetSheet
        visible={savePresetVisible}
        onClose={() => setSavePresetVisible(false)}
        currentValues={{
          paymentType,
          inputMode: mode,
          principal,
          interestRate: rate,
          installmentAmount: amount,
          numberOfInstallments: term,
          skipSundays: isDaily && skipSundays,
        }}
        onSaved={(preset) => {
          setPresets((prev) =>
            [...prev.filter((p) => p.id !== preset.id), preset].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          );
          setSelectedPresetId(preset.id);
        }}
      />
    </KeyboardAvoidingView>
  );
}
