import { View } from 'react-native';

/** Plain-View progress bar; `value` is 0–1. */
export function ProgressBar({ value }: { value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <View
        className="h-full rounded-full bg-teal-600 dark:bg-teal-400"
        style={{ width: `${percent}%` }}
      />
    </View>
  );
}
