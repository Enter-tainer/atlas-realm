import { describe, expect, it } from 'vitest';
import { weatherCondition } from './weather-icons.js';

describe('weather condition icons', () => {
  it('maps WMO codes to the same conditions weather.mgt.moe names', () => {
    expect(weatherCondition(0)).toMatchObject({ color: '#e69c00', label: 'Clear sky' });
    expect(weatherCondition(1).label).toBe('Mainly clear');
    expect(weatherCondition(2).label).toBe('Partly cloudy');
    expect(weatherCondition(3).label).toBe('Overcast');
    expect(weatherCondition(45).label).toBe('Fog');
    expect(weatherCondition(55).label).toBe('Dense drizzle');
    expect(weatherCondition(65).label).toBe('Heavy rain');
    expect(weatherCondition(75).label).toBe('Heavy snow');
    expect(weatherCondition(82).label).toBe('Violent rain showers');
    expect(weatherCondition(96).label).toBe('Thunderstorm with slight hail');
    expect(weatherCondition(null).label).toBe('Unknown conditions');
  });

  it('returns a non-empty lucide icon node and a hex colour for every code', () => {
    const codes = [
      null,
      0,
      1,
      2,
      3,
      45,
      48,
      51,
      53,
      55,
      56,
      57,
      61,
      63,
      65,
      66,
      67,
      71,
      73,
      75,
      77,
      80,
      81,
      82,
      85,
      86,
      95,
      96,
      99,
    ];
    for (const code of codes) {
      const { icon, color } = weatherCondition(code);
      expect(Array.isArray(icon)).toBe(true);
      expect(icon.length).toBeGreaterThan(0);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('separates visually distinct conditions', () => {
    expect(weatherCondition(0).icon).not.toBe(weatherCondition(3).icon);
    expect(weatherCondition(61).icon).not.toBe(weatherCondition(63).icon);
    expect(weatherCondition(95).icon).not.toBe(weatherCondition(0).icon);
    // Same glyph, different severity still reads differently by colour.
    expect(weatherCondition(2).icon).toBe(weatherCondition(3).icon);
    expect(weatherCondition(2).color).not.toBe(weatherCondition(3).color);
  });
});
