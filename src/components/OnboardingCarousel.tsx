import { Image, type ImageSource } from 'expo-image';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { fonts } from '@/lib/theme';

type SlideKey = 'slide1' | 'slide2' | 'slide3';

type SlideTheme = {
  key: SlideKey;
  image: ImageSource;
  colors: {
    /** Matches the illustration's edges; never change (it must blend into the art). */
    background: string;
    title: string;
    caption: string;
    /** Colour of the highlighted title word. */
    highlight: string;
    /** Optional marker behind the highlighted word, when the highlight colour alone lacks contrast. */
    highlightMarker?: string;
    buttonFill: string;
    buttonText: string;
    dotActive: string;
  };
  /** Status/navigation bar icon colour that stays readable on the background. */
  systemBars: 'dark' | 'light';
};

// Contrast ratios against each background are listed in the comments (WCAG: body ≥ 4.5,
// large text / UI ≥ 3). Slide 2 needed two adjustments, noted inline.
const SLIDES: SlideTheme[] = [
  {
    key: 'slide1',
    image: require('@/assets/onboarding/slide-1.jpg'),
    colors: {
      background: '#C2E3F6',
      title: '#0B2A4A', // 10.81
      caption: '#35516E', // 6.11
      highlight: '#1E6FD9', // 3.60 (large text)
      buttonFill: '#1E6FD9', // white text 4.85
      buttonText: '#FFFFFF',
      dotActive: '#1E6FD9', // 3.60
    },
    systemBars: 'dark', // dark icons 15.6 vs light 1.35
  },
  {
    key: 'slide2',
    image: require('@/assets/onboarding/slide-2.jpg'),
    colors: {
      background: '#32A98D',
      title: '#052B25', // 5.22
      caption: '#09362F', // 4.55 (was #0B3F36 = 4.05, darkened, same hue)
      // White on this teal is only 2.92, so the white word sits on a dark marker (15.23).
      highlight: '#FFFFFF',
      highlightMarker: '#052B25',
      buttonFill: '#052B25', // white text 15.23
      buttonText: '#FFFFFF',
      dotActive: '#052B25', // 5.22 (white would be 2.92)
    },
    systemBars: 'dark', // dark icons 7.2 vs light 2.9
  },
  {
    key: 'slide3',
    image: require('@/assets/onboarding/slide-3.jpg'),
    colors: {
      background: '#9DD7B0',
      title: '#0E3B22', // 7.67
      caption: '#1F5A38', // 4.96
      highlight: '#0B6B34', // 4.04
      buttonFill: '#0B6B34', // white text 6.63
      buttonText: '#FFFFFF',
      dotActive: '#0B6B34', // 4.04
    },
    systemBars: 'dark', // dark icons 12.8 vs light 1.64
  },
];

// Non-breaking space, written as an escape so no editor/encoding can mangle it.
const NBSP = '\u00A0';
const TOP_BAR_HEIGHT = 56;
const DOT = { inactive: 8, active: 24, height: 8 };

