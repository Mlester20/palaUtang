import { Alert, Linking } from 'react-native';

import { t } from '@/i18n';

/** Opens the phone dialer; shows an alert on devices that can't call (e.g. some tablets). */
export async function callPhone(phone: string) {
  try {
    await Linking.openURL(`tel:${phone}`);
  } catch {
    Alert.alert(t('flags.callFailedTitle'), t('flags.callFailedMessage'));
  }
}
