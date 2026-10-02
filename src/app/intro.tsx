import { router } from 'expo-router';

import { OnboardingCarousel } from '@/components/OnboardingCarousel';

/** Settings → View intro again. Shows the intro on demand; no data or flags are changed. */
export default function IntroScreen() {
  return <OnboardingCarousel onFinish={() => router.back()} />;
}