/** The 3-slide intro. Used for first-run onboarding and for Settings → View intro again. */
export function OnboardingCarousel({ onFinish }: { onFinish: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<SlideTheme>>(null);
  const [index, setIndex] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const current = SLIDES[index]!;

  // Pill width per dot, animated when the page changes.
  const [dotWidths] = useState(() =>
    SLIDES.map((_, i) => new Animated.Value(i === 0 ? DOT.active : DOT.inactive)),
  );
  useEffect(() => {
    Animated.parallel(
      dotWidths.map((value, i) =>
        Animated.timing(value, {
          toValue: i === index ? DOT.active : DOT.inactive,
          duration: 220,
          useNativeDriver: false, // width can't use the native driver
        }),
      ),
    ).start();
  }, [index, dotWidths]);

  // Decode all three illustrations up front so swiping never shows a blank frame.
  useEffect(() => {
    for (const slide of SLIDES) {
      Image.loadAsync(slide.image).catch((error) =>
        console.warn('[Onboarding] image preload failed', error),
      );
    }
  }, []);

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  const goNext = () => {
    if (isLast) {
      onFinish();
      return;
    }
    const next = index + 1;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: current.colors.background }}>
      <StatusBar style={current.systemBars} />
      <NavigationBar style={current.systemBars} />

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(slide) => slide.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        // Only 3 slides: keep them all mounted so images are decoded before they're swiped to.
        initialNumToRender={SLIDES.length}
        windowSize={SLIDES.length}
        renderItem={({ item }) => {
          const title = {
            before: t(`onboarding.${item.key}.titleBefore`),
            highlight: t(`onboarding.${item.key}.titleHighlight`),
            after: t(`onboarding.${item.key}.titleAfter`),
          };
          const fullTitle = `${title.before}${title.highlight}${title.after}`;
          const marker = item.colors.highlightMarker;
          return (
            <View
              style={{
                width,
                backgroundColor: item.colors.background,
                paddingTop: insets.top + TOP_BAR_HEIGHT,
                paddingBottom: controlsHeight,
              }}
              className="flex-1 items-center">
              <Text
                accessibilityRole="header"
                accessibilityLabel={fullTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                className="px-6 text-center"
                style={{
                  fontFamily: fonts.bold,
                  fontSize: 33,
                  lineHeight: 40,
                  letterSpacing: -0.5,
                  color: item.colors.title,
                }}>
                {title.before}
                <Text
                  style={{
                    color: item.colors.highlight,
                    backgroundColor: marker,
                  }}>
                  {/* Non-breaking spaces pad the marker so it doesn't hug the letters. */}
                  {marker ? `${NBSP}${title.highlight}${NBSP}` : title.highlight}
                </Text>
                {title.after}
              </Text>

              {/* Fills the space between title and caption; `contain` never crops, and the
                  width cap keeps it sized by screen width on tall phones. */}
              <View className="w-full flex-1 items-center justify-center px-4 py-3">
                <Image
                  source={item.image}
                  contentFit="contain"
                  transition={0}
                  priority="high"
                  cachePolicy="memory"
                  accessible
                  accessibilityLabel={t('onboarding.slideImageLabel', { title: fullTitle })}
                  style={{ width: '100%', height: '100%', maxWidth: width }}
                />
              </View>

              <Text
                className="pb-2 text-center"
                style={{
                  fontFamily: fonts.regular,
                  fontSize: 17,
                  lineHeight: 25,
                  color: item.colors.caption,
                  maxWidth: width * 0.85,
                }}>
                {t(`onboarding.${item.key}.caption`)}
              </Text>
            </View>
          );
        }}
      />

      {/* Skip: small text button, large tap area */}
      <View
        className="absolute left-0 right-0 flex-row items-center justify-end px-3"
        style={{ top: insets.top, height: TOP_BAR_HEIGHT }}>
        {!isLast && (
          <Pressable
            onPress={onFinish}
            hitSlop={16}
            accessibilityRole="button"
            className="min-h-12 min-w-16 items-center justify-center px-3 active:opacity-60">
            <Text
              style={{ fontFamily: fonts.semibold, fontSize: 16, color: current.colors.caption }}>
              {t('onboarding.skip')}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Dots + Next / Get Started */}
      <View
        onLayout={(e) => setControlsHeight(e.nativeEvent.layout.height)}
        className="absolute bottom-0 left-0 right-0 gap-6 px-6 pt-4"
        style={{ paddingBottom: insets.bottom + 20 }}>
        <View
          className="flex-row items-center justify-center gap-2"
          accessibilityRole="adjustable"
          accessibilityValue={{ min: 1, max: SLIDES.length, now: index + 1 }}>
          {SLIDES.map((slide, i) => (
            <Animated.View
              key={slide.key}
              style={{
                width: dotWidths[i],
                height: DOT.height,
                borderRadius: DOT.height / 2,
                backgroundColor: i === index ? current.colors.dotActive : current.colors.caption,
                opacity: i === index ? 1 : 0.3,
              }}
            />
          ))}
        </View>

        <Pressable
          onPress={goNext}
          accessibilityRole="button"
          className="items-center justify-center rounded-full active:opacity-80"
          style={{
            height: 56,
            backgroundColor: current.colors.buttonFill,
            // Soft shadow (iOS) / elevation (Android)
            shadowColor: '#000000',
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}>
          <Text
            style={{ fontFamily: fonts.semibold, fontSize: 17, color: current.colors.buttonText }}>
            {isLast ? t('onboarding.getStarted') : t('onboarding.next')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
