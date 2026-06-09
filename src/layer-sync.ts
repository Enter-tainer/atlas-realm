import {
  compareAnnotationFeatures,
  compareLayers,
  sanitizeAnnotationFeature,
  sanitizeEntityId,
  sanitizeLayer,
  sanitizeSortKey,
  type AnnotationFeature,
  type Layer,
  type LayerUpdatePatch,
} from './layer-model.js';

export type LayerClientMessage =
  | { type: 'layer:list:request' }
  | { type: 'layer:create'; layer: Layer }
  | { type: 'layer:update'; layerId: string; patch: LayerUpdatePatch }
  | { type: 'layer:delete'; layerId: string }
  | { type: 'layer:reorder'; updates: Array<{ layerId: string; sortKey: string }> };

export type LayerServerMessage =
  | { type: 'layer:list'; layers: Layer[] }
  | { type: 'layer:created'; layer: Layer }
  | { type: 'layer:updated'; layer: Layer }
  | { type: 'layer:deleted'; layerId: string }
  | { type: 'layer:reordered'; layers: Layer[] };

export type AnnotationFeatureClientMessage =
  | { type: 'annotation-feature:list:request'; layerId?: string }
  | { type: 'annotation-feature:upsert'; feature: AnnotationFeature }
  | { type: 'annotation-feature:delete'; featureId: string }
  | { type: 'annotation-feature:reorder'; updates: Array<{ featureId: string; sortKey: string }> };

export type AnnotationFeatureServerMessage =
  | { type: 'annotation-feature:list'; features: AnnotationFeature[]; layerId?: string }
  | { type: 'annotation-feature:upserted'; feature: AnnotationFeature }
  | { type: 'annotation-feature:deleted'; featureId: string }
  | { type: 'annotation-feature:reordered'; features: AnnotationFeature[] }
  | {
      type: 'annotation-feature:rejected';
      featureId: string;
      layerId: string;
      layerKind?: Layer['kind'];
      reason: 'missing-layer' | 'wrong-layer-kind' | 'invalid-feature';
    };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseLayerClientMessage(value: unknown, now = Date.now()): LayerClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'layer:list:request') return { type: 'layer:list:request' };
  if (value.type === 'layer:create') {
    const layer = sanitizeLayer(value.layer, now);
    return layer ? { type: 'layer:create', layer } : null;
  }
  if (value.type === 'layer:update') {
    const layerId = sanitizeEntityId(value.layerId);
    if (!layerId || !isRecord(value.patch)) return null;
    return {
      type: 'layer:update',
      layerId,
      patch: {
        name: typeof value.patch.name === 'string' ? value.patch.name : undefined,
        visible: typeof value.patch.visible === 'boolean' ? value.patch.visible : undefined,
        sortKey: typeof value.patch.sortKey === 'string' ? sanitizeSortKey(value.patch.sortKey) : undefined,
        payload: value.patch.payload,
        updatedBy: typeof value.patch.updatedBy === 'string' ? value.patch.updatedBy : undefined,
      },
    };
  }
  if (value.type === 'layer:delete') {
    const layerId = sanitizeEntityId(value.layerId);
    return layerId ? { type: 'layer:delete', layerId } : null;
  }
  if (value.type === 'layer:reorder') {
    const updates = Array.isArray(value.updates)
      ? value.updates
          .map((item) => {
            if (!isRecord(item)) return null;
            const layerId = sanitizeEntityId(item.layerId);
            return layerId ? { layerId, sortKey: sanitizeSortKey(item.sortKey) } : null;
          })
          .filter(Boolean)
          .slice(0, 256)
      : [];
    return { type: 'layer:reorder', updates };
  }
  return null;
}

export function parseAnnotationFeatureClientMessage(
  value: unknown,
  now = Date.now(),
): AnnotationFeatureClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'annotation-feature:list:request') {
    const layerId = sanitizeEntityId(value.layerId);
    return layerId ? { type: 'annotation-feature:list:request', layerId } : { type: 'annotation-feature:list:request' };
  }
  if (value.type === 'annotation-feature:upsert') {
    const feature = sanitizeAnnotationFeature(value.feature, now);
    return feature ? { type: 'annotation-feature:upsert', feature } : null;
  }
  if (value.type === 'annotation-feature:delete') {
    const featureId = sanitizeEntityId(value.featureId);
    return featureId ? { type: 'annotation-feature:delete', featureId } : null;
  }
  if (value.type === 'annotation-feature:reorder') {
    const updates = Array.isArray(value.updates)
      ? value.updates
          .map((item) => {
            if (!isRecord(item)) return null;
            const featureId = sanitizeEntityId(item.featureId);
            return featureId ? { featureId, sortKey: sanitizeSortKey(item.sortKey) } : null;
          })
          .filter(Boolean)
          .slice(0, 1024)
      : [];
    return { type: 'annotation-feature:reorder', updates };
  }
  return null;
}

export function sortLayers(layers: readonly Layer[]) {
  return layers.slice().sort(compareLayers);
}

export function sortAnnotationFeatures(features: readonly AnnotationFeature[]) {
  return features.slice().sort(compareAnnotationFeatures);
}
