/**
 * Daily forecast summary for `weather` annotation cards.
 *
 * The card's collapsed state shows real weather, not just a date range. The
 * expanded state embeds the weather.mgt.moe dashboard. Both read the same
 * upstream source: the dashboard's main timeline is built on Open-Meteo (the
 * QWeather service is only used for minutely precipitation), so a direct
 * Open-Meteo daily call here stays consistent with the dashboard and needs no
 * API key.
 */

import {
  addDays,
  formatDateLocal,
  resolveWeatherStartDate,
  sanitizeWeatherForecastDays,
  type LngLatLike,
} from './weather-dashboard.js';

const OPEN_METEO_DAILY_URL = 'https://api.open-meteo.com/v1/forecast';
const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'relative_humidity_2m_mean',
  'precipitation_sum',
];

export type WeatherDaySummary = {
  date: string;
  weatherCode: number | null;
  tempMax: number | null;
  tempMin: number | null;
  /** Daily mean relative humidity, percent. */
  humidity: number | null;
  /** Daily precipitation total, millimetres. */
  precipitation: number | null;
};

type OpenMeteoDailyResponse = {
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    relative_humidity_2m_mean?: unknown;
    precipitation_sum?: unknown;
  };
};

export function weatherSummaryKey({
  coordinate,
  startDate,
  days,
}: {
  coordinate: LngLatLike;
  startDate: unknown;
  days: unknown;
}) {
  const first = resolveWeatherStartDate(startDate);
  const count = sanitizeWeatherForecastDays(days);
  return `${coordinate.lat.toFixed(4)},${coordinate.lng.toFixed(4)}:${formatDateLocal(first)}:${count}`;
}

function numberAt(series: unknown, index: number) {
  if (!Array.isArray(series)) return null;
  const raw = series[index];
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Daily highs/lows for a coordinate and date range. Returns null when unavailable. */
export async function fetchWeatherDailySummary(
  { coordinate, startDate, days }: { coordinate: LngLatLike; startDate: unknown; days: unknown },
  signal: AbortSignal,
): Promise<WeatherDaySummary[] | null> {
  const first = resolveWeatherStartDate(startDate);
  const count = sanitizeWeatherForecastDays(days);
  const url = new URL(OPEN_METEO_DAILY_URL);
  url.searchParams.set('latitude', coordinate.lat.toFixed(4));
  url.searchParams.set('longitude', coordinate.lng.toFixed(4));
  url.searchParams.set('daily', DAILY_FIELDS.join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', formatDateLocal(first));
  url.searchParams.set('end_date', formatDateLocal(addDays(first, count - 1)));

  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data = (await response.json()) as OpenMeteoDailyResponse;
  const times = Array.isArray(data.daily?.time) ? data.daily.time : [];
  const summary = times.map((time, index) => ({
    date: String(time),
    weatherCode: numberAt(data.daily?.weather_code, index),
    tempMax: numberAt(data.daily?.temperature_2m_max, index),
    tempMin: numberAt(data.daily?.temperature_2m_min, index),
    humidity: numberAt(data.daily?.relative_humidity_2m_mean, index),
    precipitation: numberAt(data.daily?.precipitation_sum, index),
  }));
  return summary.length > 0 ? summary : null;
}
