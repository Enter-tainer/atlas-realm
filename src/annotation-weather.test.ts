import { describe, expect, it } from 'vitest';
import {
  weatherAnnotationDashboardUrl,
  weatherAnnotationDateRangeLabel,
  weatherAnnotationDayCount,
  weatherAnnotationDisplayName,
  weatherAnnotationSummaryLabel,
} from './annotation-weather.js';
import type { AnnotationWeatherPayload } from './annotation-model.js';

function weatherFeature(overrides: Partial<AnnotationWeatherPayload> = {}): AnnotationWeatherPayload {
  return {
    id: 'weather-a',
    layerId: 'annotation-default',
    type: 'weather',
    coordinate: [121.5, 31.2],
    date: '2026-06-01',
    days: 7,
    label: 'Shanghai',
    note: '',
    color: '#0ea5e9',
    createdAt: 0,
    updatedAt: 0,
    updatedBy: '',
    ...overrides,
  };
}

describe('weather annotation helpers', () => {
  it('labels a card with its place name and forecast window', () => {
    const feature = weatherFeature();

    expect(weatherAnnotationDisplayName(feature)).toBe('Shanghai');
    expect(weatherAnnotationDayCount(feature)).toBe(7);
    expect(weatherAnnotationDateRangeLabel(feature)).toBe('2026-06-01 – 2026-06-07');
    expect(weatherAnnotationSummaryLabel(feature)).toBe('2026-06-01 – 2026-06-07 · 7 days');
  });

  it('collapses a single-day window and clamps out-of-range values', () => {
    expect(weatherAnnotationDateRangeLabel(weatherFeature({ days: 1 }))).toBe('2026-06-01');
    expect(weatherAnnotationSummaryLabel(weatherFeature({ days: 1 }))).toBe('2026-06-01');
    expect(weatherAnnotationDayCount(weatherFeature({ days: 99 }))).toBe(30);
  });

  it('falls back to coordinates when the card has no label', () => {
    expect(weatherAnnotationDisplayName(weatherFeature({ label: '  ' }))).toBe('31.2000, 121.5000');
  });

  it('builds a compact immersive dashboard URL for the exact date range', () => {
    const url = new URL(weatherAnnotationDashboardUrl(weatherFeature()));
    expect(url.origin + url.pathname).toBe('https://weather.mgt.moe/');
    expect(url.searchParams.get('compact')).toBe('1');
    expect(url.searchParams.get('immersive')).toBe('true');

    const entries = String(url.searchParams.get('route')).split(';');
    expect(entries).toHaveLength(7);
    expect(entries[0]).toBe('31.20000,121.50000~Shanghai:2026-06-01');
    expect(entries[6]).toBe('31.20000,121.50000~Shanghai:2026-06-07');
  });

  it('can build the full dashboard link without the embed flags', () => {
    const url = new URL(weatherAnnotationDashboardUrl(weatherFeature(), { compact: false, immersive: false }));
    expect(url.searchParams.get('compact')).toBeNull();
    expect(url.searchParams.get('immersive')).toBeNull();
    expect(String(url.searchParams.get('route')).split(';')).toHaveLength(7);
  });
});
