import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWeatherDailySummary, weatherSummaryKey } from './weather-summary.js';

describe('weather summary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests and parses the daily forecast for the exact window', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
      expect(url.searchParams.get('latitude')).toBe('31.2000');
      expect(url.searchParams.get('longitude')).toBe('121.5000');
      expect(url.searchParams.get('start_date')).toBe('2026-06-01');
      expect(url.searchParams.get('end_date')).toBe('2026-06-03');
      expect(String(url.searchParams.get('daily'))).toContain('weather_code');
      expect(String(url.searchParams.get('daily'))).toContain('relative_humidity_2m_mean');
      expect(String(url.searchParams.get('daily'))).toContain('precipitation_sum');
      return new Response(
        JSON.stringify({
          daily: {
            time: ['2026-06-01', '2026-06-02', '2026-06-03'],
            weather_code: [0, 3, 95],
            temperature_2m_max: [28.4, 24.1, 22],
            temperature_2m_min: [21, 19.6, null],
            relative_humidity_2m_mean: [62, 88, null],
            precipitation_sum: [0, 4.2, 12],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const summary = await fetchWeatherDailySummary(
      { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2026-06-01', days: 3 },
      new AbortController().signal,
    );

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

  it('returns null when open-meteo rejects the window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    );

    await expect(
      fetchWeatherDailySummary(
        { coordinate: { lng: 121.5, lat: 31.2 }, startDate: '2027-01-01', days: 7 },
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
