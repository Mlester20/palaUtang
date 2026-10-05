import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { t } from '@/i18n';

type BackupReminderCardProps = {
  /** "Never backed up" / "Last backup exported 9 days ago". */
  message: string;
  onBackup: () => void;
  onDismiss: () => void;
};

/** Home: nudge to back up (dismiss hides it for 24 hours). */
export function BackupReminderCard({ message, onBackup, onDismiss }: BackupReminderCardProps) {
  return (
    <View className="gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <View className="flex-row items-start gap-3">
        <Ionicons name="cloud-upload" size={26} color="#d97706" />
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-bold text-amber-900 dark:text-amber-100">
            {t('backup.reminderTitle')}
          </Text>
          <Text className="text-sm text-amber-900 dark:text-amber-100">{message}</Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('backup.reminderDismiss')}
          className="h-10 w-10 items-center justify-center active:opacity-60">
          <Ionicons name="close" size={22} color="#92400e" />
        </Pressable>
      </View>
      <Pressable
        onPress={onBackup}
        accessibilityRole="button"
        className="min-h-12 items-center justify-center rounded-xl bg-amber-600 active:bg-amber-700">
        <Text className="text-base font-bold text-white">{t('backup.backUpNow')}</Text>
      </Pressable>
    </View>
  );
}
