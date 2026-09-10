/**
 * Presentation helpers for persistent `weather` annotations.
 *
 * A weather annotation pins a card at a coordinate and describes which days to
 * forecast there: `date` is the first forecast day (`''` = today) and `days`
 * is the number of consecutive days. The card body is the weather.mgt.moe
 * dashboard, configured entirely through its `route` param (see
 * weather-dashboard.ts).
 */

import {
  sanitizeAnnotationWeatherDate,
  sanitizeAnnotationWeatherDays,
  type AnnotationWeatherPayload,
} from './annotation-model.js';
import {
  addDays,
  buildWeatherDashboardUrl,
  formatDateLocal,
  formatDisplayCoord,
  resolveWeatherStartDate,
} from './weather-dashboard.js';

export function weatherAnnotationDayCount(feature: AnnotationWeatherPayload) {
  return sanitizeAnnotationWeatherDays(feature.days);
}

/** Human-readable location for the card: the label, or the coordinate fallback. */
export function weatherAnnotationDisplayName(feature: AnnotationWeatherPayload) {
  const label = typeof feature.label === 'string' ? feature.label.trim() : '';
  if (label) return label;
  const [lng, lat] = feature.coordinate;
  return formatDisplayCoord({ lng, lat });
}

/** `2026-06-01` for a single day, `2026-06-01 – 2026-06-07` for a range. */
export function weatherAnnotationDateRangeLabel(feature: AnnotationWeatherPayload) {
  const first = resolveWeatherStartDate(feature.date);
  const days = weatherAnnotationDayCount(feature);
  const firstLabel = formatDateLocal(first);
  if (days <= 1) return firstLabel;
  return `${firstLabel} – ${formatDateLocal(addDays(first, days - 1))}`;
}

/** Collapsed-card summary: the date range, plus how many days when it spans more than one. */
export function weatherAnnotationSummaryLabel(feature: AnnotationWeatherPayload) {
  const days = weatherAnnotationDayCount(feature);
  if (days <= 1) return weatherAnnotationDateRangeLabel(feature);
  return `${weatherAnnotationDateRangeLabel(feature)} · ${days} days`;
}

/** Dashboard URL for the card: coordinates address the place, dates pick the days. */
export function weatherAnnotationDashboardUrl(
  feature: AnnotationWeatherPayload,
  { compact = true, immersive = true }: { compact?: boolean; immersive?: boolean } = {},
) {
  const [lng, lat] = feature.coordinate;
  return buildWeatherDashboardUrl({
    coordinate: { lng, lat },
    displayName: weatherAnnotationDisplayName(feature),
    startDate: sanitizeAnnotationWeatherDate(feature.date),
    days: weatherAnnotationDayCount(feature),
    compact,
    immersive,
  });
}
