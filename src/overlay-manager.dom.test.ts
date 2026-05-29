// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDrawingDoc, DRAWING_DEFAULT_LAYER_ID } from './drawing-model.js';
import { installOverlayManager } from './overlay-manager.js';
import type { DrawingStore } from './drawing-store.js';

type TestMap = {
  container: HTMLElement;
  layerIds: string[];
  moves: string[];
  layout: Array<{ layerId: string; name: string; value: unknown }>;
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

afterEach(() => {
  document.body.replaceChildren();
});

function createTestMap(): TestMap {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const layerIds: string[] = [];
  const moves: string[] = [];
  const layout: TestMap['layout'] = [];
  return {
    container,
    layerIds,
    moves,
    layout,
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
    setLayoutProperty(layerId, name, value) {
      layout.push({ layerId, name, value });
    },
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
}

function createTestDrawingStore(stackOrder?: number): DrawingStore {
  const doc = createEmptyDrawingDoc(1000);
  if (stackOrder !== undefined) doc.layers[DRAWING_DEFAULT_LAYER_ID].stackOrder = stackOrder;
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

function addLocalOverlay(map: TestMap, options: { id: string; name: string; syncOverlayId: string }) {
  map.layerIds.push(`${options.id}-layer`);
  map.getContainer().dispatchEvent(
    new CustomEvent('overlay:add', {
      detail: {
        id: options.id,
        type: 'geojson',
        name: options.name,
        syncOverlayId: options.syncOverlayId,
        sourceId: `${options.id}-source`,
        layerIds: [`${options.id}-layer`],
        visible: true,
        data: { type: 'FeatureCollection', features: [] },
      },
    }),
  );
}

function addMaterializedRemoteOverlay(
  map: TestMap,
  options: {
    localId: string;
    remoteId: string;
    name: string;
    contentHash: string;
  },
) {
  map.layerIds.push(`${options.localId}-layer`);
  map.getContainer().dispatchEvent(
    new CustomEvent('overlay:add', {
      detail: {
        id: options.localId,
        type: 'geojson',
        name: options.name,
        syncOverlayId: options.remoteId,
        remoteOverlayId: options.remoteId,
        sourceId: `${options.localId}-source`,
        layerIds: [`${options.localId}-layer`],
        visible: true,
        data: { type: 'FeatureCollection', features: [] },
        contentHash: options.contentHash,
        __remoteOverlay: true,
      },
    }),
  );
}

function applyRemoteOverlayList(map: TestMap, ids: string[]) {
  map.getContainer().dispatchEvent(
    new CustomEvent('overlay-sync:remote-list', {
      detail: {
        overlays: ids.map(
          (id, index): Record<string, unknown> => ({
            id,
            type: 'geojson',
            name: id,
            visible: true,
            color: '#3b82f6',
            opacity: 0.95,
            lineWidth: 5,
            bounds: null,
            contentHash: `hash-${index}`,
            contentType: 'application/geo+json',
            contentEncoding: 'identity',
            contentByteLength: 2,
            rawByteLength: 2,
            syncVersion: 1,
            persistence: 'ephemeral',
            updatedAt: 1000 + index,
          }),
        ),
      },
    }),
  );
}

function rowNames() {
  return Array.from(document.querySelectorAll<HTMLElement>('.overlay-manager-item-name')).map(
    (node) => node.textContent,
  );
}

function dispatchPointer(target: EventTarget, type: string, init: PointerEventInit) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      ...init,
    }),
  );
}

describe('overlay manager DOM behavior', () => {
  it('commits a drag reorder when the pointer is released outside the reorder handle', () => {
    const map = createTestMap();
    const drawingStore = createTestDrawingStore();
    const reorderEvents: unknown[] = [];
    map.getContainer().addEventListener('overlay-sync:local-reorder', (event) => {
      reorderEvents.push((event as CustomEvent).detail);
    });

    installOverlayManager(map, drawingStore);
    addLocalOverlay(map, { id: 'geojson-layer-0', name: 'OSRM route', syncOverlayId: 'shared-osrm-route' });
    addLocalOverlay(map, { id: 'geojson-layer-1', name: 'nSmE', syncOverlayId: 'shared-nsme' });

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

    dispatchPointer(nsmeHandle as HTMLElement, 'pointerdown', { clientY: 210 });
    dispatchPointer(window, 'pointermove', { clientY: 90 });
    dispatchPointer(window, 'pointerup', { clientY: 90 });

    expect(document.querySelector('.overlay-manager-list-reordering')).toBeNull();
    expect(rowNames()).toEqual(['nSmE', 'OSRM route', 'Annotations']);
    expect(reorderEvents.at(-1)).toEqual({
      orderedIds: ['shared-nsme', 'shared-osrm-route'],
      stackItems: [
        { kind: 'overlay', id: 'shared-nsme' },
        { kind: 'overlay', id: 'shared-osrm-route' },
        { kind: 'drawing', layerId: 'drawing-default' },
      ],
    });
  });

  it('renders remote overlays in manifest order even when their content arrives out of order', () => {
    const map = createTestMap();
    installOverlayManager(map, createTestDrawingStore());
    applyRemoteOverlayList(map, ['shared-osrm-route', 'shared-nsme']);

    addMaterializedRemoteOverlay(map, {
      localId: 'geojson-layer-1',
      remoteId: 'shared-nsme',
      name: 'nSmE',
      contentHash: 'hash-nsme',
    });
    addMaterializedRemoteOverlay(map, {
      localId: 'geojson-layer-0',
      remoteId: 'shared-osrm-route',
      name: 'OSRM route',
      contentHash: 'hash-osrm',
    });

    expect(rowNames()).toEqual(['OSRM route', 'nSmE', 'Annotations']);
  });

  it('renders annotations at the synced stack order between restored remote overlays', () => {
    const map = createTestMap();
    installOverlayManager(map, createTestDrawingStore(1));
    applyRemoteOverlayList(map, ['shared-osrm-route', 'shared-nsme']);

    addMaterializedRemoteOverlay(map, {
      localId: 'geojson-layer-1',
      remoteId: 'shared-nsme',
      name: 'nSmE',
      contentHash: 'hash-nsme',
    });
    addMaterializedRemoteOverlay(map, {
      localId: 'geojson-layer-0',
      remoteId: 'shared-osrm-route',
      name: 'OSRM route',
      contentHash: 'hash-osrm',
    });

    expect(rowNames()).toEqual(['OSRM route', 'Annotations', 'nSmE']);
  });
});
