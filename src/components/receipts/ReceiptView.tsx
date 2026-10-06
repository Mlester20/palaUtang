import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { formatDisplayDate } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { appliedLineText, type ReceiptData } from '@/lib/receipt';
import { fonts } from '@/lib/theme';
import type { DocumentSettings } from '@/store/document-settings';

export const RECEIPT_WIDTH_DP = 360;

/**
 * The captured receipt IMAGE. Always a fixed LIGHT palette (hex literals, never className/
 * useColorScheme) regardless of the app's own dark mode, since this is a document the borrower
 * keeps, not an app screen. Rendered off-screen in payment/new.tsx and wherever a "Receipt"
 * action opens it, then captured with captureRef (react-native-view-shot). collapsable={false}
 * is required on the root View or Android may fail to resolve it for capture.
 */
export function ReceiptView({
  data,
  settings,
}: {
  data: ReceiptData;
  settings: DocumentSettings;
}) {
  return (
    <View
      collapsable={false}
      style={{ width: RECEIPT_WIDTH_DP, backgroundColor: '#ffffff', padding: 20, gap: 14 }}>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: '#0f172a' }}>
          {t('receipts.title')}
        </Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: '#64748b' }}>
          {t('receipts.subtitle')}
        </Text>
      </View>

      <View style={{ alignItems: 'center', gap: 1 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: '#0f172a' }}>
          {data.businessName}
        </Text>
        {data.businessPhone && (
          <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: '#475569' }}>
            {data.businessPhone}
          </Text>
        )}
        {data.businessAddress && (
          <Text
            style={{ fontFamily: fonts.regular, fontSize: 12, color: '#475569', textAlign: 'center' }}>
            {data.businessAddress}
          </Text>
        )}
      </View>

      <View style={{ height: 1, backgroundColor: '#e2e8f0' }} />

      <View style={{ gap: 6 }}>
        <Row label={t('receipts.receiptNoLabel')} value={data.receiptNo} />
        <Row label={t('receipts.dateLabel')} value={formatDisplayDate(data.paidOn)} />
        <Row label={t('receipts.borrowerLabel')} value={data.borrowerName} wrap />
        <Row
          label={t('receipts.loanLabel', { number: data.loanId })}
          value={t('receipts.principalLabel', { amount: formatPeso(data.loanPrincipal) })}
        />
      </View>

      <View style={{ height: 1, backgroundColor: '#e2e8f0' }} />

      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.regular,
            fontSize: 11,
            color: '#64748b',
            textTransform: 'uppercase',
          }}>
          {t('receipts.amountReceived')}
        </Text>
        <Text style={{ fontFamily: fonts.bold, fontSize: 30, color: '#0f766e' }}>
          {formatPeso(data.amountReceived)}
        </Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: '#0f172a' }}>
          {data.kind === 'regular'
            ? t('receipts.kindRegular')
            : data.kind === 'settlement'
              ? t('receipts.kindSettlement')
              : t('receipts.kindNetted')}
        </Text>
      </View>

      {(data.applied.length > 0 || data.discountAmount > 0) && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#0f172a' }}>
            {t('receipts.appliedTitle')}
          </Text>
          {data.applied.map((line) => (
            <Text
              key={line.bucket}
              style={{ fontFamily: fonts.regular, fontSize: 13, color: '#334155' }}>
              {'• '}
              {appliedLineText(line)}
            </Text>
          ))}
          {data.discountAmount > 0 && (
            <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#334155' }}>
              {'• '}
              {t('receipts.discountLine', { amount: formatPeso(data.discountAmount) })}
            </Text>
          )}
        </View>
      )}

      {settings.showBalance && (
        <>
          <View style={{ height: 1, backgroundColor: '#e2e8f0' }} />
          <View style={{ gap: 4 }}>
            <Row label={t('receipts.totalPaidSoFar')} value={formatPeso(data.totalPaid)} />
            <Row label={t('receipts.balanceAfter')} value={formatPeso(data.balance)} bold />
            <Text style={{ fontFamily: fonts.regular, fontSize: 11, color: '#94a3b8' }}>
              {t('receipts.balanceAsOf', { date: formatDisplayDate(data.paidOn) })}
            </Text>
          </View>
        </>
      )}

      {settings.footerNote && (
        <>
          <View style={{ height: 1, backgroundColor: '#e2e8f0' }} />
          <Text
            style={{ fontFamily: fonts.regular, fontSize: 12, color: '#475569', textAlign: 'center' }}>
            {settings.footerNote}
          </Text>
        </>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  bold,
  wrap,
}: {
  label: string;
  value: string;
  bold?: boolean;
  wrap?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
        alignItems: 'flex-start',
      }}>
      <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#64748b' }}>{label}</Text>
      <Text
        numberOfLines={wrap ? undefined : 1}
        style={{
          flexShrink: 1,
          textAlign: 'right',
          fontFamily: bold ? fonts.bold : fonts.semibold,
          fontSize: bold ? 15 : 13,
          color: '#0f172a',
        }}>
        {value}
      </Text>
    </View>
  );
}
