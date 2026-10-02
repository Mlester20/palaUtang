import { OnboardingCarousel } from '@/components/OnboardingCarousel';
import { completeOnboarding } from '@/store/app-state';

/**
 * First-run onboarding. Skip and Get Started both save hasCompletedOnboarding; the root layout
 * guards then replace this screen with setup/tabs, so Back can't return here.
 */
export default function OnboardingScreen() {
  return <OnboardingCarousel onFinish={completeOnboarding} />;
}
