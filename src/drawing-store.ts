import {
  applyDrawingFeatureDelete,
  applyDrawingFeatureReorder,
  applyDrawingFeatureUpsert,
  applyDrawingLayerUpsert,
  createEmptyDrawingDoc,
  DRAWING_DEFAULT_LAYER_ID,
  drawingDocBounds,
  drawingDocToGeoJson,
  normalizeDrawingDoc,
} from './drawing-model.js';
import { applyDrawingServerMessage } from './drawing-sync.js';
import type { DrawingDoc, DrawingFeature, DrawingLayer } from './drawing-model.js';
import type { DrawingServerMessage } from './drawing-sync.js';

export type DrawingStoreEvent =
  | { type: 'snapshot'; doc: DrawingDoc; remote: boolean }
  | { type: 'layer:upsert'; doc: DrawingDoc; layer: DrawingLayer; remote: boolean }
  | { type: 'feature:upsert'; doc: DrawingDoc; feature: DrawingFeature; remote: boolean }
  | { type: 'feature:delete'; doc: DrawingDoc; featureId: string; remote: boolean }
  | { type: 'feature:reorder'; doc: DrawingDoc; orderedIds: string[]; remote: boolean };

type DrawingStoreListener = (event: DrawingStoreEvent) => void;

export class DrawingStore extends EventTarget {
  _doc: DrawingDoc;
  _listeners = new Set<DrawingStoreListener>();

  constructor(initialDoc: DrawingDoc = createEmptyDrawingDoc()) {
    super();
    this._doc = normalizeDrawingDoc(initialDoc);
  }

  getDoc() {
    return this._doc;
  }

  getGeoJson() {
    return drawingDocToGeoJson(this._doc);
  }

  getLayerGeoJson(layerId = DRAWING_DEFAULT_LAYER_ID, { includeHidden = true }: { includeHidden?: boolean } = {}) {
    return drawingDocToGeoJson(this._doc, { layerId, includeHidden });
  }

  getLayerBounds(layerId = DRAWING_DEFAULT_LAYER_ID) {
    return drawingDocBounds(this._doc, { layerId });
  }

  subscribe(listener: DrawingStoreListener) {
    this._listeners.add(listener);
    listener({ type: 'snapshot', doc: this._doc, remote: false });
    return () => this._listeners.delete(listener);
  }

  _emit(event: DrawingStoreEvent) {
    this.dispatchEvent(new CustomEvent('change', { detail: event }));
    for (const listener of this._listeners) listener(event);
  }

  setSnapshot(doc: DrawingDoc, { remote = false }: { remote?: boolean } = {}) {
    this._doc = normalizeDrawingDoc(doc);
    this._emit({ type: 'snapshot', doc: this._doc, remote });
  }

  upsertFeature(feature: DrawingFeature, { remote = false }: { remote?: boolean } = {}) {
    this._doc = applyDrawingFeatureUpsert(this._doc, feature);
    const saved = this._doc.features[feature.id];
    this._emit({ type: 'feature:upsert', doc: this._doc, feature: saved, remote });
    return saved;
  }

  upsertLayer(layer: DrawingLayer, { remote = false }: { remote?: boolean } = {}) {
    this._doc = applyDrawingLayerUpsert(this._doc, layer);
    const saved = this._doc.layers[layer.id];
    this._emit({ type: 'layer:upsert', doc: this._doc, layer: saved, remote });
    return saved;
  }

  patchLayer(layerId: string, patch: Partial<Pick<DrawingLayer, 'name' | 'visible' | 'stackOrder'>>, options: { remote?: boolean } = {}) {
    const layer = this._doc.layers[layerId];
    if (!layer) return null;
    return this.upsertLayer(
      {
        ...layer,
        ...patch,
        updatedAt: Date.now(),
      },
      options,
    );
  }

  clearLayer(layerId: string, { remote = false, hidden = false }: { remote?: boolean; hidden?: boolean } = {}) {
    const layer = this._doc.layers[layerId];
    if (hidden && layer?.visible !== false) this.patchLayer(layerId, { visible: false }, { remote });
    const featureIds = this._doc.featureOrder.filter((id) => this._doc.features[id]?.layerId === layerId);
    for (const id of featureIds) this.deleteFeature(id, { remote });
  }

  deleteFeature(featureId: string, { remote = false }: { remote?: boolean } = {}) {
    this._doc = applyDrawingFeatureDelete(this._doc, featureId);
    this._emit({ type: 'feature:delete', doc: this._doc, featureId, remote });
  }

  reorderFeatures(orderedIds: string[], { remote = false }: { remote?: boolean } = {}) {
    this._doc = applyDrawingFeatureReorder(this._doc, orderedIds);
    this._emit({ type: 'feature:reorder', doc: this._doc, orderedIds: this._doc.featureOrder, remote });
  }

  applyServerMessage(message: DrawingServerMessage) {
    this._doc = applyDrawingServerMessage(this._doc, message);
    if (message.type === 'drawing:snapshot') {
      this._emit({ type: 'snapshot', doc: this._doc, remote: true });
    } else if (message.type === 'drawing:layer:upserted') {
      this._emit({
        type: 'layer:upsert',
        doc: this._doc,
        layer: this._doc.layers[message.layer.id],
        remote: true,
      });
    } else if (message.type === 'drawing:feature:upserted') {
      this._emit({
        type: 'feature:upsert',
        doc: this._doc,
        feature: this._doc.features[message.feature.id],
        remote: true,
      });
    } else if (message.type === 'drawing:feature:deleted') {
      this._emit({ type: 'feature:delete', doc: this._doc, featureId: message.featureId, remote: true });
    } else {
      this._emit({ type: 'feature:reorder', doc: this._doc, orderedIds: this._doc.featureOrder, remote: true });
    }
  }
}
