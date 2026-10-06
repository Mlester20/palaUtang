import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { PresetForm } from '@/components/loans/PresetForm';
import { getPresetById, PresetError, updatePreset } from '@/db/presets';
import { t } from '@/i18n';
import type { LoanPreset } from '@/lib/presets';

export default function EditPresetScreen() {
  const db = useSQLiteContext();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [preset, setPreset] = useState<LoanPreset | null | undefined>(undefined);

  useEffect(() => {
    getPresetById(db, id)
      .then(setPreset)
      .catch((error) => {
        console.error('[Load preset failed]', error);
        setPreset(null);
      });
  }, [db, id]);

  if (preset === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (preset === null) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-slate-50 p-6 dark:bg-slate-950">
        <Text className="text-center text-lg text-slate-700 dark:text-slate-200">
          {t('presets.notFound')}
        </Text>
      </View>
    );
  }

  return (
    <PresetForm
      submitLabel={t('presets.saveChanges')}
      initialValues={preset}
      onSubmit={async (input) => {
        try {
          await updatePreset(db, id, input);
        } catch (error) {
          if (error instanceof PresetError && error.code === 'nameTaken') {
            Alert.alert(t('presets.saveFailed'), t('presets.errNameTaken'));
            return;
          }
          throw error;
        }
        router.back();
      }}
    />
  );
}
