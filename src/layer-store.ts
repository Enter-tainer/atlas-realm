import {
  ANNOTATION_DEFAULT_LAYER_ID,
  annotationFeaturePayloadsBounds,
  annotationFeaturePayloadsToGeoJson,
  type AnnotationFeaturePayload,
} from './annotation-model.js';
import {
  compareAnnotationFeatures,
  compareLayers,
  createDefaultAnnotationLayer,
  initialSortKey,
  sanitizeAnnotationFeature,
  sanitizeLayer,
  type AnnotationFeature,
  type AnnotationLayer,
  type FileLayer,
  type Layer,
  type LayerUpdatePatch,
} from './layer-model.js';
import type { AnnotationFeatureServerMessage, LayerServerMessage } from './layer-sync.js';

export type LayerStoreEvent =
  | { type: 'snapshot'; layers: Layer[]; features: AnnotationFeature[]; remote: boolean }
  | { type: 'layer:upsert'; layer: Layer; remote: boolean }
  | { type: 'layer:update'; layer: Layer; remote: boolean }
  | { type: 'layer:delete'; layerId: string; remote: boolean }
  | { type: 'layer:reorder'; layers: Layer[]; remote: boolean }
  | { type: 'feature:upsert'; feature: AnnotationFeature; remote: boolean }
  | { type: 'feature:delete'; featureId: string; remote: boolean }
  | { type: 'feature:reorder'; features: AnnotationFeature[]; remote: boolean };

type LayerStoreListener = (event: LayerStoreEvent) => void;
type LayerStoreInitialState = {
  layers?: Layer[];
  features?: AnnotationFeature[];
};

function emptyFeatureCollection() {
  return { type: 'FeatureCollection' as const, features: [] as object[] };
}

function isAnnotationLayer(layer: Layer | undefined): layer is AnnotationLayer {
  return layer?.kind === 'annotation';
}

function hasAnnotationLayer(layers: Iterable<Layer>) {
  for (const layer of layers) {
    if (isAnnotationLayer(layer)) return true;
  }
  return false;
}

export class LayerStore extends EventTarget {
  _layers = new Map<string, Layer>();
  _features = new Map<string, AnnotationFeature>();
  _listeners = new Set<LayerStoreListener>();

  constructor(initialState: LayerStoreInitialState = {}) {
    super();
    const layers = initialState.layers?.length ? initialState.layers : [createDefaultAnnotationLayer()];
    for (const layer of layers) {
      const normalized = sanitizeLayer(layer, layer.createdAt, layer);
      if (normalized) this._layers.set(normalized.id, normalized);
    }
    if (!hasAnnotationLayer(this._layers.values())) {
      const defaultLayer = createDefaultAnnotationLayer();
      this._layers.set(defaultLayer.id, defaultLayer);
    }
    for (const feature of initialState.features || []) {
      const normalized = sanitizeAnnotationFeature(feature, feature.createdAt);
      if (normalized && isAnnotationLayer(this._layers.get(normalized.layerId))) {
        this._features.set(normalized.id, normalized);
      }
    }
  }

  getLayers() {
    return Array.from(this._layers.values()).sort(compareLayers);
  }

  getAnnotationLayers(): AnnotationLayer[] {
    return this.getLayers().filter((layer): layer is AnnotationLayer => layer.kind === 'annotation');
  }

  getFileLayers(): FileLayer[] {
    return this.getLayers().filter((layer): layer is FileLayer => layer.kind === 'file');
  }

  getLayer(layerId: string) {
    return this._layers.get(layerId) || null;
  }

  getAnnotationLayer(layerId: string) {
    const layer = this._layers.get(layerId);
    return isAnnotationLayer(layer) ? layer : null;
  }

  getAnnotationFeatures(layerId?: string) {
    return Array.from(this._features.values())
      .filter((feature) => !layerId || feature.layerId === layerId)
      .sort(compareAnnotationFeatures);
  }

  _getAnnotationFeatureCount(layerId?: string) {
    if (!layerId) return this._features.size;
    let count = 0;
    for (const feature of this._features.values()) {
      if (feature.layerId === layerId) count += 1;
    }
    return count;
  }

  getAnnotationFeature(featureId: string) {
    return this._features.get(featureId) || null;
  }

  getAnnotationFeaturePayload(featureId: string) {
    return this._features.get(featureId)?.payload || null;
  }

  getAnnotationFeaturePayloads(layerId?: string) {
    return this.getAnnotationFeatures(layerId).map((feature) => feature.payload);
  }

