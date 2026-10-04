import { View } from 'react-native';

/** Grey placeholder shown while the first load is running. */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <View
      accessible={false}
      className={`rounded-2xl bg-slate-200 opacity-70 dark:bg-slate-800 ${className}`}
    />
  );
}
