import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  type EmitterSubscription,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Minimal local shape of what this component needs from React Navigation's bottom-tab props.
 * expo-router vendors @react-navigation/bottom-tabs internally (not a direct dependency we can
 * import types from), so this avoids a fragile deep import into expo-router's build output.
 */
export type FloatingTabBarProps = {
  state: { index: number; routes: { key: string; name: string; params?: object }[] };
  descriptors: Record<string, { options: { title?: string; tabBarBadge?: string | number } }>;
  navigation: {
    navigate: (name: string, params?: object) => void;
    // Typed loosely on purpose: the real emit() restricts `type` to a specific event-name union
    // we don't have access to without importing React Navigation's internal types (see above).
    emit: (event: any) => any;
  };
};

/** The pill's own height, excluding the safe-area gap below it. */
export const TAB_BAR_HEIGHT = 64;
/** Gap between the pill and the safe-area bottom edge (gesture bar / 3-button nav). */
const TAB_BAR_BOTTOM_GAP = 12;
/** Extra clearance so the last list item never touches the pill. */
const TAB_BAR_BREATHING_ROOM = 16;
const MAX_WIDTH = 300;
const SIDE_MARGIN = 50;
const CIRCLE_SIZE = 48;
const ICON_SIZE = 24;
const ANIM_MS = 180;

/**
 * Total space the floating bar occupies, bottom padding for every tab screen's scroll content.
 * FAB/snackbar-style elements sit `useTabBarInset() + 16` above the bottom (see each screen).
 */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom + TAB_BAR_BREATHING_ROOM;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => active && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduceMotion;
}

/** Hides the bar (slide + fade, no layout jump: it's absolutely positioned) while typing. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs: EmitterSubscription[] = [
      Keyboard.addListener(showEvent, () => setVisible(true)),
      Keyboard.addListener(hideEvent, () => setVisible(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return visible;
}

const ICON_BY_ROUTE: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: 'home', inactive: 'home-outline' },
  collection: { active: 'cash', inactive: 'cash-outline' },
  borrowers: { active: 'people', inactive: 'people-outline' },
  settings: { active: 'settings', inactive: 'settings-outline' },
};

function badgeText(badge: string | number | undefined): string | null {
  if (badge === undefined || badge === null || badge === '') return null;
  const n = typeof badge === 'number' ? badge : Number(badge);
  if (Number.isFinite(n)) {
    if (n <= 0) return null;
    return n > 99 ? '99+' : String(n);
  }
  return String(badge);
}

/**
 * Custom `tabBar` for expo-router's <Tabs>. Standard React Navigation custom-tab-bar pattern
 * (tabPress with canPreventDefault, navigate only when not focused and not defaultPrevented,
 * tabLongPress emitted too) — see src/app/(tabs)/_layout.tsx for how it's wired in.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const keyboardVisible = useKeyboardVisible();

  const hideStyle = useAnimatedStyleHide(keyboardVisible, reduceMotion, insets.bottom);

  return (
    <Animated.View
      pointerEvents={keyboardVisible ? 'none' : 'box-none'}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: TAB_BAR_BOTTOM_GAP + insets.bottom,
          alignItems: 'center',
        },
        hideStyle,
      ]}>
      <View
        style={[
          {
            flexDirection: 'row',
            // alignSelf: 'stretch' (not width: '100%') so Yoga correctly subtracts the margin
            // instead of stretching to the full parent width and THEN adding margin on top of
            // that (which is what was making the pill run edge-to-edge despite marginHorizontal).
            alignSelf: 'stretch',
            maxWidth: MAX_WIDTH,
            marginHorizontal: SIDE_MARGIN,
            height: TAB_BAR_HEIGHT,
            borderRadius: 32,
            backgroundColor: colors.tabBarBg,
            borderWidth: colors.tabBarBorder === 'transparent' ? 0 : 1,
            borderColor: colors.tabBarBorder,
          },
          Platform.select({
            ios: {
              shadowColor: '#000000',
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
            },
            android: { elevation: 10 },
          }),
        ]}>
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor?.options;
          const isFocused = state.index === index;
          const icons = ICON_BY_ROUTE[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
          const label = typeof options?.title === 'string' ? options.title : route.name;
          const badge = badgeText(options?.tabBarBadge);

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <TabItem
              key={route.key}
              isFocused={isFocused}
              icon={isFocused ? icons.active : icons.inactive}
              label={label}
              badge={badge}
              reduceMotion={reduceMotion}
              colors={colors}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

/** Slides the whole pill down and fades it out while the keyboard is open. */
function useAnimatedStyleHide(hidden: boolean, reduceMotion: boolean, safeBottom: number) {
  const progress = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion ? (hidden ? 1 : 0) : withTiming(hidden ? 1 : 0, { duration: 200 });
  }, [hidden, reduceMotion, progress]);
  return useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: progress.value * (TAB_BAR_HEIGHT + safeBottom + TAB_BAR_BOTTOM_GAP) }],
  }));
}

function TabItem({
  isFocused,
  icon,
  label,
  badge,
  reduceMotion,
  colors,
  onPress,
  onLongPress,
}: {
  isFocused: boolean;
  icon: IconName;
  label: string;
  badge: string | null;
  reduceMotion: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const progress = useSharedValue(isFocused ? 1 : 0);
  const mounted = useRef(false);

  useEffect(() => {
    const target = isFocused ? 1 : 0;
    if (!mounted.current || reduceMotion) {
      progress.value = target;
    } else {
      progress.value = withSpring(target, { duration: ANIM_MS, dampingRatio: 0.8 });
    }
    mounted.current = true;
  }, [isFocused, reduceMotion, progress]);

  const circleStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.6 + progress.value * 0.4 }],
  }));

  const accessibilityLabel = badge ? `${label}, ${badge} to collect` : label;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: CIRCLE_SIZE,
              height: CIRCLE_SIZE,
              borderRadius: CIRCLE_SIZE / 2,
              backgroundColor: colors.tabBarActiveCircle,
            },
            circleStyle,
          ]}
        />
        <Ionicons
          name={icon}
          size={ICON_SIZE}
          color={isFocused ? colors.tabBarIconActive : colors.tabBarIcon}
        />
        {badge && (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: 2,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 3,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#dc2626',
              borderWidth: 1.5,
              borderColor: colors.tabBarBg,
            }}>
            <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700' }}>{badge}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
