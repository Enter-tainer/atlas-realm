// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANNOTATION_DEFAULT_LAYER_ID,
  type AnnotationFeaturePayload,
  type AnnotationWeatherPayload,
} from './annotation-model.js';
import { installAnnotationRenderer } from './annotation-renderer.js';
import { LayerStore } from './layer-store.js';

type MarkerRecord = {
  element: HTMLElement;
  options: { draggable?: boolean };
};

const markerRecords = vi.hoisted(() => [] as MarkerRecord[]);

vi.mock('maplibre-gl', () => {
  class Marker {
    element: HTMLElement;
    options: { draggable?: boolean };
    lngLat: { lng: number; lat: number } | null = null;
    listeners = new Map<string, Set<() => void>>();

    constructor(options: { element?: HTMLElement; draggable?: boolean } = {}) {
      this.element = options.element || document.createElement('div');
      this.options = options;
      markerRecords.push({ element: this.element, options });
    }

    setLngLat(value: [number, number] | { lng: number; lat: number }) {
      if (Array.isArray(value)) this.lngLat = { lng: value[0], lat: value[1] };
      else this.lngLat = { lng: value.lng, lat: value.lat };
      return this;
    }

    getLngLat() {
      return this.lngLat;
    }

    addTo(map: { getContainer(): HTMLElement }) {
      // Real MapLibre projects the marker position inside `addTo`, so attaching
      // one before `setLngLat` throws and strands an untracked element in the
      // DOM. Keep the same invariant so the ordering cannot regress silently.
      if (!this.lngLat) throw new TypeError("Cannot read properties of null (reading 'lng')");
      map.getContainer().appendChild(this.element);
      return this;
    }

    remove() {
      this.element.remove();
    }

    on(event: string, listener: () => void) {
      const listeners = this.listeners.get(event) || new Set<() => void>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: () => void) {
      this.listeners.get(event)?.delete(listener);
      return this;
    }
  }

  return { default: { Marker } };
});

type TestSource = {
  data: object;
  setData(data: object): void;
};

type TestMap = {
  _styleInfrastructureInitialized: boolean;
  container: HTMLElement;
  sources: Map<string, TestSource>;
  layers: Map<string, object>;
  style: { _loaded: boolean };
  isStyleLoaded(): boolean;
  setGlobalStateProperty(): void;
  once(): void;
  on(): void;
  off(): void;
  getZoom(): number;
  project(): { x: number; y: number };
  unproject(): { lng: number; lat: number };
  addSource(id: string, source: { data?: object }): void;
  getSource(id: string): TestSource | undefined;
  addLayer(layer: { id?: string }): void;
  getLayer(id: string): object | undefined;
  hasImage(): boolean;
  addImage(): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  getContainer(): HTMLElement;
};

afterEach(() => {
  markerRecords.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function createTestMap(zoom = 12): TestMap {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    _styleInfrastructureInitialized: true,
    container,
    sources: new Map(),
    layers: new Map(),
    style: { _loaded: true },
    isStyleLoaded() {
      return true;
    },
    setGlobalStateProperty() {},
    once() {},
    on() {},
    off() {},
    getZoom() {
      return zoom;
    },
    project() {
      return { x: 0, y: 0 };
    },
    unproject() {
      return { lng: 0, lat: 0 };
    },
    addSource(id, source) {
      this.sources.set(id, {
        data: source.data || { type: 'FeatureCollection', features: [] },
        setData(data: object) {
          this.data = data;
        },
      });
    },
    getSource(id) {
      return this.sources.get(id);
    },
    addLayer(layer) {
      if (layer.id) this.layers.set(layer.id, layer);
    },
    getLayer(id) {
      return this.layers.get(id);
    },
    hasImage() {
      return true;
    },
    addImage() {},
    removeLayer(id) {
      this.layers.delete(id);
    },
    removeSource(id) {
      this.sources.delete(id);
    },
    getContainer() {
      return container;
    },
  };
}

function polygonFeature(): AnnotationFeaturePayload {
  return {
    id: 'area-a',
    layerId: ANNOTATION_DEFAULT_LAYER_ID,
    type: 'polygon',
    points: [
      [121.5, 31.2],
      [121.7, 31.2],
      [121.6, 31.4],
    ],
    width: 3,
    lineStyle: 'solid',
    opacity: 0.95,
    fillOpacity: 0.22,
    label: 'Area A',
    note: '',
    color: '#16a34a',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: '',
  };
}

function weatherFeature(overrides: Partial<AnnotationWeatherPayload> = {}): AnnotationFeaturePayload {
  return {
    id: 'weather-a',
    layerId: ANNOTATION_DEFAULT_LAYER_ID,
    type: 'weather',
    coordinate: [121.5, 31.2],
    date: '2026-06-01',
    days: 2,
    label: 'Shanghai',
    note: '',
    color: '#0ea5e9',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: '',
    ...overrides,
  };
}

describe('annotation renderer polygon vertex handles', () => {
  it('lets drag start events reach MapLibre marker handling while keeping clicks local', () => {
    const map = createTestMap();
    const store = new LayerStore();
    store.upsertFeature(polygonFeature());
    const renderer = installAnnotationRenderer(map, store);

    map
      .getContainer()
      .dispatchEvent(new CustomEvent('annotation:activefeaturechange', { detail: { activeId: 'area-a' } }));

    const vertex = document.querySelector<HTMLButtonElement>('.annotation-polygon-vertex');
    expect(vertex).toBeTruthy();
    expect(markerRecords).toHaveLength(3);
    expect(markerRecords.every((record) => record.options.draggable)).toBe(true);

    let sawMouseDown = false;
    map.getContainer().addEventListener('mousedown', () => {
      sawMouseDown = true;
    });
    vertex?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(sawMouseDown).toBe(true);

    let sawClick = false;
    let featureClickId = '';
    map.getContainer().addEventListener('click', () => {
      sawClick = true;
    });
    map.getContainer().addEventListener('annotation:featureclick', (event) => {
      featureClickId = String((event as CustomEvent<{ id?: string }>).detail?.id || '');
    });
    vertex?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sawClick).toBe(false);
    expect(featureClickId).toBe('area-a');

    renderer.destroy();
  });
});

