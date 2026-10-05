import { router } from 'expo-router';

import { OnboardingCarousel } from '@/components/OnboardingCarousel';
import { t } from '@/i18n';
import { completeOnboarding } from '@/store/app-state';

/**
 * First-run onboarding. Skip and Get Started both save hasCompletedOnboarding; the root layout
 * guards then replace this screen with setup/tabs, so Back can't return here.
 */
export default function OnboardingScreen() {
  return (
    <OnboardingCarousel
      onFinish={completeOnboarding}
      // New phone or reinstall: bring the data back instead of starting over.
      secondaryAction={{ label: t('backup.restoreLink'), onPress: () => router.push('/backup/restore') }}
    />
  );
}
