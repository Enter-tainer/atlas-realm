import { describe, expect, it } from 'vitest';
import {
  applyRemoteFileLayerManifestOrder,
  layerStackSyncItems,
  scaledGeoJsonFillOpacity,
  scaledGeoJsonPolygonOutlineOpacity,
  scaledGeoJsonPolygonOutlineWidth,
  withFallbackColor,
} from './layer-manager.js';

describe('layer manager restored GeoJSON styling', () => {
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

describe('layer manager remote file layer order', () => {
  it('keeps the server layer order when a rejoining client materializes file content out of order', () => {
    const layersAfterOutOfOrderContentArrival = [
      {
        id: 'geojson-layer-1',
        name: 'nSmE',
        syncLayerId: 'shared-nsme',
        remoteLayerId: 'shared-nsme',
      },
      {
        id: 'geojson-layer-0',
        name: 'OSRM route',
        syncLayerId: 'shared-osrm-route',
        remoteLayerId: 'shared-osrm-route',
      },
      {
        id: 'annotation-layer-annotation-default',
        name: 'Annotations',
      },
    ];

    const ordered = applyRemoteFileLayerManifestOrder(layersAfterOutOfOrderContentArrival, [
      'shared-osrm-route',
      'shared-nsme',
    ]);

    expect(ordered.map((layer) => layer.name)).toEqual(['OSRM route', 'nSmE', 'Annotations']);
  });
});

describe('layer manager reorder sync payload', () => {
  it('represents the full mixed layer stack when file layers and annotations are reordered', () => {
    const mixedStack = [
      { id: 'geojson-layer-0', type: 'geojson', syncLayerId: 'shared-osrm-route' },
      { id: 'annotation-layer-annotation-default', type: 'annotation', annotationLayerId: 'annotation-default' },
      { id: 'geojson-layer-1', type: 'geojson', syncLayerId: 'shared-nsme' },
    ];

    expect(layerStackSyncItems(mixedStack)).toEqual([
      { kind: 'file', layerId: 'shared-osrm-route' },
      { kind: 'annotation', layerId: 'annotation-default' },
      { kind: 'file', layerId: 'shared-nsme' },
    ]);
  });
});
