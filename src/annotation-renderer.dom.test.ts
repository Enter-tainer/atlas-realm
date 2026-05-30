// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANNOTATION_DEFAULT_LAYER_ID, type AnnotationFeaturePayload } from './annotation-model.js';
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
    lngLat = { lng: 0, lat: 0 };
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
});

function createTestMap(): TestMap {
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
      return 12;
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
