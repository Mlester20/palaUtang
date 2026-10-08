import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { t } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

import { usePrivacy } from './PrivacyProvider';

/** Eye / eye-off icon button (48dp tap target): instant toggle, no screen flash. */
export function PrivacyToggle({ tone = 'default' }: { tone?: 'default' | 'onDark' }) {
  const colors = useThemeColors();
  const { enabled, toggleEnabled } = usePrivacy();
  const iconColor = tone === 'onDark' ? '#ffffff' : colors.text;

  return (
    <Pressable
      onPress={toggleEnabled}
      accessibilityRole="button"
      accessibilityLabel={enabled ? t('privacy.showAmounts') : t('privacy.hideAmounts')}
      hitSlop={6}
      className="h-12 w-12 items-center justify-center active:opacity-60">
      <Ionicons name={enabled ? 'eye-off-outline' : 'eye-outline'} size={24} color={iconColor} />
    </Pressable>
  );
}