  getAnnotationFeatureCount(layerId?: string) {
    return this._getAnnotationFeatureCount(layerId);
  }

  getGeoJson({ includeHidden = false }: { includeHidden?: boolean } = {}) {
    const visibleLayerIds = new Set(
      this.getAnnotationLayers()
        .filter((layer) => includeHidden || layer.visible)
        .map((layer) => layer.id),
    );
    const payloads = this.getAnnotationFeatures()
      .filter((feature) => visibleLayerIds.has(feature.layerId))
      .map((feature) => feature.payload);
    return annotationFeaturePayloadsToGeoJson(payloads);
  }

  getLayerGeoJson(layerId = ANNOTATION_DEFAULT_LAYER_ID, { includeHidden = true }: { includeHidden?: boolean } = {}) {
    const layer = this.getAnnotationLayer(layerId);
    if (!layer || (!includeHidden && !layer.visible)) return emptyFeatureCollection();
    return annotationFeaturePayloadsToGeoJson(this.getAnnotationFeaturePayloads(layerId), { layerId });
  }

  getLayerBounds(layerId = ANNOTATION_DEFAULT_LAYER_ID) {
    return annotationFeaturePayloadsBounds(this.getAnnotationFeaturePayloads(layerId), { layerId });
  }

  subscribe(listener: LayerStoreListener) {
    this._listeners.add(listener);
    listener({
      type: 'snapshot',
      layers: this.getLayers(),
      features: this.getAnnotationFeatures(),
      remote: false,
    });
    return () => this._listeners.delete(listener);
  }

  _emit(event: LayerStoreEvent) {
    this.dispatchEvent(new CustomEvent('change', { detail: event }));
    for (const listener of this._listeners) listener(event);
  }

  _emitSnapshot(remote: boolean) {
    this._emit({
      type: 'snapshot',
      layers: this.getLayers(),
      features: this.getAnnotationFeatures(),
      remote,
    });
  }

  setLayerList(layers: Layer[], { remote = false }: { remote?: boolean } = {}) {
    this._layers.clear();
    for (const layer of layers) {
      const normalized = sanitizeLayer(layer, layer.createdAt, layer);
      if (normalized) this._layers.set(normalized.id, normalized);
    }
    if (!remote && !hasAnnotationLayer(this._layers.values())) {
      const defaultLayer = createDefaultAnnotationLayer();
      this._layers.set(defaultLayer.id, defaultLayer);
    }
    const annotationLayerIds = new Set(this.getAnnotationLayers().map((layer) => layer.id));
    for (const [featureId, feature] of Array.from(this._features.entries())) {
      if (!annotationLayerIds.has(feature.layerId)) this._features.delete(featureId);
    }
    this._emitSnapshot(remote);
  }

  setAnnotationFeatureList(
    features: AnnotationFeature[],
    { remote = false, layerId }: { remote?: boolean; layerId?: string } = {},
  ) {
    if (layerId) {
      for (const [featureId, feature] of Array.from(this._features.entries())) {
        if (feature.layerId === layerId) this._features.delete(featureId);
      }
    } else {
      this._features.clear();
    }
    for (const feature of features) {
      const normalized = sanitizeAnnotationFeature(feature, feature.createdAt);
      if (normalized && isAnnotationLayer(this._layers.get(normalized.layerId))) {
        this._features.set(normalized.id, normalized);
      }
    }
    this._emitSnapshot(remote);
  }

  upsertLayer(layer: Layer, { remote = false }: { remote?: boolean } = {}) {
    const existing = this._layers.get(layer.id);
    const normalized = sanitizeLayer(layer, Date.now(), existing || layer);
    if (!normalized) return null;
    this._layers.set(normalized.id, normalized);
    this._emit({ type: existing ? 'layer:update' : 'layer:upsert', layer: normalized, remote });
    return normalized;
  }

  patchLayer(layerId: string, patch: LayerUpdatePatch, options: { remote?: boolean } = {}) {
    const layer = this._layers.get(layerId);
    if (!layer) return null;
    const now = Date.now();
    const next = sanitizeLayer(
      {
        ...layer,
        name: patch.name ?? layer.name,
        visible: patch.visible ?? layer.visible,
        sortKey: patch.sortKey ?? layer.sortKey,
        payload: patch.payload ?? layer.payload,
        revision: layer.revision + 1,
        updatedAt: now,
        updatedBy: patch.updatedBy ?? layer.updatedBy,
      },
      now,
      layer,
    );
    if (!next) return null;
    this._layers.set(next.id, next);
    this._emit({ type: 'layer:update', layer: next, remote: options.remote || false });
    return next;
  }