describe('annotation renderer weather annotations', () => {
  it('stays a dot-plus-text label until a click expands the dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              daily: {
                time: ['2026-06-01', '2026-06-02'],
                weather_code: [0, 61],
                temperature_2m_max: [28, 24],
                temperature_2m_min: [21, 19],
                relative_humidity_2m_mean: [62, 88],
                precipitation_sum: [0, 4.2],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const map = createTestMap();
    const store = new LayerStore();
    store.upsertFeature(weatherFeature());
    const renderer = installAnnotationRenderer(map, store);

    // Collapsed there is no card at all, only the label.
    expect(document.querySelector('.annotation-weather-card')).toBeFalsy();
    const label = document.querySelector<HTMLElement>('.annotation-weather-label');
    expect(label).toBeTruthy();
    expect(label?.querySelector('.annotation-weather-label-dot')).toBeTruthy();
    await vi.waitFor(() => {
      expect(label?.querySelector('.annotation-weather-label-text')?.textContent).toBe('28°/21° · 62% · 0mm');
    });

    // One click goes straight to the biggest form: the dashboard card.
    label?.click();
    expect(document.querySelector('.annotation-weather-label')).toBeFalsy();
    const card = document.querySelector<HTMLElement>('.annotation-weather-card');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.annotation-weather-card-title')?.textContent).toBe('Shanghai');
    expect(card?.querySelector('.annotation-weather-card-meta')?.textContent).toBe('2026-06-01 – 2026-06-02 · 2 days');
    // The card only exists expanded, so the embed is live immediately.
    expect(card?.querySelector('.annotation-weather-card-body')?.hasAttribute('hidden')).toBe(false);
    const frame = card?.querySelector<HTMLIFrameElement>('.annotation-weather-card-frame');
    expect(frame?.getAttribute('src')).toContain('https://weather.mgt.moe/');
    expect(frame?.getAttribute('src')).toContain('compact=1');
    expect(frame?.getAttribute('src')).toContain('immersive=true');
    // The external link opens the real dashboard, so it restores its own chrome.
    const openHref = card?.querySelector<HTMLAnchorElement>('.annotation-weather-card-open')?.href || '';
    expect(openHref).not.toContain('immersive');
    expect(openHref).not.toContain('compact=1');

    await vi.waitFor(() => {
      expect(card?.querySelectorAll('.annotation-weather-card-day')).toHaveLength(2);
    });
    // Weather icons are lucide SVGs, not emoji, matching weather.mgt.moe.
    expect(card?.querySelector('.annotation-weather-card-day-icon')?.textContent).toBe('');
    expect(card?.querySelector('.annotation-weather-card-day-icon svg')).toBeTruthy();
    expect(card?.querySelector<HTMLElement>('.annotation-weather-card-day-icon')?.title).toBe('Clear sky');
    expect(card?.querySelector('.annotation-weather-card-day-temps')?.textContent).toBe('28° 21°');
    // Per-day humidity and rain totals ride along in the cell tooltip.
    expect(card?.querySelector<HTMLElement>('.annotation-weather-card-day')?.title).toBe('6/1: Clear sky · 62% · 0mm');
    expect(card?.querySelectorAll<HTMLElement>('.annotation-weather-card-day')[1]?.title).toBe(
      '6/2: Slight rain · 88% · 4.2mm',
    );

    // The header toggles back down to the label.
    card?.querySelector<HTMLButtonElement>('.annotation-weather-card-header')?.click();
    expect(document.querySelector('.annotation-weather-card')).toBeFalsy();
    expect(document.querySelector('.annotation-weather-label')).toBeTruthy();

    renderer.destroy();
  });

  it('folds a one-day expanded card into the header row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              daily: {
                time: ['2026-06-01'],
                weather_code: [3],
                temperature_2m_max: [26],
                temperature_2m_min: [18],
                relative_humidity_2m_mean: [55],
                precipitation_sum: [2.4],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const map = createTestMap();
    const store = new LayerStore();
    store.upsertFeature(weatherFeature({ days: 1 }));
    const renderer = installAnnotationRenderer(map, store);

    document.querySelector<HTMLElement>('.annotation-weather-label')?.click();
    const card = document.querySelector<HTMLElement>('.annotation-weather-card');
    expect(card?.dataset.days).toBe('1');
    expect(card?.querySelector('.annotation-weather-card-meta')?.textContent).toBe('2026-06-01');

    await vi.waitFor(() => {
      expect(card?.querySelector('.annotation-weather-card-day-temps')?.textContent).toBe('26°/18°');
    });
    // The single row lives inside the header, not as a separate strip below it.
    expect(card?.querySelector('.annotation-weather-card-detail .annotation-weather-card-strip')).toBeTruthy();
    expect(card?.querySelector<HTMLElement>('.annotation-weather-card-day-icon')?.title).toBe('Overcast');
    expect(card?.querySelector('.annotation-weather-card-day-icon svg')).toBeTruthy();
    // Humidity and precipitation in millimetres replace the old chance-of-rain %.
    expect(card?.querySelector('.annotation-weather-card-day-detail')?.textContent).toBe('55% · 2.4mm');

    renderer.destroy();
  });

  it('uses the same label form at every zoom, and selects on click', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              daily: {
                time: ['2026-06-01', '2026-06-02', '2026-06-03'],
                weather_code: [0, 61, 3],
                temperature_2m_max: [28, 24, 20],
                temperature_2m_min: [21, 19, 15],
                relative_humidity_2m_mean: [62, 88, 70],
                precipitation_sum: [0, 4.2, 0.4],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    // Zoom 8 shows the same label shape as zoom 12 did in the tests above.
    const map = createTestMap(8);
    const store = new LayerStore();
    store.upsertFeature(weatherFeature());
    const renderer = installAnnotationRenderer(map, store);

    expect(document.querySelector('.annotation-weather-card')).toBeFalsy();
    const label = document.querySelector<HTMLElement>('.annotation-weather-label');
    expect(label).toBeTruthy();
    expect(label?.dataset.annotationId).toBe('weather-a');

    // Only the first day of a range fits on the line, icon included.
    await vi.waitFor(() => {
      expect(label?.querySelector('.annotation-weather-label-text')?.textContent).toBe('28°/21° · 62% · 0mm');
    });
    expect(label?.querySelector<HTMLElement>('.annotation-weather-label-icon')?.title).toBe('Clear sky');
    expect(label?.querySelector('.annotation-weather-label-icon svg')).toBeTruthy();

    const selectedIds: string[] = [];
    map.getContainer().addEventListener('annotation:featureclick', (event) => {
      selectedIds.push(String((event as CustomEvent<{ id?: string }>).detail?.id || ''));
    });
    label?.click();
    // The same click selects the annotation and opens it.
    expect(selectedIds).toEqual(['weather-a']);
    expect(document.querySelector('.annotation-weather-card')).toBeTruthy();

    renderer.destroy();
  });

  it('exposes a visible edit action that requests the rename editor', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ daily: { time: [] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const map = createTestMap();
    const store = new LayerStore();
    store.upsertFeature(weatherFeature({ days: 1 }));
    const renderer = installAnnotationRenderer(map, store);

    const editedIds: string[] = [];
    map.getContainer().addEventListener('annotation:featuredblclick', (event) => {
      editedIds.push(String((event as CustomEvent<{ id?: string }>).detail?.id || ''));
    });

    // Renaming lives on the expanded card, so open it first.
    document.querySelector<HTMLElement>('.annotation-weather-label')?.click();
    const edit = document.querySelector<HTMLButtonElement>('.annotation-weather-card-edit');
    expect(edit?.textContent).toBe('Edit card');
    edit?.click();
    expect(editedIds).toEqual(['weather-a']);

    renderer.destroy();
  });
});
