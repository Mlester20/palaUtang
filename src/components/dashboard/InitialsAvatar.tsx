import { Text, View } from 'react-native';

type InitialsAvatarProps = {
  name: string;
  size?: 'md' | 'lg';
};

/** First letters of the first two words: "Maria Santos" -> "MS". */
export function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function InitialsAvatar({ name, size = 'md' }: InitialsAvatarProps) {
  return (
    <View
      className={
        size === 'lg'
          ? 'h-14 w-14 items-center justify-center rounded-full bg-teal-700 dark:bg-teal-400'
          : 'h-12 w-12 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900'
      }>
      <Text
        className={
          size === 'lg'
            ? 'text-xl font-bold text-white dark:text-teal-950'
            : 'text-base font-bold text-teal-800 dark:text-teal-100'
        }>
        {getInitials(name)}
      </Text>
    </View>
  );
}
