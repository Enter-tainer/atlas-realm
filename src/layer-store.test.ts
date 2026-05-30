import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_LAYER_ID, type AnnotationFeaturePayload } from './annotation-model.js';
import { LayerStore } from './layer-store.js';
import type { Layer } from './layer-model.js';

function annotationLayer(id: string, name = id): Layer {
  return {
    id,
    kind: 'annotation',
    name,
    visible: true,
    sortKey: '000010',
    payload: { version: 1 },
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function pointFeature(id: string, updatedAt = 1000, layerId = ANNOTATION_DEFAULT_LAYER_ID): AnnotationFeaturePayload {
  return {
    id,
    type: 'point',
    layerId,
    coordinate: [121.5, 31.2],
    label: id,
    note: '',
    color: '#2563eb',
    createdAt: 1000,
    updatedAt,
    updatedBy: 'user-a',
  };
}

describe('layer store', () => {
  it('only creates the default annotation layer when no annotation layer exists', () => {
    const store = new LayerStore({ layers: [annotationLayer('day-1', 'Day 1')] });

    expect(store.getAnnotationLayers().map((layer) => layer.id)).toEqual(['day-1']);

    store.setLayerList([annotationLayer('day-2', 'Day 2')]);

    expect(store.getAnnotationLayers().map((layer) => layer.id)).toEqual(['day-2']);
  });

  it('does not reorder an existing annotation feature when it is edited', () => {
    const store = new LayerStore();

    store.upsertFeature(pointFeature('point-a', 1001));
    store.upsertFeature(pointFeature('point-b', 1002));
    const before = store.getAnnotationFeatures().map((feature) => [feature.id, feature.sortKey]);

    store.upsertFeature({ ...pointFeature('point-a', 1003), label: 'Edited point' });

    expect(store.getAnnotationFeatures().map((feature) => [feature.id, feature.sortKey])).toEqual(before);
    expect(store.getAnnotationFeaturePayload('point-a')?.label).toBe('Edited point');
  });

  it('emits feature delete events when clearing a layer', () => {
    const store = new LayerStore({ layers: [annotationLayer('day-1', 'Day 1')] });
    store.upsertFeature(pointFeature('point-a', 1001, 'day-1'));
    store.upsertFeature(pointFeature('point-b', 1002, 'day-1'));
    const events: string[] = [];
    store.subscribe((event) => {
      if (event.type === 'feature:delete') events.push(event.featureId);
    });

    store.clearLayer('day-1');

    expect(events).toEqual(['point-a', 'point-b']);
    expect(store.getAnnotationFeatureCount('day-1')).toBe(0);
    expect(store.getAnnotationLayer('day-1')).toBeTruthy();
  });
});
