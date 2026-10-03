import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** When true, tapping the backdrop / Back does nothing (e.g. while saving). */
  locked?: boolean;
};

/** Simple slide-up panel over a dimmed backdrop (RN Modal; works in Expo Go). */
export function BottomSheet({ visible, onClose, children, locked }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const close = () => {
    if (!locked) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}>
        <Pressable className="flex-1" onPress={close} accessibilityLabel={t('collection.close')} />
        <View
          className="gap-4 rounded-t-3xl bg-white px-5 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: insets.bottom + 20 }}>
          <View className="h-1.5 w-12 self-center rounded-full bg-slate-300 dark:bg-slate-700" />
          {children}
        </View>
      </View>
    </Modal>
  );
}
