import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { t } from '@/i18n';

/**
 * Confirms before leaving a route-draft screen with unsaved changes — header back, Android back,
 * and swipe-back all fire React Navigation's `beforeRemove` the same way, so one listener covers
 * all three (see spec: "the Android back button too").
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigation = useNavigation();
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: { preventDefault: () => void; data: { action: unknown } }) => {
      if (!dirty) return;
      e.preventDefault();
      Alert.alert(t('route.unsavedTitle'), t('route.unsavedMessage'), [
        { text: t('route.keepEditing'), style: 'cancel' },
        {
          text: t('route.discard'),
          style: 'destructive',
          onPress: () => navigation.dispatch(e.data.action as never),
        },
      ]);
    });
  }, [navigation, dirty]);
}
