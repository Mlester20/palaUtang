import { router } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DueTodayRow,
  HeroCollectionCard,
  InitialsAvatar,
  QuickActionButton,
  SectionHeader,
  StatCard,
  WeeklyEarningsCard,
} from '@/components/dashboard';
import { formatLongDate, mondayFirstDayIndex } from '@/lib/date';
import { mockDashboard } from '@/lib/mockDashboard';
import { formatPeso } from '@/lib/money';
import { useAppState } from '@/store/app-state';

function comingSoon() {
  Alert.alert('Coming soon', 'This will be available in the next phase.');
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAppState();
  if (!profile) return null;

  // Phase 3: static sample data. Swap this for real data later; the components only take props.
  const { collection, stats, weekly, dueToday } = mockDashboard;
  const today = new Date();

  return (
    <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950">
      {/* The tab header is hidden on Home, so the greeting clears the status bar itself. */}
      <View className="gap-7 px-5 pb-10" style={{ paddingTop: insets.top + 16 }}>
        {/* 1. Header */}
        <View className="flex-row items-center gap-4">
          <View className="flex-1 gap-1">
            <Text className="text-base text-slate-600 dark:text-slate-300">
              {formatLongDate(today)}
            </Text>
            <Text className="text-2xl font-bold text-slate-900 dark:text-white" numberOfLines={2}>
              Hello, {profile.businessName}
            </Text>
          </View>
          <InitialsAvatar name={profile.businessName} size="lg" />
        </View>

        {/* 2. Today's collection */}
        <HeroCollectionCard title="Today's Collection" {...collection} />

        {/* 3. Stats grid */}
        <View className="gap-3">
          <View className="flex-row gap-3">
            <StatCard icon="people" label="Borrowers" value={String(stats.activeBorrowers)} />
            <StatCard icon="document-text" label="Active Loans" value={String(stats.activeLoans)} />
          </View>
          <View className="flex-row gap-3">
            <StatCard
              icon="alert-circle"
              label="Balda"
              value={String(stats.baldaCount)}
              tone="danger"
            />
            <StatCard
              icon="wallet"
              label="Outstanding"
              value={formatPeso(stats.outstandingCentavos)}
            />
          </View>
        </View>

        {/* 4. Quick actions */}
        <View className="gap-3">
          <SectionHeader title="Quick Actions" />
          <View className="flex-row gap-2">
            <QuickActionButton
              icon="add-circle"
              label="New Loan"
              onPress={() => router.push('/loan/new')}
            />
            <QuickActionButton icon="cash" label="Collect" onPress={comingSoon} />
            <QuickActionButton
              icon="person-add"
              label="New Borrower"
              onPress={() => router.push('/borrower/new')}
            />
            <QuickActionButton icon="bar-chart" label="Reports" onPress={comingSoon} />
          </View>
        </View>

        {/* 5. This week's earnings */}
        <View className="gap-3">
          <SectionHeader title="This Week's Earnings" />
          <WeeklyEarningsCard {...weekly} highlightIndex={mondayFirstDayIndex(today)} />
        </View>

        {/* 6. Due today */}
        <View className="gap-1">
          <SectionHeader title="Due Today" actionLabel="See all" onAction={comingSoon} />
          <View className="rounded-2xl bg-white px-4 dark:bg-slate-900">
            {dueToday.map((item, i) => (
              <View
                key={item.id}
                className={i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : undefined}>
                <DueTodayRow
                  borrowerName={item.borrowerName}
                  amountDueCentavos={item.amountDueCentavos}
                  status={item.status}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
