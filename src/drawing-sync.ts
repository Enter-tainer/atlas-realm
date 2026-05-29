import {
  applyDrawingFeatureDelete,
  applyDrawingFeatureReorder,
  applyDrawingFeatureUpsert,
  applyDrawingLayerReorder,
  applyDrawingLayerUpsert,
  createEmptyDrawingDoc,
  normalizeDrawingDoc,
  sanitizeDrawingFeature,
  sanitizeDrawingLayer,
} from './drawing-model.js';
import type { DrawingDoc, DrawingFeature, DrawingLayer } from './drawing-model.js';

export const DRAWING_SYNC_VERSION = 1;

export type DrawingClientMessage =
  | { type: 'drawing:snapshot:request' }
  | { type: 'drawing:layer:upsert'; layer: DrawingLayer }
  | { type: 'drawing:layer:reorder'; orderedIds: string[] }
  | { type: 'drawing:feature:upsert'; feature: DrawingFeature }
  | { type: 'drawing:feature:delete'; featureId: string }
  | { type: 'drawing:feature:reorder'; orderedIds: string[] };

export type DrawingServerMessage =
  | { type: 'drawing:snapshot'; revision: number; doc: DrawingDoc }
  | { type: 'drawing:layer:upserted'; revision: number; layer: DrawingLayer }
  | { type: 'drawing:layer:reordered'; revision: number; orderedIds: string[] }
  | { type: 'drawing:feature:upserted'; revision: number; feature: DrawingFeature }
  | { type: 'drawing:feature:deleted'; revision: number; featureId: string }
  | { type: 'drawing:feature:reordered'; revision: number; orderedIds: string[] };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function messageTimestamp(value: unknown, fallback: number) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function sanitizeFeatureId(value: unknown) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return /^[0-9a-zA-Z_-]{1,96}$/.test(id) ? id : '';
}

export function parseDrawingClientMessage(value: unknown, now = Date.now()): DrawingClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'drawing:snapshot:request') return { type: 'drawing:snapshot:request' };
  if (value.type === 'drawing:layer:upsert') {
    const layer = sanitizeDrawingLayer(value.layer, now);
    return layer ? { type: 'drawing:layer:upsert', layer } : null;
  }
  if (value.type === 'drawing:layer:reorder') {
    const orderedIds = Array.isArray(value.orderedIds)
      ? value.orderedIds.map(sanitizeFeatureId).filter(Boolean).slice(0, 128)
      : [];
    return { type: 'drawing:layer:reorder', orderedIds };
  }
  if (value.type === 'drawing:feature:upsert') {
    const feature = sanitizeDrawingFeature(value.feature, now);
    return feature ? { type: 'drawing:feature:upsert', feature } : null;
  }
  if (value.type === 'drawing:feature:delete') {
    const featureId = sanitizeFeatureId(value.featureId);
    return featureId ? { type: 'drawing:feature:delete', featureId } : null;
  }
  if (value.type === 'drawing:feature:reorder') {
    const orderedIds = Array.isArray(value.orderedIds)
      ? value.orderedIds.map(sanitizeFeatureId).filter(Boolean).slice(0, 512)
      : [];
    return { type: 'drawing:feature:reorder', orderedIds };
  }
  return null;
}

export function buildDrawingSnapshotMessage(doc: DrawingDoc): DrawingServerMessage {
  const normalized = normalizeDrawingDoc(doc);
  return {
    type: 'drawing:snapshot',
    revision: normalized.revision,
    doc: normalized,
  };
}

export function applyDrawingServerMessage(doc: DrawingDoc, message: DrawingServerMessage): DrawingDoc {
  const normalized = normalizeDrawingDoc(doc);
  if (message.type === 'drawing:snapshot') return normalizeDrawingDoc(message.doc);
  if (message.type === 'drawing:layer:upserted') {
    return applyDrawingLayerUpsert(normalized, message.layer, {
      revision: message.revision,
      now: messageTimestamp(message.layer.updatedAt, normalized.updatedAt),
    });
  }
  if (message.type === 'drawing:layer:reordered') {
    return applyDrawingLayerReorder(normalized, message.orderedIds, {
      revision: message.revision,
      now: normalized.updatedAt,
    });
  }
  if (message.type === 'drawing:feature:upserted') {
    return applyDrawingFeatureUpsert(normalized, message.feature, {
      revision: message.revision,
      now: messageTimestamp(message.feature.updatedAt, normalized.updatedAt),
    });
  }
  if (message.type === 'drawing:feature:deleted') {
    return applyDrawingFeatureDelete(normalized, message.featureId, {
      revision: message.revision,
      now: normalized.updatedAt,
    });
  }
  if (message.type === 'drawing:feature:reordered') {
    return applyDrawingFeatureReorder(normalized, message.orderedIds, {
      revision: message.revision,
      now: normalized.updatedAt,
    });
  }
  return normalized;
}

export function reduceDrawingClientMessage(
  doc: DrawingDoc | null | undefined,
  message: DrawingClientMessage,
  now = Date.now(),
): { doc: DrawingDoc; outbound: DrawingServerMessage | null } {
  const current = normalizeDrawingDoc(doc || createEmptyDrawingDoc(now), now);
  const revision = current.revision + 1;
  if (message.type === 'drawing:snapshot:request') {
    return {
      doc: current,
      outbound: buildDrawingSnapshotMessage(current),
    };
  }
  if (message.type === 'drawing:layer:upsert') {
    const next = applyDrawingLayerUpsert(current, message.layer, { revision, now });
    return {
      doc: next,
      outbound: {
        type: 'drawing:layer:upserted',
        revision: next.revision,
        layer: next.layers[message.layer.id],
      },
    };
  }
  if (message.type === 'drawing:layer:reorder') {
    const next = applyDrawingLayerReorder(current, message.orderedIds, { revision, now });
    return {
      doc: next,
      outbound: {
        type: 'drawing:layer:reordered',
        revision: next.revision,
        orderedIds: next.layerOrder,
      },
    };
  }
  if (message.type === 'drawing:feature:upsert') {
    const next = applyDrawingFeatureUpsert(current, message.feature, { revision, now });
    return {
      doc: next,
      outbound: {
        type: 'drawing:feature:upserted',
        revision: next.revision,
        feature: next.features[message.feature.id],
      },
    };
  }
  if (message.type === 'drawing:feature:delete') {
    const next = applyDrawingFeatureDelete(current, message.featureId, { revision, now });
    return {
      doc: next,
      outbound: {
        type: 'drawing:feature:deleted',
        revision: next.revision,
        featureId: message.featureId,
      },
    };
  }
  const next = applyDrawingFeatureReorder(current, message.orderedIds, { revision, now });
  return {
    doc: next,
    outbound: {
      type: 'drawing:feature:reordered',
      revision: next.revision,
      orderedIds: next.featureOrder,
    },
  };
}