  deleteLayer(layerId: string, { remote = false }: { remote?: boolean } = {}) {
    this._layers.delete(layerId);
    for (const [featureId, feature] of this._features) {
      if (feature.layerId === layerId) this._features.delete(featureId);
    }
    this._emit({ type: 'layer:delete', layerId, remote });
  }

  reorderLayers(orderedIds: string[], { remote = false }: { remote?: boolean } = {}) {
    const now = Date.now();
    for (const [index, layerId] of orderedIds.entries()) {
      const layer = this._layers.get(layerId);
      if (!layer) continue;
      this._layers.set(layerId, {
        ...layer,
        sortKey: initialSortKey(index),
        revision: layer.revision + 1,
        updatedAt: now,
      });
    }
    this._emit({ type: 'layer:reorder', layers: this.getLayers(), remote });
  }

  upsertFeature(feature: AnnotationFeature | AnnotationFeaturePayload, { remote = false }: { remote?: boolean } = {}) {
    const existing = this._features.get(feature.id);
    const now = Date.now();
    const candidate =
      'featureType' in feature
        ? feature
        : {
            id: feature.id,
            layerId: feature.layerId,
            featureType: feature.type,
            payload: feature,
            sortKey:
              existing && existing.layerId === feature.layerId
                ? existing.sortKey
                : initialSortKey(this._getAnnotationFeatureCount(feature.layerId)),
            revision: Math.max(0, existing?.revision || 0) + 1,
            createdAt: existing?.createdAt ?? feature.createdAt,
            updatedAt: feature.updatedAt || now,
            updatedBy: feature.updatedBy || '',
          };
    const normalized = sanitizeAnnotationFeature(candidate, now);
    if (!normalized || !isAnnotationLayer(this._layers.get(normalized.layerId))) return null;
    this._features.set(normalized.id, normalized);
    this._emit({ type: 'feature:upsert', feature: normalized, remote });
    return normalized.payload;
  }

  deleteFeature(featureId: string, { remote = false }: { remote?: boolean } = {}) {
    this._features.delete(featureId);
    this._emit({ type: 'feature:delete', featureId, remote });
  }

  clearLayer(layerId: string, { remote = false, hidden = false }: { remote?: boolean; hidden?: boolean } = {}) {
    if (hidden) this.patchLayer(layerId, { visible: false }, { remote });
    for (const [featureId, feature] of Array.from(this._features.entries())) {
      if (feature.layerId !== layerId) continue;
      this._features.delete(featureId);
      this._emit({ type: 'feature:delete', featureId, remote });
    }
  }

  reorderFeatures(orderedIds: string[], { remote = false }: { remote?: boolean } = {}) {
    const now = Date.now();
    for (const [index, featureId] of orderedIds.entries()) {
      const feature = this._features.get(featureId);
      if (!feature) continue;
      this._features.set(featureId, {
        ...feature,
        sortKey: initialSortKey(index),
        revision: feature.revision + 1,
        updatedAt: now,
      });
    }
    this._emit({ type: 'feature:reorder', features: this.getAnnotationFeatures(), remote });
  }

  applyLayerServerMessage(message: LayerServerMessage) {
    if (message.type === 'layer:list') {
      this.setLayerList(message.layers, { remote: true });
    } else if (message.type === 'layer:created' || message.type === 'layer:updated') {
      this.upsertLayer(message.layer, { remote: true });
    } else if (message.type === 'layer:deleted') {
      this.deleteLayer(message.layerId, { remote: true });
    } else if (message.type === 'layer:reordered') {
      this.setLayerList(message.layers, { remote: true });
    }
  }

  applyAnnotationFeatureServerMessage(message: AnnotationFeatureServerMessage) {
    if (message.type === 'annotation-feature:list') {
      this.setAnnotationFeatureList(message.features, { remote: true, layerId: message.layerId });
    } else if (message.type === 'annotation-feature:upserted') {
      this.upsertFeature(message.feature, { remote: true });
    } else if (message.type === 'annotation-feature:deleted') {
      this.deleteFeature(message.featureId, { remote: true });
    } else if (message.type === 'annotation-feature:reordered') {
      this.setAnnotationFeatureList(message.features, { remote: true });
    } else if (message.type === 'annotation-feature:rejected') {
      this.deleteFeature(message.featureId, { remote: true });
    }
  }
}
