import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showError } from '@/lib/errors';
import { MAX_AREA_LENGTH, validateArea } from '@/lib/areas';
import { isValidPhPhone } from '@/lib/phone';
import { useThemeColors } from '@/lib/theme';
import type { BorrowerInput } from '@/types/borrower';

type BorrowerFormProps = {
  initialValues?: BorrowerInput;
  submitLabel: string;
  /** Persists the borrower. Throwing shows a friendly error and keeps the form open. */
  onSubmit: (input: BorrowerInput) => Promise<void>;
  /** Number of other borrowers with the same full name (for the "Save anyway" warning). */
  countSameName: (fullName: string) => Promise<number>;
  /** Most-used existing areas (up to 8), for the Area field's suggestion chips. */
  areaSuggestions?: string[];
};

export function BorrowerForm({
  initialValues,
  submitLabel,
  onSubmit,
  countSameName,
  areaSuggestions = [],
}: BorrowerFormProps) {
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState(initialValues?.fullName ?? '');
  const [nickname, setNickname] = useState(initialValues?.nickname ?? '');
  const [phone, setPhone] = useState(initialValues?.phone ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [area, setArea] = useState(initialValues?.area ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // A ref (not just state) so two quick taps can't both start a save.
  const busy = useRef(false);

  const nameError = fullName.trim() === '' ? 'Full name is required.' : null;
  const phoneError =
    phone.trim() !== '' && !isValidPhPhone(phone)
      ? 'Use 09XXXXXXXXX or +639XXXXXXXXX, or leave it blank.'
      : null;
  const areaError =
    validateArea(area) === 'tooLong' ? `Keep the area under ${MAX_AREA_LENGTH} characters.` : null;

  const save = async () => {
    try {
      await onSubmit({ fullName, nickname, phone, address, area, notes });
    } catch (error) {
      showError('Could not save', error);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const onPressSave = async () => {
    setSubmitted(true);
    if (nameError || phoneError || areaError || busy.current) return;
    busy.current = true;
    setSaving(true);

    let duplicates = 0;
    try {
      duplicates = await countSameName(fullName);
    } catch (error) {
      // If the check fails, don't block saving, but leave a trace in the Metro terminal.
      console.warn('[Duplicate name check failed]', error);
    }

    if (duplicates > 0) {
      Alert.alert(
        'Same name already exists',
        `${duplicates === 1 ? 'A borrower' : `${duplicates} borrowers`} named "${fullName.trim()}" already ${duplicates === 1 ? 'exists' : 'exist'}. Two people can share a name. Save anyway?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              busy.current = false;
              setSaving(false);
            },
          },
          { text: 'Save anyway', onPress: save },
        ],
        { cancelable: false },
      );
      return;
    }

    await save();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="gap-5 p-5" style={{ paddingBottom: insets.bottom + 24 }}>
          <Field
            label="Full name"
            required
            value={fullName}
            onChangeText={setFullName}
            placeholder="e.g. Maria Santos"
            autoCapitalize="words"
            error={submitted ? nameError : null}
          />
          <Field
            label="Nickname"
            hint="What collectors call them"
            value={nickname ?? ''}
            onChangeText={setNickname}
            placeholder="e.g. Aling Nena sa palengke"
          />
          <Field
            label="Phone"
            value={phone ?? ''}
            onChangeText={setPhone}
            onBlur={() => setPhoneTouched(true)}
            placeholder="09XXXXXXXXX"
            keyboardType="phone-pad"
            autoComplete="tel"
            error={submitted || phoneTouched ? phoneError : null}
          />
          <Field
            label="Address"
            value={address ?? ''}
            onChangeText={setAddress}
            placeholder="Street, barangay, city"
            multiline
          />
          <View className="gap-2">
            <Field
              label="Area"
              hint="Collection route, optional"
              value={area}
              onChangeText={setArea}
              placeholder="e.g. Palengke"
              autoCapitalize="words"
              error={submitted ? areaError : null}
            />
            {areaSuggestions.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {areaSuggestions.map((suggestion) => {
                  const selected = suggestion.toLowerCase() === area.trim().toLowerCase();
                  return (
                    <Pressable
                      key={suggestion}
                      onPress={() => setArea(suggestion)}
                      accessibilityRole="button"
                      className={
                        selected
                          ? 'min-h-10 justify-center rounded-full bg-teal-700 px-3 dark:bg-teal-500'
                          : 'min-h-10 justify-center rounded-full border border-slate-300 bg-white px-3 active:opacity-70 dark:border-slate-700 dark:bg-slate-900'
                      }>
                      <Text
                        className={
                          selected
                            ? 'text-sm font-bold text-white'
                            : 'text-sm font-semibold text-slate-700 dark:text-slate-200'
                        }>
                        {suggestion}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
          <Field
            label="Notes"
            value={notes ?? ''}
            onChangeText={setNotes}
            placeholder="Anything to remember"
            multiline
          />

          <Pressable
            onPress={onPressSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
            className={
              saving
                ? 'mt-2 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 opacity-60 dark:bg-teal-500'
                : 'mt-2 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-teal-700 py-4 active:bg-teal-800 dark:bg-teal-500'
            }>
            {saving && <ActivityIndicator color="#ffffff" />}
            <Text className="text-lg font-bold text-white">{saving ? 'Saving…' : submitLabel}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string | null;
};

function Field({ label, hint, required, error, multiline, ...inputProps }: FieldProps) {
  const colors = useThemeColors();
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline gap-2">
        <Text className="text-base font-semibold text-slate-800 dark:text-slate-100">
          {label}
          {required && <Text className="text-red-600 dark:text-red-400"> *</Text>}
        </Text>
        {hint && <Text className="text-sm text-slate-500 dark:text-slate-400">{hint}</Text>}
      </View>
      <TextInput
        {...inputProps}
        multiline={multiline}
        placeholderTextColor={colors.textMuted}
        textAlignVertical={multiline ? 'top' : 'center'}
        className={
          error
            ? 'min-h-14 rounded-xl border-2 border-red-500 bg-white px-4 py-3 text-lg text-slate-900 dark:bg-slate-900 dark:text-white'
            : 'min-h-14 rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white'
        }
        style={multiline ? { minHeight: 96 } : undefined}
      />
      {error && <Text className="text-sm font-medium text-red-600 dark:text-red-400">{error}</Text>}
    </View>
  );
}
