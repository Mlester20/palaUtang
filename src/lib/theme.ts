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
    textMuted: '#64748b', // slate-500
    danger: '#dc2626', // red-600
    success: '#16a34a', // green-600
  },
  dark: {
    primary: '#2dd4bf', // teal-400
    onPrimary: '#042f2e', // teal-950
    background: '#0f172a', // slate-900
    border: '#1e293b', // slate-800
    text: '#ffffff',
    textMuted: '#94a3b8', // slate-400
    danger: '#f87171', // red-400
    success: '#4ade80', // green-400
  },
};

export type ThemeColors = (typeof palette)['light'];

export function useThemeColors(): ThemeColors {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
