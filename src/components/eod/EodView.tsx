import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { formatFullDate, formatTime } from '@/lib/date';
import {
  limitNames,
  MAX_NAMES_IN_IMAGE,
  type EodReportData,
  type NameAmount,
} from '@/lib/eodReport';
import { formatDisplayDate } from '@/lib/loan';
import { formatPeso } from '@/lib/money';
import { fonts } from '@/lib/theme';

export const EOD_WIDTH_DP = 360;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const GOOD = '#16a34a';
const BAD = '#dc2626';

function appliedLabel(bucket: 'missed' | 'current' | 'advance'): string {
  if (bucket === 'current') return t('eod.appliedDue');
  if (bucket === 'missed') return t('eod.appliedRecovered');
  return t('eod.appliedAdvance');
}

/**
 * The captured End of Day report IMAGE. Always a fixed LIGHT palette (hex literals, Poppins via
 * `fonts.*`, never className/useColorScheme) regardless of the app's own theme, same rule as
 * ReceiptView — this is a document meant to be shared outside the app.
 */
export function EodView({ data }: { data: EodReportData }) {
  const c = data.collection;

  return (
    <View collapsable={false} style={{ width: EOD_WIDTH_DP, backgroundColor: '#ffffff', padding: 20, gap: 16 }}>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: INK }}>{t('eod.title')}</Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: INK }}>{data.businessName}</Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: MUTED }}>
          {formatDisplayDate(data.date)}
        </Text>
      </View>

      <Section title={t('eod.collectionSection')}>
        <Hero label={t('eod.cashCollected')} value={formatPeso(c.cashCollected)} />
        <Plain text={t('eod.paymentsCount', { count: c.paymentCount, borrowers: c.distinctBorrowers })} />
        {c.appliedBreakdown.map((line) => (
          <Row key={line.bucket} label={`  ${appliedLabel(line.bucket)}`} value={formatPeso(line.amount)} />
        ))}
        {c.earlyPayoffCount > 0 && (
          <Plain
            text={t('eod.earlyPayoffs', { count: c.earlyPayoffCount, amount: formatPeso(c.earlyPayoffAmount) })}
          />
        )}
        {c.discountGiven > 0 && <Row label={`  ${t('eod.discountGiven')}`} value={formatPeso(c.discountGiven)} />}
        {c.nettedCount > 0 && (
          <Plain text={t('eod.appliedToRenewals', { count: c.nettedCount, amount: formatPeso(c.nettedAmount) })} />
        )}
        <Plain
          text={
            c.missedLoanCount > 0
              ? t('eod.missedThatDay', { count: c.missedLoanCount, amount: formatPeso(c.missedAmount) })
              : t('eod.missedNone')
          }
          tone={c.missedLoanCount > 0 ? 'bad' : 'default'}
        />
      </Section>

      <Section title={t('eod.newLoansSection')}>
        {data.newLoans.count > 0 ? (
          <Plain
            text={t('eod.newLoansLine', {
              count: data.newLoans.count,
              principal: formatPeso(data.newLoans.principal),
              released: formatPeso(data.newLoans.cashReleased),
            })}
          />
        ) : (
          <Plain text={t('eod.newLoansNone')} />
        )}
      </Section>

      {data.cash.available ? (
        <Section title={t('eod.cashSection')}>
          <Row label={t('eod.cashOpening')} value={formatPeso(data.cash.opening)} />
          <Row label={t('eod.cashCollected')} value={`+${formatPeso(data.cash.parts.collected)}`} />
          {data.cash.parts.capitalIn > 0 && (
            <Row label={t('eod.cashCapitalIn')} value={`+${formatPeso(data.cash.parts.capitalIn)}`} />
          )}
          <Row label={t('eod.cashReleased')} value={`-${formatPeso(data.cash.parts.released)}`} />
          <Row label={t('eod.cashWithdrawals')} value={`-${formatPeso(data.cash.parts.withdrawals)}`} />
          {data.cash.expensesByCategory.map((e) => (
            <Row
              key={e.category}
              label={`  ${t('eod.cashExpenseCategory', { category: e.category })}`}
              value={`-${formatPeso(e.amount)}`}
            />
          ))}
          {(data.cash.parts.adjustmentsIn > 0 || data.cash.parts.adjustmentsOut > 0) && (
            <Row
              label={t('eod.cashAdjustments')}
              value={`${data.cash.parts.adjustmentsIn >= data.cash.parts.adjustmentsOut ? '+' : '-'}${formatPeso(
                Math.abs(data.cash.parts.adjustmentsIn - data.cash.parts.adjustmentsOut),
              )}`}
            />
          )}
          <View style={{ height: 1, backgroundColor: LINE, marginVertical: 2 }} />
          <Row label={t('eod.cashClosing')} value={formatPeso(data.cash.closingExpected)} bold />
          {data.counted.amount !== null &&
            (() => {
              const diff = data.counted.amount! - data.cash.closingExpected;
              return (
                <>
                  <Row label={t('eod.cashCounted')} value={formatPeso(data.counted.amount!)} />
                  <Text
                    style={{
                      fontFamily: fonts.semibold,
                      fontSize: 13,
                      color: diff === 0 ? GOOD : BAD,
                    }}>
                    {diff === 0
                      ? t('eod.cashMatches')
                      : diff > 0
                        ? t('eod.cashOver', { amount: formatPeso(diff) })
                        : t('eod.cashShort', { amount: formatPeso(-diff) })}
                  </Text>
                </>
              );
            })()}
        </Section>
      ) : (
        <Section title={t('eod.cashSection')}>
          <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: MUTED }}>
            {data.cash.reason === 'notSetUp' ? t('eod.cashNotSetUp') : t('eod.cashBeforeStart')}
          </Text>
        </Section>
      )}

      {data.profit && (
        <Section title={t('eod.profitSection')}>
          <Row label={t('eod.profitInterest')} value={formatPeso(data.profit.interestEarned)} />
          <Row label={t('eod.profitPrincipal')} value={formatPeso(data.profit.principalReturned)} />
          <Row label={t('eod.profitNet')} value={formatPeso(data.profit.netOfExpenses)} bold />
        </Section>
      )}

      {data.flaggedCount !== null && (
        <Section title={t('eod.attentionSection')}>
          <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: data.flaggedCount > 0 ? BAD : MUTED }}>
            {data.flaggedCount === 0
              ? t('eod.attentionNone')
              : t('eod.attentionCount', { count: data.flaggedCount })}
          </Text>
        </Section>
      )}

      {data.borrowerLists && (
        <>
          {data.borrowerLists.paid.length > 0 && (
            <NameListSection title={t('eod.paidListTitle')} list={data.borrowerLists.paid} />
          )}
          {data.borrowerLists.missed.length > 0 && (
            <NameListSection title={t('eod.missedListTitle')} list={data.borrowerLists.missed} />
          )}
        </>
      )}

      <View style={{ height: 1, backgroundColor: LINE }} />
      <Text style={{ fontFamily: fonts.regular, fontSize: 11, color: MUTED, textAlign: 'center' }}>
        {t('eod.generatedAt', {
          when: `${formatFullDate(data.generatedAt)}, ${formatTime(data.generatedAt)}`,
        })}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: INK, textTransform: 'uppercase' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 4, gap: 2 }}>
      <Text style={{ fontFamily: fonts.regular, fontSize: 11, color: MUTED, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: 26, color: '#0f766e' }}>{value}</Text>
    </View>
  );
}

function Plain({ text, tone = 'default' }: { text: string; tone?: 'default' | 'bad' }) {
  return (
    <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: tone === 'bad' ? BAD : '#334155' }}>
      {text}
    </Text>
  );
}

function Row({
  label,
  value,
  bold,
  tone = 'default',
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'default' | 'bad';
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, color: tone === 'bad' ? BAD : '#334155' }}>
        {label}
      </Text>
      {value !== '' && (
        <Text
          style={{
            fontFamily: bold ? fonts.bold : fonts.semibold,
            fontSize: bold ? 15 : 13,
            color: tone === 'bad' ? BAD : INK,
          }}>
          {value}
        </Text>
      )}
    </View>
  );
}

function NameListSection({ title, list }: { title: string; list: NameAmount[] }) {
  const { shown, moreCount } = limitNames(list, MAX_NAMES_IN_IMAGE);
  return (
    <Section title={title}>
      {shown.map((item, i) => (
        <Row key={`${item.name}-${i}`} label={item.name} value={formatPeso(item.amount)} />
      ))}
      {moreCount > 0 && (
        <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: MUTED }}>
          {t('eod.moreNames', { count: moreCount })}
        </Text>
      )}
    </Section>
  );
}
