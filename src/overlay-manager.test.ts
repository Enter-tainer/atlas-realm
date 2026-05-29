import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDrawingDoc } from './drawing-model.js';
import {
  applyDrawingOverlayStackOrder,
  applyRemoteOverlayManifestOrder,
  installOverlayManager,
  overlayStackSyncItems,
  scaledGeoJsonFillOpacity,
  scaledGeoJsonPolygonOutlineOpacity,
  scaledGeoJsonPolygonOutlineWidth,
  withFallbackColor,
} from './overlay-manager.js';
import type { DrawingStore } from './drawing-store.js';

type TestMap = {
  container: HTMLElement;
  layerIds: string[];
  moves: string[];
  addControl(control: { onAdd(map: TestMap): HTMLElement }, position?: string): void;
  getContainer(): HTMLElement;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  hasImage(name: string): boolean;
  addImage(name: string, image: ImageData, options?: { pixelRatio?: number }): void;
  fitBounds(): void;
  easeTo(): void;
  getZoom(): number;
  getLayer(layerId: string): object | undefined;
  getSource(sourceId?: string): object | undefined;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  getPaintProperty(layerId: string, name: string): unknown;
  removeLayer(layerId: string): void;
  removeSource(sourceId?: string): void;
  moveLayer(layerId: string): void;
};
type TestWindow = {
  document: Document;
  CustomEvent: new (type: string, init?: CustomEventInit) => CustomEvent;
  EventTarget: unknown;
  HTMLElement: unknown;
  ImageData?: unknown;
  PointerEvent: new (type: string, init?: Record<string, unknown>) => Event;
  dispatchEvent(event: Event): boolean;
};

let previousWindow: unknown;
let previousDocument: unknown;
let previousCustomEvent: unknown;
let previousEventTarget: unknown;
let previousHTMLElement: unknown;
let previousImageData: unknown;

function setGlobal(name: string, value: unknown) {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  setGlobal('window', previousWindow);
  setGlobal('document', previousDocument);
  setGlobal('CustomEvent', previousCustomEvent);
  setGlobal('EventTarget', previousEventTarget);
  setGlobal('HTMLElement', previousHTMLElement);
  setGlobal('ImageData', previousImageData);
});

function installDom() {
  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  previousCustomEvent = globalThis.CustomEvent;
  previousEventTarget = globalThis.EventTarget;
  previousHTMLElement = globalThis.HTMLElement;
  previousImageData = globalThis.ImageData;

  const window = new Window() as unknown as TestWindow;
  setGlobal('window', window);
  setGlobal('document', window.document);
  setGlobal('CustomEvent', window.CustomEvent);
  setGlobal('EventTarget', window.EventTarget);
  setGlobal('HTMLElement', window.HTMLElement);
  setGlobal('ImageData', window.ImageData);
  return window;
}

function createTestMap(): TestMap {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const layerIds: string[] = [];
  const moves: string[] = [];
  const map: TestMap = {
    container,
    layerIds,
    moves,
    addControl(control) {
      container.appendChild(control.onAdd(this));
    },
    getContainer() {
      return container;
    },
    addSource() {},
    addLayer(layer) {
      const id = (layer as { id?: unknown }).id;
      if (typeof id === 'string') layerIds.push(id);
    },
    hasImage() {
      return true;
    },
    addImage() {},
    fitBounds() {},
    easeTo() {},
    getZoom() {
      return 12;
    },
    getLayer(layerId) {
      return layerIds.includes(layerId) ? { type: 'line' } : undefined;
    },
    getSource(sourceId) {
      return sourceId ? {} : undefined;
    },
    setLayoutProperty() {},
    setPaintProperty() {},
    getPaintProperty() {
      return undefined;
    },
    removeLayer(layerId) {
      const index = layerIds.indexOf(layerId);
      if (index !== -1) layerIds.splice(index, 1);
    },
    removeSource() {},
    moveLayer(layerId) {
      moves.push(layerId);
    },
  };
  return map;
}

function createTestDrawingStore(): DrawingStore {
  const doc = createEmptyDrawingDoc(1000);
  return {
    getDoc: () => doc,
    getLayerBounds: () => null,
    getLayerGeoJson: () => ({ type: 'FeatureCollection', features: [] }),
    subscribe: (listener) => {
      listener({ type: 'snapshot', doc, remote: false });
      return () => {};
    },
    patchLayer: (layerId, patch) => {
      const layer = doc.layers[layerId];
      if (!layer) return null;
      doc.layers[layerId] = { ...layer, ...patch, updatedAt: 1001 };
      return doc.layers[layerId];
    },
  } as DrawingStore;
}

function pointerEvent(window: TestWindow, type: string, init: Record<string, unknown>) {
  return new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    ...init,
  });
}

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

  it('commits a drag reorder when the pointer is released outside the reorder handle', () => {
    const window = installDom();
    const map = createTestMap();
    const drawingStore = createTestDrawingStore();
    const reorderEvents: unknown[] = [];
    map.getContainer().addEventListener('overlay-sync:local-reorder', (event) => {
      reorderEvents.push((event as CustomEvent).detail);
    });

    installOverlayManager(map, drawingStore);
    map.getContainer().dispatchEvent(
      new window.CustomEvent('overlay:add', {
        detail: {
          id: 'geojson-layer-0',
          type: 'geojson',
          name: 'OSRM route',
          syncOverlayId: 'shared-osrm-route',
          sourceId: 'source-osrm',
          layerIds: ['layer-osrm'],
          visible: true,
          data: { type: 'FeatureCollection', features: [] },
        },
      }) as Event,
    );
    map.getContainer().dispatchEvent(
      new window.CustomEvent('overlay:add', {
        detail: {
          id: 'geojson-layer-1',
          type: 'geojson',
          name: 'nSmE',
          syncOverlayId: 'shared-nsme',
          sourceId: 'source-nsme',
          layerIds: ['layer-nsme'],
          visible: true,
          data: { type: 'FeatureCollection', features: [] },
        },
      }) as Event,
    );

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.overlay-manager-item'));
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () =>
        ({
          top: 100 + index * 50,
          height: 40,
          bottom: 140 + index * 50,
          left: 0,
          right: 300,
          width: 300,
          x: 0,
          y: 100 + index * 50,
          toJSON() {},
        }) as DOMRect;
    });
    const nsmeHandle = document.querySelector<HTMLElement>("button[aria-label='Reorder nSmE']");
    expect(nsmeHandle).toBeTruthy();

    nsmeHandle?.dispatchEvent(pointerEvent(window, 'pointerdown', { clientY: 210 }));
    window.dispatchEvent(pointerEvent(window, 'pointermove', { clientY: 90 }));
    window.dispatchEvent(pointerEvent(window, 'pointerup', { clientY: 90 }));

    expect(document.querySelector('.overlay-manager-list-reordering')).toBeNull();
    expect(reorderEvents.at(-1)).toEqual({
      orderedIds: ['shared-nsme', 'shared-osrm-route'],
      stackItems: [
        { kind: 'overlay', id: 'shared-nsme' },
        { kind: 'overlay', id: 'shared-osrm-route' },
        { kind: 'drawing', layerId: 'drawing-default' },
      ],
    });
  });
});
