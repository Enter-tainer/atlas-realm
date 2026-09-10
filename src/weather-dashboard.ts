/**
 * Shared helpers for the weather dashboard (weather.mgt.moe / weather-dashboard).
 *
 * The dashboard is a fully static, iframe-embeddable page. Everything is
 * configured through the `route` query parameter:
 *
 *   ?route=location[~displayName]:YYYY-MM-DD;...&compact=1
 *
 * `location` is a city name or `lng,lat` coordinates; `compact=1` collapses
 * secondary lanes into a dense forecast view, and `immersive=true` hides the
 * dashboard's floating controls for iframe embeds. Forecast dates are explicit,
 * so a route URL always covers the exact journey days it was built for.
 *
 * Both the ephemeral weather point picker (weather.ts) and the persistent
 * `weather` annotations build their URLs here, so they stay in sync.
 */

const DEFAULT_WEATHER_DASHBOARD_URL = 'https://weather.mgt.moe/';
export const WEATHER_DASHBOARD_URL = import.meta.env.VITE_WEATHER_DASHBOARD_URL || DEFAULT_WEATHER_DASHBOARD_URL;
export const WEATHER_FORECAST_MAX_DAYS = 30;
export const WEATHER_FORECAST_DEFAULT_DAYS = 7;
const WEATHER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

export type LngLatLike = { lng: number; lat: number };
type NominatimAddress = Record<string, string | undefined>;
type NominatimReverseResponse = {
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
};

export function formatCoord(value: number) {
  return value.toFixed(5);
}

export function formatDateLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parse a `YYYY-MM-DD` string as a local (not UTC) date. Returns null when invalid. */
export function parseDateString(value: unknown): Date | null {
  if (typeof value !== 'string' || !WEATHER_DATE_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    Number.isNaN(date.getTime())
  ) {
    return null;
  }
  return date;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Resolve the forecast anchor date for a weather card.
 * Accepts a `YYYY-MM-DD` string, a Date, or nothing (falls back to today).
 */
export function resolveWeatherStartDate(value: unknown): Date {
  if (typeof value === 'string' && value) {
    const parsed = parseDateString(value);
    if (parsed) return parsed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return new Date();
}

/** Clamp the number of consecutive forecast days into the dashboard-supported range. */
export function sanitizeWeatherForecastDays(value: unknown, fallback = WEATHER_FORECAST_DEFAULT_DAYS) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(WEATHER_FORECAST_MAX_DAYS, Math.max(1, Math.round(number)));
}

export function formatDisplayCoord(lngLat: LngLatLike) {
  return `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
}

function sanitizeDisplayName(displayName: string) {
  return displayName.replace(/[~:;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Build a weather dashboard URL for one place across `days` consecutive
 * forecast days, starting at `startDate` (defaults to today). The place is
 * addressed by coordinates so the forecast is exact regardless of geocoding.
 */
export function buildWeatherDashboardUrl({
  coordinate,
  displayName = '',
  startDate,
  days = WEATHER_FORECAST_DEFAULT_DAYS,
  compact = true,
  immersive = false,
}: {
  coordinate: LngLatLike;
  displayName?: string;
  startDate?: unknown;
  days?: number;
  compact?: boolean;
  /** Hide the dashboard's own floating controls, for iframe embeds. */
  immersive?: boolean;
}) {
  const base = typeof window !== 'undefined' ? window.location.href : WEATHER_DASHBOARD_URL;
  const url = new URL(WEATHER_DASHBOARD_URL, base);
  const safeName = sanitizeDisplayName(displayName) || formatDisplayCoord(coordinate);
  const firstDay = resolveWeatherStartDate(startDate);
  const dayCount = sanitizeWeatherForecastDays(days);
  const routeEntries: string[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const date = addDays(firstDay, i);
    routeEntries.push(
      `${formatCoord(coordinate.lat)},${formatCoord(coordinate.lng)}~${safeName}:${formatDateLocal(date)}`,
    );
  }
  url.searchParams.set('route', routeEntries.join(';'));
  if (compact) url.searchParams.set('compact', '1');
  else url.searchParams.delete('compact');
  if (immersive) url.searchParams.set('immersive', 'true');
  else url.searchParams.delete('immersive');
  return url.toString();
}

export function buildWeatherRouteSummary({ startDate, days }: { startDate?: unknown; days?: number }) {
  const firstDay = resolveWeatherStartDate(startDate);
  const dayCount = sanitizeWeatherForecastDays(days);
  const lastDay = addDays(firstDay, dayCount - 1);
  return `${formatDateLocal(firstDay)} – ${formatDateLocal(lastDay)}`;
}

function formatNominatimAddress(data: NominatimReverseResponse = {}) {
  const address = data.address || {};
  const street = [address.road, address.house_number].filter(Boolean).join(' ');
  const locality = address.city || address.town || address.village || address.county || address.state;
  const parts = [
    data.name,
    street,
    address.neighbourhood || address.suburb || address.city_district || address.district,
    locality,
    address.country,
  ].filter((part, index, arr) => part && arr.indexOf(part) === index);
  return parts.join(', ') || data.display_name || '';
}

/** Reverse-geocode a lng/lat into a readable place name. */
export async function reverseGeocode(lngLat: LngLatLike, signal: AbortSignal) {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set('lat', lngLat.lat.toFixed(6));
  url.searchParams.set('lon', lngLat.lng.toFixed(6));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '16');
  url.searchParams.set('accept-language', navigator.language || 'zh-CN');

  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Nominatim reverse geocoding failed: ${response.status}`);

  const data = (await response.json()) as NominatimReverseResponse;
  return formatNominatimAddress(data) || formatDisplayCoord(lngLat);
}
