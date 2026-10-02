import { Pressable, Text, View } from 'react-native';

type SegmentedControlProps<T extends string> = {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** Big two/three-way toggle (min 48dp tall) for choices like Daily vs Lump sum. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <View className="gap-2">
      {label && (
        <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">{label}</Text>
      )}
      <View
        className="flex-row gap-1 rounded-xl bg-slate-200 p-1 dark:bg-slate-800"
        accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={
                selected
                  ? 'min-h-12 flex-1 items-center justify-center rounded-lg bg-white px-2 dark:bg-slate-600'
                  : 'min-h-12 flex-1 items-center justify-center rounded-lg px-2 active:opacity-60'
              }>
              <Text
                className={
                  selected
                    ? 'text-center text-base font-bold text-teal-800 dark:text-white'
                    : 'text-center text-base font-medium text-slate-600 dark:text-slate-300'
                }>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
