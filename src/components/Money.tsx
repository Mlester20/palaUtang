import { Text, type GestureResponderEvent, type TextProps } from 'react-native';

import { t } from '@/i18n';
import { formatPeso } from '@/lib/money';
import type { Centavos } from '@/types/dashboard';

import { usePrivacy, type MoneyKind } from './PrivacyProvider';

/**
 * Fixed-width placeholder, IDENTICAL for every value — the point is that the mask never reveals
 * the size of the number through its length (spec: ₱5 and ₱5,000,000 must look the same).
 */
export const MASKED_AMOUNT = '₱ ••••';

type MoneyProps = TextProps & {
  value: Centavos;
  kind: MoneyKind;
};

/**
 * Drop-in replacement for `<Text>{formatPeso(value)}</Text>` that masks per the privacy setting.
 * Tapping a masked instance peeks (reveals every masked amount for 10s) without touching
 * whatever onPress the caller also passed (both run).
 */
export function Money({ value, kind, onPress, ...textProps }: MoneyProps) {
  const { isMasked, peek } = usePrivacy();
  const masked = isMasked(kind);

  if (!masked) {
    return (
      <Text {...textProps} onPress={onPress}>
        {formatPeso(value)}
      </Text>
    );
  }

  const onPressMasked = (e: GestureResponderEvent) => {
    peek();
    onPress?.(e);
  };

  return (
    <Text
      {...textProps}
      onPress={onPressMasked}
      accessibilityRole="button"
      accessibilityLabel={t('privacy.amountHidden')}
      accessibilityHint={t('privacy.peekHint')}>
      {MASKED_AMOUNT}
    </Text>
  );
}

/** For string-only contexts: accessibility labels, t() interpolation, chart/axis labels. */
export function useMoneyText(): (value: Centavos, kind: MoneyKind) => string {
  const { isMasked } = usePrivacy();
  return (value, kind) => (isMasked(kind) ? MASKED_AMOUNT : formatPeso(value));
}
