import { describe, expect, it } from 'vitest';
import {
  applyDrawingOverlayStackOrder,
  applyRemoteOverlayManifestOrder,
  overlayStackSyncItems,
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

describe('overlay manager drawing stack order', () => {
  it('re-applies the annotation overlay stack order when remote overlays are restored later', () => {
    const overlays = [{ id: 'remote-route' }, { id: 'drawing-overlay-default' }, { id: 'remote-area' }];

    expect(applyDrawingOverlayStackOrder(overlays, 'drawing-overlay-default', 0).map((overlay) => overlay.id)).toEqual([
      'drawing-overlay-default',
      'remote-route',
      'remote-area',
    ]);
    expect(applyDrawingOverlayStackOrder(overlays, 'drawing-overlay-default', 2).map((overlay) => overlay.id)).toEqual([
      'remote-route',
      'remote-area',
      'drawing-overlay-default',
    ]);
  });
});

describe('overlay manager remote overlay order', () => {
  it('keeps the server manifest order when a rejoining client materializes overlay content out of order', () => {
    const overlaysAfterOutOfOrderContentArrival = [
      {
        id: 'geojson-layer-1',
        name: 'nSmE',
        syncOverlayId: 'shared-nsme',
        remoteOverlayId: 'shared-nsme',
      },
      {
        id: 'geojson-layer-0',
        name: 'OSRM route',
        syncOverlayId: 'shared-osrm-route',
        remoteOverlayId: 'shared-osrm-route',
      },
      {
        id: 'drawing-overlay-default',
        name: 'Annotations',
      },
    ];

    const ordered = applyRemoteOverlayManifestOrder(overlaysAfterOutOfOrderContentArrival, [
      'shared-osrm-route',
      'shared-nsme',
    ]);

    expect(ordered.map((overlay) => overlay.name)).toEqual(['OSRM route', 'nSmE', 'Annotations']);
  });

  it('applies annotation stack order after restoring the remote manifest order', () => {
    const overlaysAfterOutOfOrderContentArrival = [
      {
        id: 'geojson-layer-1',
        name: 'nSmE',
        syncOverlayId: 'shared-nsme',
        remoteOverlayId: 'shared-nsme',
      },
      {
        id: 'drawing-overlay-default',
        name: 'Annotations',
      },
      {
        id: 'geojson-layer-0',
        name: 'OSRM route',
        syncOverlayId: 'shared-osrm-route',
        remoteOverlayId: 'shared-osrm-route',
      },
    ];

    const remoteOrdered = applyRemoteOverlayManifestOrder(overlaysAfterOutOfOrderContentArrival, [
      'shared-osrm-route',
      'shared-nsme',
    ]);
    const drawingOrdered = applyDrawingOverlayStackOrder(remoteOrdered, 'drawing-overlay-default', 1);

    expect(drawingOrdered.map((overlay) => overlay.name)).toEqual(['OSRM route', 'Annotations', 'nSmE']);
  });
});

describe('overlay manager reorder sync payload', () => {
  it('represents the full mixed layer stack when overlays and annotations are reordered', () => {
    const mixedStack = [
      { id: 'geojson-layer-0', type: 'geojson', syncOverlayId: 'shared-osrm-route' },
      { id: 'drawing-overlay-default', type: 'drawing', drawingLayerId: 'drawing-default' },
      { id: 'geojson-layer-1', type: 'geojson', syncOverlayId: 'shared-nsme' },
    ];

    expect(overlayStackSyncItems(mixedStack)).toEqual([
      { kind: 'overlay', id: 'shared-osrm-route' },
      { kind: 'drawing', layerId: 'drawing-default' },
      { kind: 'overlay', id: 'shared-nsme' },
    ]);
  });
});
