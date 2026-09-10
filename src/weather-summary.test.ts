import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWeatherDailySummary, weatherSummaryKey } from './weather-summary.js';

const DETERMINISTIC_URL = 'https://api.open-meteo.com/v1/forecast';
const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';

/** `count` date strings starting at `startIso`, built with UTC math so it is timezone-proof. */
function dateRange(startIso: string, count: number) {
  const [year, month, day] = startIso.split('-').map(Number);
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10),
  );
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('weather summary', () => {
  beforeEach(() => {
    // Pin the clock so the deterministic/ensemble horizon split is reproducible
    // instead of depending on the day the suite happens to run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 9, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('requests and parses the daily forecast for the exact window', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(DETERMINISTIC_URL);
      expect(url.searchParams.get('latitude')).toBe('31.2000');
      expect(url.searchParams.get('longitude')).toBe('121.5000');
      expect(url.searchParams.get('start_date')).toBe('2026-06-01');
      expect(url.searchParams.get('end_date')).toBe('2026-06-03');
      expect(String(url.searchParams.get('daily'))).toContain('weather_code');
      expect(String(url.searchParams.get('daily'))).toContain('relative_humidity_2m_mean');
      expect(String(url.searchParams.get('daily'))).toContain('precipitation_sum');
      return json({
        daily: {
          time: ['2026-06-01', '2026-06-02', '2026-06-03'],
          weather_code: [0, 3, 95],
          temperature_2m_max: [28.4, 24.1, 22],
          temperature_2m_min: [21, 19.6, null],
          relative_humidity_2m_mean: [62, 88, null],
          precipitation_sum: [0, 4.2, 12],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const summary = await fetchWeatherDailySummary(
      { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2026-06-01', days: 3 },
      new AbortController().signal,
    );

    // A window inside the deterministic horizon needs no ensemble request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary).toHaveLength(3);
    expect(summary?.[0]).toEqual({
      date: '2026-06-01',
      weatherCode: 0,
      tempMax: 28.4,
      tempMin: 21,
      humidity: 62,
      precipitation: 0,
    });
    expect(summary?.[2].tempMin).toBeNull();
    expect(summary?.[2].humidity).toBeNull();
  });

  it('leads with the deterministic forecast and fills the tail from the ensemble', async () => {
    const deterministicDates = dateRange('2026-06-01', 16);
    const ensembleDates = dateRange('2026-06-01', 20);
    const members = (offset: number) => ensembleDates.map((_, index) => offset + index);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const start = url.searchParams.get('start_date');
      const end = url.searchParams.get('end_date');
      if (url.origin + url.pathname === ENSEMBLE_URL) {
        // today + 15 is 2026-06-16, so the ensemble carries the whole window.
        expect(url.searchParams.get('models')).toBe('gfs05');
        expect(start).toBe('2026-06-01');
        expect(end).toBe('2026-06-20');
        return json({
          daily: {
            time: ensembleDates,
            weather_code: ensembleDates.map(() => 3),
            temperature_2m_max: members(20),
            temperature_2m_min: members(10),
            relative_humidity_2m_mean: ensembleDates.map(() => 60),
            precipitation_sum: ensembleDates.map(() => 1),
            weather_code_member01: ensembleDates.map(() => 3),
            weather_code_member02: ensembleDates.map(() => 61),
            temperature_2m_max_member01: members(20),
            temperature_2m_max_member02: members(22),
            temperature_2m_min_member01: members(10),
            temperature_2m_min_member02: members(10),
            relative_humidity_2m_mean_member01: ensembleDates.map(() => 50),
            relative_humidity_2m_mean_member02: ensembleDates.map(() => 70),
            precipitation_sum_member01: ensembleDates.map(() => 1),
            precipitation_sum_member02: ensembleDates.map(() => 2),
          },
        });
      }
      expect(url.origin + url.pathname).toBe(DETERMINISTIC_URL);
      // The leading request is clamped to the horizon instead of 400ing on 2026-06-20.
      expect(start).toBe('2026-06-01');
      expect(end).toBe('2026-06-16');
      return json({
        daily: {
          time: deterministicDates,
          weather_code: deterministicDates.map(() => 0),
          temperature_2m_max: deterministicDates.map((_, index) => 100 + index),
          temperature_2m_min: deterministicDates.map(() => 10),
          relative_humidity_2m_mean: deterministicDates.map(() => 50),
          precipitation_sum: deterministicDates.map(() => 0),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const summary = await fetchWeatherDailySummary(
      { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2026-06-01', days: 20 },
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary).toHaveLength(20);
    // Deterministic wins wherever both sources cover a date.
    expect(summary?.[0]).toEqual({
      date: '2026-06-01',
      weatherCode: 0,
      tempMax: 100,
      tempMin: 10,
      humidity: 50,
      precipitation: 0,
    });
    expect(summary?.[15].date).toBe('2026-06-16');
    expect(summary?.[15].tempMax).toBe(115);
    // Past the horizon the ensemble means take over: (20+i + 22+i) / 2.
    expect(summary?.[16]).toEqual({
      date: '2026-06-17',
      weatherCode: 61,
      tempMax: 37,
      tempMin: 26,
      humidity: 60,
      precipitation: 1.5,
    });
    expect(summary?.[19].date).toBe('2026-06-20');
    expect(summary?.[19].tempMax).toBe(40);
  });

  it('returns null without calling out when the whole window is out of range', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWeatherDailySummary(
        { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2027-01-01', days: 7 },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    // Beyond both horizons a request could only ever 400, so it is skipped.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when both sources reject the window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    );

    await expect(
      fetchWeatherDailySummary(
        { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2026-06-10', days: 20 },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it('keys summaries by coordinate and forecast window', () => {
    const base = { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2026-06-01', days: 3 };
    expect(weatherSummaryKey(base)).toBe(weatherSummaryKey({ ...base }));
    expect(weatherSummaryKey(base)).not.toBe(weatherSummaryKey({ ...base, startDate: '2026-06-02' }));
    expect(weatherSummaryKey(base)).not.toBe(weatherSummaryKey({ ...base, days: 4 }));
  });
});
