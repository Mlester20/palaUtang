import { router } from 'expo-router';

import { OnboardingCarousel } from '@/components/OnboardingCarousel';
import { t } from '@/i18n';
import { completeOnboarding } from '@/store/app-state';

/**
 * First-run onboarding. Skip and Get Started both save hasCompletedOnboarding, then replace to
 * "/": the root layout guards pick setup or (tabs) from the now-current state. The explicit
 * replace matters — Stack.Protected only reliably re-routes a *live* screen when its guard
 * becomes MORE restrictive; relying on the guard alone to open up access left this screen stuck
 * after the state write (confirmed on-device: cold start always picked up the new guard, but
 * nothing moved on if you stayed on this screen until the app was relaunched).
 */
export default function OnboardingScreen() {
  const finish = () => {
    completeOnboarding();
    router.replace('/');
  };
  return (
    <OnboardingCarousel
      onFinish={finish}
      // New phone or reinstall: bring the data back instead of starting over.
      secondaryAction={{ label: t('backup.restoreLink'), onPress: () => router.push('/backup/restore') }}
    />
  );
}
