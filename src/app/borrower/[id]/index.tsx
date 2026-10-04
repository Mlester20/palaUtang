import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InitialsAvatar } from '@/components/dashboard';
import { SeverityBanner } from '@/components/flags/SeverityBanner';
import { LoanCard } from '@/components/loans/LoanCard';
import {
  archiveBorrower,
  BorrowerHasActiveLoansError,
  getBorrowerById,
  restoreBorrower,
} from '@/db/borrowers';
import { getBorrowerFlag } from '@/db/flags';
import { getLoansByBorrower } from '@/db/loans';
import { formatFullDate } from '@/lib/date';
import { showError } from '@/lib/errors';
import type { BorrowerFlag } from '@/lib/flags';
import { todayYmd } from '@/lib/loan';
import { useThemeColors } from '@/lib/theme';
import { useFlagThresholds } from '@/store/flag-settings';
import type { Borrower } from '@/types/borrower';
import type { LoanSummary } from '@/types/loan';

export default function BorrowerDetailsScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [borrower, setBorrower] = useState<Borrower | null | undefined>(undefined);
  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [flag, setFlag] = useState<BorrowerFlag | null>(null);
  const thresholds = useFlagThresholds();
  const [busy, setBusy] = useState(false);

  // Reload whenever this screen is shown again (e.g. after editing or creating a loan).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([
        getBorrowerById(db, id),
        getLoansByBorrower(db, id),
        getBorrowerFlag(db, id, todayYmd(), thresholds),
      ])
        .then(([b, l, f]) => {
          if (!active) return;
          setBorrower(b);
          setLoans(l);
          setFlag(f);
        })
        .catch((error) => {
          console.error('[Load borrower failed]', error);
          if (active) setBorrower(null);
        });
      return () => {
        active = false;
      };
    }, [db, id, thresholds]),
  );

  if (borrower === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (borrower === null) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          This borrower could not be found.
        </Text>
        <Pressable onPress={() => router.back()} className="min-h-12 justify-center px-4">
          <Text className="text-base font-semibold text-teal-700 dark:text-teal-300">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const archived = borrower.archivedAt !== null;
  const activeLoanCount = loans.filter((l) => l.status === 'active').length;

  const callBorrower = async () => {
    if (!borrower.phone) return;
    try {
      await Linking.openURL(`tel:${borrower.phone}`);
    } catch {
      Alert.alert('Cannot call', 'This phone cannot make calls.');
    }
  };

  const confirmArchive = () => {
    if (activeLoanCount > 0) {
      Alert.alert(
        'Cannot archive yet',
        `${borrower.fullName} still has ${activeLoanCount === 1 ? 'an active loan' : `${activeLoanCount} active loans`}. Archive them after the loan is completed or cancelled.`,
      );
      return;
    }
    Alert.alert(
      'Archive this borrower?',
      `${borrower.fullName} will be hidden from your borrower list. You can restore them anytime from "Show archived".`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await archiveBorrower(db, borrower.id);
              router.back();
              Alert.alert('Borrower archived', `${borrower.fullName} was moved to archived.`);
            } catch (error) {
              if (error instanceof BorrowerHasActiveLoansError) {
                Alert.alert('Cannot archive yet', `${borrower.fullName} still has an active loan.`);
              } else {
                showError('Could not archive', error);
              }
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const restore = async () => {
    setBusy(true);
    try {
      await restoreBorrower(db, borrower.id);
      setBorrower(await getBorrowerById(db, borrower.id));
      Alert.alert('Borrower restored', `${borrower.fullName} is active again.`);
    } catch (error) {
      showError('Could not restore', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: borrower.fullName }} />
      <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950">
        <View className="gap-5 p-5" style={{ paddingBottom: insets.bottom + 24 }}>
          {flag && flag.severity !== 'none' && (
            <SeverityBanner
              severity={flag.severity}
              daysBehind={flag.daysBehind}
              totalOverdue={flag.totalOverdue}
              loanCount={flag.loanCount}
            />
          )}

          {/* Profile */}
          <View className="items-center gap-2 pt-2">
            <InitialsAvatar name={borrower.fullName} size="lg" />
            <Text className="text-center text-2xl font-bold text-slate-900 dark:text-white">
              {borrower.fullName}
            </Text>
            {borrower.nickname && (
              <Text className="text-center text-base text-slate-600 dark:text-slate-300">
                “{borrower.nickname}”
              </Text>
            )}
            {archived && (
              <View className="rounded-full bg-slate-200 px-3 py-1 dark:bg-slate-700">
                <Text className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Archived
                </Text>
              </View>
            )}
          </View>

          {/* Info card */}
          <View className="gap-4 rounded-2xl bg-white p-5 dark:bg-slate-900">
            <InfoRow
              icon="call"
              label="Phone"
              value={borrower.phone}
              onPress={borrower.phone ? callBorrower : undefined}
              actionHint="Tap to call"
              color={colors.primary}
            />
            <InfoRow
              icon="location"
              label="Address"
              value={borrower.address}
              color={colors.primary}
            />
            <InfoRow
              icon="document-text"
              label="Notes"
              value={borrower.notes}
              color={colors.primary}
            />
            <InfoRow
              icon="calendar"
              label="Date added"
              value={formatFullDate(new Date(borrower.createdAt))}
              color={colors.primary}
            />
          </View>

          {/* Actions */}
          <View className="flex-row gap-3">
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/borrower/[id]/edit',
                  params: { id: String(borrower.id) },
                })
              }
              disabled={busy}
              accessibilityRole="button"
              className="min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
              <Ionicons name="create-outline" size={22} color="#ffffff" />
              <Text className="text-lg font-bold text-white">Edit</Text>
            </Pressable>
            {archived ? (
              <Pressable
                onPress={restore}
                disabled={busy}
                accessibilityRole="button"
                className="min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-teal-700 bg-white active:opacity-70 dark:border-teal-400 dark:bg-slate-900">
                <Ionicons name="arrow-undo-outline" size={22} color={colors.primary} />
                <Text className="text-lg font-bold text-teal-700 dark:text-teal-300">Restore</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={confirmArchive}
                disabled={busy}
                accessibilityRole="button"
                className="min-h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-red-300 bg-white active:opacity-70 dark:border-red-900 dark:bg-slate-900">
                <Ionicons name="archive-outline" size={22} color={colors.danger} />
                <Text className="text-lg font-bold text-red-600 dark:text-red-400">Archive</Text>
              </Pressable>
            )}
          </View>

          {/* Loans */}
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xl font-bold text-slate-900 dark:text-white">
                Loans ({loans.length})
              </Text>
            </View>
            {!archived && (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/loan/new',
                    params: { borrowerId: String(borrower.id) },
                  })
                }
                disabled={busy}
                accessibilityRole="button"
                className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 active:bg-teal-800 dark:bg-teal-500">
                <Ionicons name="add-circle-outline" size={24} color="#ffffff" />
                <Text className="text-lg font-bold text-white">New Loan</Text>
              </Pressable>
            )}
            {loans.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-slate-300 p-5 dark:border-slate-700">
                <Text className="text-center text-base text-slate-600 dark:text-slate-400">
                  No loans yet.
                </Text>
              </View>
            ) : (
              loans.map((loan) => (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  onPress={() =>
                    router.push({ pathname: '/loan/[id]', params: { id: String(loan.id) } })
                  }
                />
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </>
  );
}

type InfoRowProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string | null;
  color: string;
  onPress?: () => void;
  actionHint?: string;
};

function InfoRow({ icon, label, value, color, onPress, actionHint }: InfoRowProps) {
  const content = (
    <View className="flex-row items-start gap-3">
      <Ionicons name={icon} size={22} color={color} style={{ marginTop: 2 }} />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</Text>
        <Text
          className={
            value
              ? onPress
                ? 'text-lg font-semibold text-teal-700 dark:text-teal-300'
                : 'text-lg text-slate-900 dark:text-white'
              : 'text-lg italic text-slate-400 dark:text-slate-500'
          }>
          {value ?? 'Not set'}
        </Text>
        {onPress && actionHint && (
          <Text className="text-xs text-slate-500 dark:text-slate-400">{actionHint}</Text>
        )}
      </View>
    </View>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${actionHint ?? ''}`}
      className="min-h-12 active:opacity-60">
      {content}
    </Pressable>
  ) : (
    content
  );
}
