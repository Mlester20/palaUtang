import { t } from '@/i18n';
import type { ReliabilityResult, ReliabilityTier } from '@/lib/reliability';
import type { ChipTone } from '@/types/dashboard';

/** Reuses existing chip colours: New=gray, Reliable=green, Fair=yellow, Risky=red. */
const TONE: Record<ReliabilityTier, ChipTone> = {
  new: 'neutral',
  reliable: 'success',
  fair: 'late',
  risky: 'critical',
};

export function tierTone(tier: ReliabilityTier): ChipTone {
  return TONE[tier];
}

export function tierLabel(tier: ReliabilityTier): string {
  return t(`reliability.${tier}`);
}

/** The badge shown on Borrowers rows and the detail screen. */
export function tierBadge(result: Pick<ReliabilityResult, 'tier'>): { label: string; tone: ChipTone } {
  return { label: tierLabel(result.tier), tone: tierTone(result.tier) };
}
