import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';

import { Money } from '@/components/Money';
import { useThemeColors } from '@/lib/theme';
import type { DailyEarning } from '@/types/dashboard';

type WeeklyLineChartProps = {
  days: DailyEarning[];
  /** Index into `days` to highlight (e.g. today). */
  highlightIndex?: number;
};

const CHART_HEIGHT = 128;
const TOP_PADDING = 28; // room for the highlighted point's value label
const DOT_RADIUS = 5;
const DOT_RADIUS_ACTIVE = 7;

/**
 * Plain-View line chart (no SVG dependency): each segment between two points is a thin View
 * rotated around its own center — the standard trick for drawing a line between two coordinates
 * with only a width/height/rotate transform, which every RN version supports.
 */
export function WeeklyLineChart({ days, highlightIndex }: WeeklyLineChartProps) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...days.map((d) => d.amountCentavos));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const slot = width / days.length;
  const points = days.map((d, i) => ({
    x: slot * i + slot / 2,
    y: TOP_PADDING + (CHART_HEIGHT - (d.amountCentavos / max) * CHART_HEIGHT),
    day: d.day,
    amount: d.amountCentavos,
  }));

  return (
    <View className="gap-2">
      <View style={{ height: CHART_HEIGHT + TOP_PADDING }} onLayout={onLayout}>
        {width > 0 &&
          points.map((p, i) => {
            if (i === 0) return null;
            const prev = points[i - 1]!;
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <View
                key={`seg-${i}`}
                style={{
                  position: 'absolute',
                  left: (prev.x + p.x) / 2 - length / 2,
                  top: (prev.y + p.y) / 2 - 1,
                  width: length,
                  height: 2,
                  backgroundColor: colors.border,
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}
        {width > 0 &&
          points.map((p, i) => {
            const active = i === highlightIndex;
            const radius = active ? DOT_RADIUS_ACTIVE : DOT_RADIUS;
            return (
              <View key={`pt-${i}`}>
                {active && (
                  <Money
                    value={p.amount}
                    kind="total"
                    className="absolute text-xs font-bold text-teal-700 dark:text-teal-300"
                    style={{ left: p.x - 30, top: p.y - 24, width: 60, textAlign: 'center' }}
                    numberOfLines={1}
                  />
                )}
                <View
                  style={{
                    position: 'absolute',
                    left: p.x - radius,
                    top: p.y - radius,
                    width: radius * 2,
                    height: radius * 2,
                    borderRadius: radius,
                    backgroundColor: active ? colors.primary : colors.background,
                    borderWidth: active ? 0 : 2,
                    borderColor: colors.primary,
                  }}
                />
              </View>
            );
          })}
      </View>
      <View className="flex-row justify-between">
        {days.map((d, i) => (
          <Text
            key={d.day}
            className={
              i === highlightIndex
                ? 'flex-1 text-center text-sm font-bold text-teal-700 dark:text-teal-300'
                : 'flex-1 text-center text-sm text-slate-500 dark:text-slate-400'
            }>
            {d.day}
          </Text>
        ))}
      </View>
    </View>
  );
}
