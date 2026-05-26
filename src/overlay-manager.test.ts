import { describe, expect, it } from 'vitest';
import {
  scaledGeoJsonFillOpacity,
  scaledGeoJsonPolygonOutlineOpacity,
  scaledGeoJsonPolygonOutlineWidth,
  withFallbackColor,
} from './overlay-manager.js';

describe('overlay manager restored GeoJSON styling', () => {
  it('keeps default restored polygon styling visually equal to first import', () => {
    expect(scaledGeoJsonFillOpacity(0.95)).toBe(0.18);
    expect(scaledGeoJsonPolygonOutlineOpacity(0.95)).toBe(0.8);
    expect(scaledGeoJsonPolygonOutlineWidth(5)).toBe(2);
  });

  it('scales polygon styling down from the first-import defaults for user edits', () => {
    expect(scaledGeoJsonFillOpacity(0.475)).toBeCloseTo(0.09);
    expect(scaledGeoJsonPolygonOutlineOpacity(0.475)).toBeCloseTo(0.4);
    expect(scaledGeoJsonPolygonOutlineWidth(3)).toBe(1);
  });

  it('preserves data-driven GeoJSON stroke and color expressions', () => {
    expect(withFallbackColor(['coalesce', ['get', 'stroke'], '#000000'], '#ef4444')).toEqual([
      'coalesce',
      ['get', 'stroke'],
      '#ef4444',
    ]);
    expect(withFallbackColor(['coalesce', ['get', 'color'], ['get', 'stroke'], '#3b82f6'], '#ef4444')).toEqual([
      'coalesce',
      ['get', 'color'],
      ['get', 'stroke'],
      '#ef4444',
    ]);
  });

  it('keeps restored GeoJSON line colors data-driven while replacing only the fallback color', () => {
    expect(withFallbackColor(['coalesce', ['get', 'color'], ['get', 'stroke'], '#3b82f6'], '#22c55e')).toEqual([
      'coalesce',
      ['get', 'color'],
      ['get', 'stroke'],
      '#22c55e',
    ]);
  });
});
