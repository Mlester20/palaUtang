import { Image, type ImageSource } from 'expo-image';
import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Slide = {
  key: string;
  image: ImageSource;
  /** Solid background colour of the artwork, used to fill the rest of the screen. */
  backgroundColor: string;
  /** The text baked into the artwork, for screen readers. */
  label: string;
};

const SLIDES: Slide[] = [
  {
    key: 'tracking',
    image: require('@/assets/images/tracking.png'),
    backgroundColor: '#A3D5F5',
    label:
      'Pautang Tracking. Madaling Pag-track ng Pautang: Keep everything organized, simple, and effective.',
  },
  {
    key: 'balda',
    image: require('@/assets/images/balda.png'),
    backgroundColor: '#339E8E',
    label:
      'Auto Balda. Auto Balda & Schedule Shift: Streamline your operation and maximize efficiency.',
  },
  {
    key: 'summary',
    image: require('@/assets/images/summary.png'),
    backgroundColor: '#86CA97',
    label:
      'Summary. Real-time Interest & Collection Summary: View your financial landscape in real-time, anytime, anywhere.',
  },
];

// Height of the Skip row; the artwork is laid out below it.
const TOP_BAR_HEIGHT = 48;

/** The 3-slide intro. Used for first-run onboarding and for Settings → View intro again. */
export function OnboardingCarousel({ onFinish }: { onFinish: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const isLast = index === SLIDES.length - 1;

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
    <View className="flex-1" style={{ backgroundColor: SLIDES[index].backgroundColor }}>
      {/* Each page is full-screen in the artwork's colour; the image is fitted (not cropped)
          between the top bar and the bottom controls, which float over the page. */}
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
        renderItem={({ item }) => (
          <View
            style={{
              width,
              backgroundColor: item.backgroundColor,
              paddingTop: insets.top + TOP_BAR_HEIGHT,
              paddingBottom: controlsHeight,
            }}
            className="flex-1 px-4">
            <Image
              source={item.image}
              contentFit="contain"
              accessible
              accessibilityLabel={item.label}
              style={{ flex: 1 }}
            />
          </View>
        )}
      />

      <View
        className="absolute left-0 right-0 flex-row items-center justify-end px-6"
        style={{ top: insets.top, height: TOP_BAR_HEIGHT }}>
        {!isLast && (
          <Pressable
            onPress={onFinish}
            hitSlop={12}
            className="rounded-full bg-white px-4 py-1.5 active:opacity-70">
            <Text className="text-sm font-semibold text-slate-900">Skip</Text>
          </Pressable>
        )}
      </View>

      <View
        onLayout={(e) => setControlsHeight(e.nativeEvent.layout.height)}
        className="absolute bottom-0 left-0 right-0 gap-5 px-6 pt-4"
        style={{ paddingBottom: insets.bottom + 16 }}>
        <View className="flex-row justify-center gap-2">
          {SLIDES.map((slide, i) => (
            <View
              key={slide.key}
              className={
                i === index
                  ? 'h-2 w-6 rounded-full bg-slate-900'
                  : 'h-2 w-2 rounded-full bg-slate-900 opacity-30'
              }
            />
          ))}
        </View>

        <Pressable
          onPress={goNext}
          className="items-center rounded-2xl bg-slate-900 py-4 active:opacity-80">
          <Text className="text-lg font-semibold text-white">
            {isLast ? 'Get Started' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
