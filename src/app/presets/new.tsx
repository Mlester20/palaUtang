import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert } from 'react-native';

import { PresetForm } from '@/components/loans/PresetForm';
import { createPreset, PresetError } from '@/db/presets';
import { t } from '@/i18n';

export default function NewPresetScreen() {
  const db = useSQLiteContext();

  return (
    <PresetForm
      submitLabel={t('presets.save')}
      onSubmit={async (input) => {
        try {
          await createPreset(db, input);
        } catch (error) {
          if (error instanceof PresetError && error.code === 'nameTaken') {
            Alert.alert(t('presets.saveFailed'), t('presets.errNameTaken'));
            return;
          }
          if (error instanceof PresetError && error.code === 'tooMany') {
            Alert.alert(t('presets.saveFailed'), t('presets.errTooMany'));
            return;
          }
          throw error;
        }
        router.back();
      }}
    />
  );
}
