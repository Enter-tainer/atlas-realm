// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_LAYER_ID, type AnnotationFeaturePayload } from './annotation-model.js';
import { COLLABORATION_ACCESS_EVENT } from './collaboration-permissions.js';
import { installLayerManager } from './layer-manager.js';
import { LayerStore } from './layer-store.js';
import type { Layer } from './layer-model.js';

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

function testAnnotationLayer(id: string, name: string, sortKey: string): Layer {
  return {
    id,
    kind: 'annotation',
    name,
    visible: true,
    sortKey,
    payload: { version: 1 },
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function testFileLayer(id: string, sortKey: string, fileType: 'geojson' | 'gpx' = 'geojson'): Layer {
  return {
    id,
    kind: 'file',
    name: id,
    visible: true,
    sortKey,
    payload: {
      version: 1,
      fileType,
      contentHash: 'a'.repeat(64),
      contentType: fileType === 'gpx' ? 'application/gpx+xml' : 'application/geo+json',
      contentEncoding: 'identity',
      contentByteLength: 1,
      rawByteLength: 1,
      bounds: null,
      style: { color: '#3b82f6', opacity: 0.95, lineWidth: 5 },
    },
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function testPointFeature(id: string, layerId: string): AnnotationFeaturePayload {
  return {
    id,
    type: 'point',
    layerId,
    coordinate: [121.5, 31.2],
    label: id,
    note: '',
    color: '#2563eb',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: 'user-a',
  };
}

function createTestLayerStore(annotationOrder?: number): LayerStore {
  const layers =
    annotationOrder === 1
      ? [
          testFileLayer('shared-osrm-route', '000010'),
          testAnnotationLayer(ANNOTATION_DEFAULT_LAYER_ID, 'Annotations', '000020'),
          testFileLayer('shared-nsme', '000030'),
        ]
      : [testAnnotationLayer(ANNOTATION_DEFAULT_LAYER_ID, 'Annotations', '000010')];
  return new LayerStore({ layers });
}

function createTestLayerStoreWithExtraLayer(): LayerStore {
  const store = createTestLayerStore();
  store.upsertLayer(testAnnotationLayer('annotation-layer-a', 'Day 1', '000020'));
  return store;
}

function createTestLayerStoreWithGpxFirst(): LayerStore {
  return new LayerStore({
    layers: [
      testFileLayer('gpx-track-0', '000010', 'gpx'),
      testAnnotationLayer(ANNOTATION_DEFAULT_LAYER_ID, 'Annotations', '000020'),
      testAnnotationLayer('annotation-layer-a', 'Day 1', '000030'),
    ],
  });
}

function addLocalFileLayer(
  map: TestMap,
  options: { id: string; name: string; syncLayerId: string; type?: 'geojson' | 'gpx' },
) {
  map.layerIds.push(`${options.id}-layer`);
  map.getContainer().dispatchEvent(
    new CustomEvent('layer:add', {
      detail: {
        id: options.id,
        type: options.type || 'geojson',
        name: options.name,
        syncLayerId: options.syncLayerId,
        sourceId: `${options.id}-source`,
        layerIds: [`${options.id}-layer`],
        visible: true,
        data: { type: 'FeatureCollection', features: [] },
      },
    }),
  );
}

function addMaterializedRemoteFileLayer(
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
    new CustomEvent('layer:add', {
      detail: {
        id: options.localId,
        type: 'geojson',
        name: options.name,
        syncLayerId: options.remoteId,
        remoteLayerId: options.remoteId,
        sourceId: `${options.localId}-source`,
        layerIds: [`${options.localId}-layer`],
        visible: true,
        data: { type: 'FeatureCollection', features: [] },
        contentHash: options.contentHash,
      },
    }),
  );
}

function applyRemoteFileLayerList(map: TestMap, ids: string[]) {
  const names = new Map([
    ['shared-osrm-route', 'OSRM route'],
    ['shared-nsme', 'nSmE'],
  ]);
  map.getContainer().dispatchEvent(
    new CustomEvent('layer-sync:remote-list', {
      detail: {
        fileLayers: ids.map(
          (id, index): Record<string, unknown> => ({
            id,
            type: 'geojson',
            name: names.get(id) || id,
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
  return Array.from(document.querySelectorAll<HTMLElement>('.layer-manager-item-name')).map((node) => node.textContent);
}

function selectedActionLabel() {
  return document.querySelector<HTMLElement>('.layer-manager-danger .layer-manager-action-label')?.textContent;
}

function deleteActionButton() {
  const button = document.querySelector<HTMLButtonElement>('.layer-manager-danger');
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function openLayerManager() {
  const button = document.querySelector<HTMLButtonElement>('.maplibregl-ctrl-layers');
  expect(button).toBeTruthy();
  (button as HTMLButtonElement).click();
}

function makeReadOnly(map: TestMap) {
  map.container.dataset.collaborationCanEdit = 'false';
  map.container.dispatchEvent(
    new CustomEvent(COLLABORATION_ACCESS_EVENT, {
      detail: {
        canView: true,
        canEdit: false,
        canManage: false,
        role: 'view',
      },
    }),
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

describe('layer manager DOM behavior', () => {
  it('disables shared layer mutations when collaboration access is read-only', () => {
    const map = createTestMap();
    const layerStore = createTestLayerStore();

    installLayerManager(map, layerStore);
    makeReadOnly(map);
    openLayerManager();

    expect(document.querySelector<HTMLButtonElement>('.layer-manager-import')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.layer-manager-dropzone')?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('.layer-manager-url-input')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.layer-manager-url-submit')?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('.layer-manager-name-input')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.layer-manager-reorder-handle')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.layer-manager-visibility-button')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.layer-manager-edit')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.layer-manager-danger')?.disabled).toBe(true);

    addLocalFileLayer(map, { id: 'local-layer', name: 'Local layer', syncLayerId: 'local-layer' });

    expect(rowNames()).toEqual(['Annotations']);
    expect(rowNames()).not.toContain('Local layer');
  });

  it('deletes the default annotation layer when another annotation layer remains', () => {
    const map = createTestMap();
    const layerStore = createTestLayerStoreWithExtraLayer();

    installLayerManager(map, layerStore);
    openLayerManager();

    expect(rowNames()).toEqual(['Annotations', 'Day 1']);
    expect(selectedActionLabel()).toBe('Delete');

    deleteActionButton().click();

    expect(layerStore.getAnnotationLayer(ANNOTATION_DEFAULT_LAYER_ID)).toBeNull();
    expect(layerStore.getAnnotationLayer('annotation-layer-a')).toBeTruthy();
    expect(rowNames()).toEqual(['Day 1']);
    expect(selectedActionLabel()).toBe('Clear');
  });

  it('clears rather than deletes the last remaining annotation layer', () => {
    const map = createTestMap();
    const layerStore = new LayerStore({
      layers: [testAnnotationLayer('annotation-layer-a', 'Day 1', '000010')],
    });
    layerStore.upsertFeature(testPointFeature('point-a', 'annotation-layer-a'));

    installLayerManager(map, layerStore);
    openLayerManager();

    expect(rowNames()).toEqual(['Day 1']);
    expect(selectedActionLabel()).toBe('Clear');
    expect(layerStore.getAnnotationFeatureCount('annotation-layer-a')).toBe(1);

    deleteActionButton().click();

    expect(layerStore.getAnnotationLayer('annotation-layer-a')).toBeTruthy();
    expect(layerStore.getAnnotationFeatureCount('annotation-layer-a')).toBe(0);
    expect(rowNames()).toEqual(['Day 1']);
    expect(selectedActionLabel()).toBe('Clear');
  });

  it('commits a drag reorder when the pointer is released outside the reorder handle', () => {
    const map = createTestMap();
    const layerStore = createTestLayerStore();
    const reorderEvents: unknown[] = [];
    map.getContainer().addEventListener('layer-sync:local-reorder', (event) => {
      reorderEvents.push((event as CustomEvent).detail);
    });

    installLayerManager(map, layerStore);
    addLocalFileLayer(map, { id: 'geojson-layer-0', name: 'OSRM route', syncLayerId: 'shared-osrm-route' });
    addLocalFileLayer(map, { id: 'geojson-layer-1', name: 'nSmE', syncLayerId: 'shared-nsme' });

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.layer-manager-item'));
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

    expect(document.querySelector('.layer-manager-list-reordering')).toBeNull();
    expect(rowNames()).toEqual(['nSmE', 'OSRM route', 'Annotations']);
    expect(reorderEvents.at(-1)).toEqual({
      stackItems: [
        { kind: 'file', layerId: 'shared-nsme' },
        { kind: 'file', layerId: 'shared-osrm-route' },
        { kind: 'annotation', layerId: ANNOTATION_DEFAULT_LAYER_ID },
      ],
    });
  });

  it('keeps a dragged GPX layer in the mixed layer order after local store sync', () => {
    const map = createTestMap();
    const layerStore = createTestLayerStoreWithGpxFirst();
    const reorderEvents: unknown[] = [];
    map.getContainer().addEventListener('layer-sync:local-reorder', (event) => {
      reorderEvents.push((event as CustomEvent).detail);
    });

    installLayerManager(map, layerStore);
    addLocalFileLayer(map, {
      id: 'gpx-track-0',
      name: 'GPX track',
      syncLayerId: 'gpx-track-0',
      type: 'gpx',
    });

    expect(rowNames()).toEqual(['GPX track', 'Annotations', 'Day 1']);

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.layer-manager-item'));
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
    const gpxHandle = document.querySelector<HTMLElement>("button[aria-label='Reorder GPX track']");
    expect(gpxHandle).toBeTruthy();

    dispatchPointer(gpxHandle as HTMLElement, 'pointerdown', { clientY: 110 });
    dispatchPointer(window, 'pointermove', { clientY: 260 });
    dispatchPointer(window, 'pointerup', { clientY: 260 });

    expect(rowNames()).toEqual(['Annotations', 'Day 1', 'GPX track']);
    expect(layerStore.getLayers().map((layer) => layer.id)).toEqual([
      ANNOTATION_DEFAULT_LAYER_ID,
      'annotation-layer-a',
      'gpx-track-0',
    ]);
    expect(reorderEvents.at(-1)).toEqual({
      stackItems: [
        { kind: 'annotation', layerId: ANNOTATION_DEFAULT_LAYER_ID },
        { kind: 'annotation', layerId: 'annotation-layer-a' },
        { kind: 'file', layerId: 'gpx-track-0' },
      ],
    });
  });

  it('renders remote file layers in manifest order even when their content arrives out of order', () => {
    const map = createTestMap();
    installLayerManager(map, createTestLayerStore());
    applyRemoteFileLayerList(map, ['shared-osrm-route', 'shared-nsme']);

    addMaterializedRemoteFileLayer(map, {
      localId: 'geojson-layer-1',
      remoteId: 'shared-nsme',
      name: 'nSmE',
      contentHash: 'hash-nsme',
    });
    addMaterializedRemoteFileLayer(map, {
      localId: 'geojson-layer-0',
      remoteId: 'shared-osrm-route',
      name: 'OSRM route',
      contentHash: 'hash-osrm',
    });
    applyRemoteFileLayerList(map, ['shared-osrm-route', 'shared-nsme']);

    expect(rowNames()).toEqual(['OSRM route', 'nSmE', 'Annotations']);
  });

  it('renders annotations at the synced stack order between restored remote file layers', () => {
    const map = createTestMap();
    installLayerManager(map, createTestLayerStore(1));
    applyRemoteFileLayerList(map, ['shared-osrm-route', 'shared-nsme']);

    addMaterializedRemoteFileLayer(map, {
      localId: 'geojson-layer-1',
      remoteId: 'shared-nsme',
      name: 'nSmE',
      contentHash: 'hash-nsme',
    });
    addMaterializedRemoteFileLayer(map, {
      localId: 'geojson-layer-0',
      remoteId: 'shared-osrm-route',
      name: 'OSRM route',
      contentHash: 'hash-osrm',
    });
    applyRemoteFileLayerList(map, ['shared-osrm-route', 'shared-nsme']);

    expect(rowNames()).toEqual(['OSRM route', 'Annotations', 'nSmE']);
  });

  it('selects the matching annotation layer when the annotation panel active layer changes', () => {
    const map = createTestMap();
    installLayerManager(map, createTestLayerStoreWithExtraLayer());

    map
      .getContainer()
      .dispatchEvent(new CustomEvent('annotation:activelayerchange', { detail: { layerId: 'annotation-layer-a' } }));

    const selectedName = document.querySelector<HTMLElement>('.layer-manager-item.selected .layer-manager-item-name');
    expect(selectedName?.textContent).toBe('Day 1');
  });
});
