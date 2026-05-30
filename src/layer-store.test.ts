import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_LAYER_ID, type AnnotationFeaturePayload } from './annotation-model.js';
import { LayerStore } from './layer-store.js';

function pointFeature(id: string, updatedAt = 1000): AnnotationFeaturePayload {
  return {
    id,
    type: 'point',
    layerId: ANNOTATION_DEFAULT_LAYER_ID,
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
  it('does not reorder an existing annotation feature when it is edited', () => {
    const store = new LayerStore();

    store.upsertFeature(pointFeature('point-a', 1001));
    store.upsertFeature(pointFeature('point-b', 1002));
    const before = store.getAnnotationFeatures().map((feature) => [feature.id, feature.sortKey]);

    store.upsertFeature({ ...pointFeature('point-a', 1003), label: 'Edited point' });

    expect(store.getAnnotationFeatures().map((feature) => [feature.id, feature.sortKey])).toEqual(before);
    expect(store.getAnnotationFeaturePayload('point-a')?.label).toBe('Edited point');
  });
});
