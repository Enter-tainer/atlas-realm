/**
 * Daily forecast summary for `weather` annotation cards.
 *
 * The card's collapsed state shows real weather, not just a date range. The
 * expanded state embeds the weather.mgt.moe dashboard. Both read the same
 * upstream sources: the dashboard's main timeline is built on Open-Meteo (the
 * QWeather service is only used for minutely precipitation), so direct
 * Open-Meteo calls here stay consistent with the dashboard and need no API key.
 *
 * Long ranges need two sources. The deterministic API only reaches today + 15
 * days and rejects the whole request when either end falls outside that window,
 * so it leads for the days it can serve, and the `gfs05` ensemble — the same
 * model the dashboard falls back to — fills in beyond it, up to today + ~35 days.
 * Ensemble days are member averages rather than a forecast of record.
 */

import {
  addDays,
  formatDateLocal,
  resolveWeatherStartDate,
  sanitizeWeatherForecastDays,
  type LngLatLike,
} from './weather-dashboard.js';

const OPEN_METEO_DAILY_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'relative_humidity_2m_mean',
  'precipitation_sum',
];
/** 31 members, 50 km, and the ensemble model that reaches ~35 days out. */
const ENSEMBLE_MODEL = 'gfs05';
/** The deterministic API serves today + 15 days and rejects anything past it. */
const DETERMINISTIC_HORIZON_DAYS = 15;
/** Stay a day short of today + 35 so an ensemble request can never 400. */
const ENSEMBLE_HORIZON_DAYS = 34;

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

type DailySeries = Record<string, unknown>;

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

function dailyUrl(base: string, coordinate: LngLatLike, first: Date, last: Date, extra: Record<string, string> = {}) {
  const url = new URL(base);
  url.searchParams.set('latitude', coordinate.lat.toFixed(4));
  url.searchParams.set('longitude', coordinate.lng.toFixed(4));
  url.searchParams.set('daily', DAILY_FIELDS.join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', formatDateLocal(first));
  url.searchParams.set('end_date', formatDateLocal(last));
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url;
}

async function fetchDaily(url: URL, signal: AbortSignal): Promise<DailySeries | null> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data = (await response.json()) as { daily?: unknown };
  const daily = data.daily;
  return daily && typeof daily === 'object' ? (daily as DailySeries) : null;
}

function dailyDates(daily: DailySeries) {
  return Array.isArray(daily.time) ? daily.time.map((time) => String(time)) : [];
}

/** One key per ensemble member, e.g. `temperature_2m_max_member07`. */
function memberSeries(daily: DailySeries, field: string) {
  const prefix = `${field}_member`;
  return Object.keys(daily)
    .filter((key) => key.startsWith(prefix))
    .map((key) => daily[key]);
}

function memberAverage(series: unknown[], index: number, fallback: unknown) {
  const values = series.map((member) => numberAt(member, index)).filter((value): value is number => value != null);
  if (values.length === 0) return numberAt(fallback, index);
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** The most common member code; the more severe code breaks a tie. */
function memberMode(series: unknown[], index: number, fallback: unknown) {
  const counts = new Map<number, number>();
  for (const member of series) {
    const code = numberAt(member, index);
    if (code != null) counts.set(code, (counts.get(code) || 0) + 1);
  }
  if (counts.size === 0) return numberAt(fallback, index);
  let best = Number.NEGATIVE_INFINITY;
  let bestCount = -1;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code > best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function deterministicDays(daily: DailySeries) {
  return new Map(
    dailyDates(daily).map((date, index) => [
      date,
      {
        date,
        weatherCode: numberAt(daily.weather_code, index),
        tempMax: numberAt(daily.temperature_2m_max, index),
        tempMin: numberAt(daily.temperature_2m_min, index),
        humidity: numberAt(daily.relative_humidity_2m_mean, index),
        precipitation: numberAt(daily.precipitation_sum, index),
      } satisfies WeatherDaySummary,
    ]),
  );
}

function ensembleDays(daily: DailySeries) {
  const members = {
    weatherCode: memberSeries(daily, 'weather_code'),
    tempMax: memberSeries(daily, 'temperature_2m_max'),
    tempMin: memberSeries(daily, 'temperature_2m_min'),
    humidity: memberSeries(daily, 'relative_humidity_2m_mean'),
    precipitation: memberSeries(daily, 'precipitation_sum'),
  };
  return new Map(
    dailyDates(daily).map((date, index) => [
      date,
      {
        date,
        weatherCode: memberMode(members.weatherCode, index, daily.weather_code),
        tempMax: memberAverage(members.tempMax, index, daily.temperature_2m_max),
        tempMin: memberAverage(members.tempMin, index, daily.temperature_2m_min),
        humidity: memberAverage(members.humidity, index, daily.relative_humidity_2m_mean),
        precipitation: memberAverage(members.precipitation, index, daily.precipitation_sum),
      } satisfies WeatherDaySummary,
    ]),
  );
}

/**
 * Daily highs/lows for a coordinate and date range. Returns null when unavailable.
 * Deterministic days win over ensemble days when both cover the same date.
 */
export async function fetchWeatherDailySummary(
  { coordinate, startDate, days }: { coordinate: LngLatLike; startDate: unknown; days: unknown },
  signal: AbortSignal,
): Promise<WeatherDaySummary[] | null> {
  const first = resolveWeatherStartDate(startDate);
  const count = sanitizeWeatherForecastDays(days);
  const last = addDays(first, count - 1);
  const deterministicEnd = addDays(new Date(), DETERMINISTIC_HORIZON_DAYS);
  const ensembleEnd = addDays(new Date(), ENSEMBLE_HORIZON_DAYS);
  const wantsEnsemble = last > deterministicEnd;
  // Clamp the leading request: the API rejects a window whose far end is past its
  // horizon, which would otherwise lose the days it *could* have served.
  const leadEnd = last <= deterministicEnd ? last : deterministicEnd;
  const tailEnd = last <= ensembleEnd ? last : ensembleEnd;

  const lead: Promise<DailySeries | null> =
    first <= deterministicEnd
      ? fetchDaily(dailyUrl(OPEN_METEO_DAILY_URL, coordinate, first, leadEnd), signal).catch((): null => null)
      : Promise.resolve(null);
  const tail: Promise<DailySeries | null> =
    wantsEnsemble && first <= ensembleEnd
      ? fetchDaily(
          dailyUrl(OPEN_METEO_ENSEMBLE_URL, coordinate, first, tailEnd, { models: ENSEMBLE_MODEL }),
          signal,
        ).catch((): null => null)
      : Promise.resolve(null);
  const [deterministic, ensemble] = await Promise.all([lead, tail]);

  const merged = new Map<string, WeatherDaySummary>();
  if (ensemble) for (const [date, day] of ensembleDays(ensemble)) merged.set(date, day);
  if (deterministic) for (const [date, day] of deterministicDays(deterministic)) merged.set(date, day);
  const summary = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  return summary.length > 0 ? summary : null;
}
