import { ActivityIndicator, Modal, Text, View } from 'react-native';

import { t } from '@/i18n';
import { useDataOperation } from '@/store/backup-state';

/** Full-screen, non-dismissable while a restore runs: nothing else can be tapped. */
export function RestoreOverlay() {
  const operation = useDataOperation();
  return (
    <Modal visible={operation === 'restore'} transparent animationType="fade" onRequestClose={() => {}}>
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        accessibilityViewIsModal>
        <View className="w-full max-w-sm items-center gap-4 rounded-3xl bg-white p-6 dark:bg-slate-900">
          <ActivityIndicator size="large" />
          <Text className="text-center text-xl font-bold text-slate-900 dark:text-white">
            {t('backup.restoringTitle')}
          </Text>
          <Text className="text-center text-base text-slate-600 dark:text-slate-300">
            {t('backup.restoringMessage')}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
