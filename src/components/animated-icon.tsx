import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';

const DURATION = 600;
// Never keep the splash up longer than this, even if the image never reports it was drawn.
const MAX_SPLASH_MS = 2000;

const splashKeyframe = new Keyframe({
  0: {
    transform: [{ scale: 1 }],
    opacity: 1,
  },
  20: {
    opacity: 1,
  },
  70: {
    opacity: 0,
    easing: Easing.elastic(0.7),
  },
  100: {
    opacity: 0,
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

/**
 * `ready` = the app can be shown (fonts loaded or failed). The splash stays up until the splash
 * image is drawn AND the app is ready, so text never flashes in the default font.
 */
export function AnimatedSplashOverlay({ ready = true }: { ready?: boolean }) {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);
  const [imageShown, setImageShown] = useState(false);
  const started = useRef(false);

  // Hides the native splash and starts the fade-out. Safe to call more than once.
  const start = () => {
    if (started.current) return;
    started.current = true;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setAnimate(true));
  };

  // Fallback in case the image never fires onDisplay/onError.
  useEffect(() => {
    const timer = setTimeout(() => setImageShown(true), MAX_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready && imageShown) start();
  }, [ready, imageShown]);

  // Never keep the user waiting forever, even if `ready` never arrives.
  useEffect(() => {
    const timer = setTimeout(start, MAX_SPLASH_MS * 3);
    return () => clearTimeout(timer);
  }, []);

  // Remove the overlay on a JS timer instead of relying only on the animation callback,
  // which doesn't fire if the animation is skipped (e.g. animations turned off on the phone).
  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setVisible(false), DURATION + 100);
    return () => clearTimeout(timer);
  }, [animate]);

  if (!visible) return null;

  // Full-screen splash art; `cover` fills any screen ratio by cropping the edges.
  // The native splash stays up until this image is drawn, so there's no blank flash.
  const image = (
    <Image
      style={StyleSheet.absoluteFill}
      source={require('@/assets/images/splash-screen.jpg')}
      contentFit="cover"
      onDisplay={() => setImageShown(true)}
      onError={() => setImageShown(true)}
    />
  );

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION)}
      pointerEvents="none"
      style={styles.splashOverlay}>
      {image}
    </Animated.View>
  ) : (
    <View style={styles.splashOverlay}>{image}</View>
  );
}

const styles = StyleSheet.create({
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FAFBFB',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
