// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANNOTATION_DEFAULT_LAYER_ID, type AnnotationTextPayload } from './annotation-model.js';
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

function textFeature(note: string): AnnotationTextPayload {
  return {
    id: 'note-a',
    layerId: ANNOTATION_DEFAULT_LAYER_ID,
    type: 'text',
    coordinate: [121.5, 31.2],
    width: 200,
    height: 100,
    label: 'Test Note',
    note,
    color: '#2563eb',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: '',
  };
}

function getTextMarkerBody(feature: AnnotationTextPayload): string {
  const store = new LayerStore();
  store.upsertFeature(feature);
  const map = createTestMap();
  const renderer = installAnnotationRenderer(map, store);

  map
    .getContainer()
    .dispatchEvent(new CustomEvent('annotation:activefeaturechange', { detail: { activeId: feature.id } }));

  const marker = document.querySelector<HTMLElement>('.annotation-text-note');
  const body = marker?.querySelector<HTMLElement>('.annotation-text-note-body');
  const title = marker?.querySelector<HTMLElement>('.annotation-text-note-title');

  const result = {
    bodyHTML: body?.innerHTML || '',
    bodyText: body?.textContent || '',
    titleText: title?.textContent || '',
    tooltip: marker?.title || '',
    ariaLabel: marker?.getAttribute('aria-label') || '',
  };

  renderer.destroy();
  return JSON.stringify(result);
}

describe('markdown rendering in text markers', () => {
  it('renders bold markdown as HTML in note body', () => {
    const raw = getTextMarkerBody(textFeature('**bold text**'));
    const result = JSON.parse(raw);
    expect(result.bodyHTML).toContain('<strong>bold text</strong>');
  });

  it('renders italic markdown as HTML in note body', () => {
    const raw = getTextMarkerBody(textFeature('*italic text*'));
    const result = JSON.parse(raw);
    expect(result.bodyHTML).toContain('<em>italic text</em>');
  });

  it('renders links with target=_blank in note body', () => {
    const raw = getTextMarkerBody(textFeature('[link](https://example.com)'));
    const result = JSON.parse(raw);
    expect(result.bodyHTML).toContain('target="_blank"');
    expect(result.bodyHTML).toContain('rel="noopener"');
    expect(result.bodyHTML).toContain('>link</a>');
  });

  it('keeps title as plain text', () => {
    const raw = getTextMarkerBody(textFeature('plain text'));
    const result = JSON.parse(raw);
    expect(result.titleText).toBe('Test Note');
    expect(result.titleText).not.toContain('<');
  });

  it('keeps tooltip and aria-label as plain text', () => {
    const raw = getTextMarkerBody(textFeature('**bold**'));
    const result = JSON.parse(raw);
    expect(result.tooltip).toBe('Test Note');
    expect(result.ariaLabel).toBe('Test Note');
    expect(result.tooltip).not.toContain('**');
    expect(result.tooltip).not.toContain('<strong>');
  });

  it('sanitizes dangerous HTML in note body', () => {
    const raw = getTextMarkerBody(textFeature('<script>alert("xss")</script>'));
    const result = JSON.parse(raw);
    expect(result.bodyHTML).not.toContain('<script');
    expect(result.bodyHTML).not.toContain('</script>');
  });

  it('renders plain text as plain text in note body', () => {
    const raw = getTextMarkerBody(textFeature('plain text without formatting'));
    const result = JSON.parse(raw);
    expect(result.bodyText).toContain('plain text without formatting');
    expect(result.bodyHTML).toContain('plain text without formatting');
  });
});
