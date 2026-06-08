// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { addGeoJsonToMap, drainGpxQueue, processOrQueueGeoJson } from './gpx.js';

type TestMap = Parameters<typeof addGeoJsonToMap>[0] & {
  container: HTMLElement;
  sources: Array<{ id: string; source: unknown }>;
  layers: Array<{ id?: string; type?: string }>;
  fitBoundsCalls: Array<{ bounds: [[number, number], [number, number]]; options?: Record<string, unknown> }>;
  ready: boolean;
};

function createTestMap(ready = true): TestMap {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    sources: [],
    layers: [],
    fitBoundsCalls: [],
    ready,
    loaded() {
      return this.ready;
    },
    getContainer() {
      return container;
    },
    addSource(id, source) {
      this.sources.push({ id, source });
    },
    addLayer(layer) {
      this.layers.push(layer as { id?: string; type?: string });
    },
    hasImage() {
      return true;
    },
    addImage() {},
    fitBounds(bounds, options) {
      this.fitBoundsCalls.push({ bounds, options });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('gpx and geojson layer import', () => {
  it('adds flattened GeoJSON geometry collections with the same public summary', () => {
    const map = createTestMap();
    const layerEvents: unknown[] = [];
    map.container.addEventListener('layer:add', (event) => {
      layerEvents.push((event as CustomEvent).detail);
    });

    const layer = addGeoJsonToMap(
      map,
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Mixed layer' },
            geometry: {
              type: 'GeometryCollection',
              geometries: [
                {
                  type: 'LineString',
                  coordinates: [
                    [121.5, 31.2],
                    [121.6, 31.3],
                  ],
                },
                { type: 'Point', coordinates: [121.55, 31.25] },
                {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [121.5, 31.2],
                      [121.6, 31.2],
                      [121.6, 31.3],
                      [121.5, 31.2],
                    ],
                  ],
                },
              ],
            },
          },
        ],
      },
      { name: '  Mixed   GeoJSON  ' },
    );

    expect(layer).toMatchObject({
      type: 'geojson',
      subType: 'geojson',
      name: 'Mixed GeoJSON',
      lines: 1,
      points: 1,
      polygons: 1,
      features: 3,
      bounds: [
        [121.5, 31.2],
        [121.6, 31.3],
      ],
    });
    expect(map.sources).toHaveLength(1);
    expect(map.layers.map((item) => item.type)).toEqual([
      'fill',
      'line',
      'symbol',
      'line',
      'line',
      'symbol',
      'symbol',
      'symbol',
    ]);
    expect(layerEvents).toHaveLength(1);
    expect(layerEvents[0]).toMatchObject({ name: 'Mixed GeoJSON', features: 3 });
  });

  it('returns bounds before map load and materializes queued GeoJSON on drain', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const map = createTestMap(false);

    const result = processOrQueueGeoJson(
      map,
      {
        type: 'Feature',
        properties: { name: 'Queued line' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [121.5, 31.2],
            [121.7, 31.4],
          ],
        },
      },
      { name: 'Queued' },
    );

    expect(result).toEqual({
      bounds: [
        [121.5, 31.2],
        [121.7, 31.4],
      ],
    });
    expect(map.sources).toHaveLength(0);

    drainGpxQueue(map);

    expect(map.sources).toHaveLength(1);
    expect(map.layers.map((item) => item.type)).toEqual(['line', 'line', 'symbol']);
    expect(map.fitBoundsCalls).toEqual([
      {
        bounds: [
          [121.5, 31.2],
          [121.7, 31.4],
        ],
        options: { padding: 60, maxZoom: 15 },
      },
    ]);
  });
});
