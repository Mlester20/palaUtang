import { useColorScheme } from 'react-native';

/**
 * Colours for places that can't take a className (icon colours, tab bar, Switch tracks).
 * Values are Tailwind palette colours so they match the className-styled UI.
 */
export const palette = {
  light: {
    primary: '#0f766e', // teal-700
    onPrimary: '#ffffff',
    background: '#ffffff', // white (cards, tab bar, header)
    border: '#e2e8f0', // slate-200
    text: '#0f172a', // slate-900
    textMuted: '#64748b', // slate-500 — also used for placeholders (4.6:1 on white, slate-400 was 2.8:1)
    danger: '#dc2626', // red-600
    warning: '#ea580c', // orange-600 (flagged borrowers)
    success: '#16a34a', // green-600
    info: '#0369a1', // sky-700 (chevrons, links, "advance" marker)
    accent: '#7c3aed', // violet-600 (early payoff / settlement)
    switchTrackOff: '#cbd5e1', // slate-300
    tabBarBg: '#1F2328', // dark charcoal pill, same in both themes (spec)
    tabBarBorder: 'transparent', // only shown in dark (see below)
    tabBarIcon: 'rgba(255, 255, 255, 0.7)', // inactive icon
    tabBarIconActive: '#ffffff', // icon inside the active circle
    tabBarActiveCircle: '#0f766e', // teal-700: white icon on it is 5.47:1 in BOTH themes
  },
  dark: {
    primary: '#2dd4bf', // teal-400
    onPrimary: '#042f2e', // teal-950
    background: '#0f172a', // slate-900
    border: '#1e293b', // slate-800
    text: '#ffffff',
    textMuted: '#94a3b8', // slate-400
    danger: '#f87171', // red-400
    warning: '#fb923c', // orange-400
    success: '#4ade80', // green-400
    info: '#38bdf8', // sky-400
    accent: '#c4b5fd', // violet-300
    switchTrackOff: '#475569', // slate-600
    tabBarBg: '#2A2F34', // slightly lighter charcoal so it reads as its own surface in dark mode
    tabBarBorder: 'rgba(255, 255, 255, 0.1)', // 1dp hairline: tabBarBg vs the dark page bg is only 1.3:1
    tabBarIcon: 'rgba(255, 255, 255, 0.7)',
    tabBarIconActive: '#ffffff',
    tabBarActiveCircle: '#0f766e', // teal-700, same as light: white icon stays 5.47:1
  },
};

export type ThemeColors = (typeof palette)['light'];

export function useThemeColors(): ThemeColors {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

/**
 * Font families, loaded with useFonts in the root layout. Use these names via `fontFamily`
 * (not fontWeight: each Poppins weight is its own family on Android).
 * If loading fails, React Native falls back to the system font for unknown families.
 */
export const fonts = {
  regular: 'Poppins_400Regular',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;
