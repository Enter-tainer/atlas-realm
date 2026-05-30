import {
  ANNOTATION_DEFAULT_LAYER_ID,
  sanitizeAnnotationFeaturePayload,
  sanitizeAnnotationText,
  type AnnotationFeaturePayload,
  type AnnotationFeatureType,
} from './annotation-model.js';

export type LayerKind = 'annotation' | 'file';
export type FileLayerType = 'gpx' | 'geojson';
export type ContentEncoding = 'gzip' | 'identity';
export type Bounds = [[number, number], [number, number]];

export type AnnotationLayerPayload = {
  version: 1;
};

export type FileLayerPayload = {
  version: 1;
  fileType: FileLayerType;
  contentHash: string;
  contentType: string;
  contentEncoding: ContentEncoding;
  contentByteLength: number;
  rawByteLength: number;
  bounds: Bounds | null;
  style: {
    color: string;
    opacity: number;
    lineWidth: number;
  };
};

export type Layer = {
  id: string;
  kind: LayerKind;
  name: string;
  visible: boolean;
  sortKey: string;
  payload: AnnotationLayerPayload | FileLayerPayload;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
};

export type AnnotationLayer = Layer & { kind: 'annotation'; payload: AnnotationLayerPayload };
export type FileLayer = Layer & { kind: 'file'; payload: FileLayerPayload };

export type AnnotationFeature = {
  id: string;
  layerId: string;
  featureType: AnnotationFeatureType;
  payload: AnnotationFeaturePayload;
  sortKey: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type LayerUpdatePatch = {
  name?: string;
  visible?: boolean;
  sortKey?: string;
  payload?: unknown;
  updatedBy?: string;
};

type JsonRecord = Record<string, unknown>;

const ID_RE = /^[0-9a-zA-Z_-]{1,96}$/;
const SORT_KEY_RE = /^[0-9a-zA-Z:._-]{1,96}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const DEFAULT_FILE_COLOR = '#3b82f6';

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function sanitizeEntityId(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const id = value.trim();
  return ID_RE.test(id) ? id : fallback;
}

export function createEntityId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id.replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 72)}`;
}

export function initialSortKey(index: number) {
  return String(Math.max(0, Math.round(index)) * 10 + 10).padStart(6, '0');
}

export function sanitizeSortKey(value: unknown, fallback = '000010') {
  if (typeof value !== 'string') return fallback;
  const sortKey = value.trim();
  return SORT_KEY_RE.test(sortKey) ? sortKey : fallback;
}

function sanitizeNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeColor(value: unknown, fallback = DEFAULT_FILE_COLOR) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback;
}

function sanitizeContentHash(value: unknown) {
  if (typeof value !== 'string') return '';
  const hash = value.trim().toLowerCase();
  return HASH_RE.test(hash) ? hash : '';
}

function sanitizeBounds(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const sw = value[0];
  const ne = value[1];
  if (!Array.isArray(sw) || !Array.isArray(ne)) return null;
  const minLng = Number(sw[0]);
  const minLat = Number(sw[1]);
  const maxLng = Number(ne[0]);
  const maxLat = Number(ne[1]);
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function compareLayers(a: Layer, b: Layer) {
  return a.sortKey.localeCompare(b.sortKey) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function compareAnnotationFeatures(a: AnnotationFeature, b: AnnotationFeature) {
  return a.sortKey.localeCompare(b.sortKey) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function createDefaultAnnotationLayer(now = Date.now()): Layer {
  return {
    id: ANNOTATION_DEFAULT_LAYER_ID,
    kind: 'annotation',
    name: 'Annotations',
    visible: true,
    sortKey: '000010',
    payload: { version: 1 },
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function sanitizeLayer(value: unknown, now = Date.now(), fallback?: Partial<Layer>): Layer | null {
  if (!isRecord(value)) return null;
  const id = sanitizeEntityId(value.id, fallback?.id || '');
  const kind = value.kind === 'file' ? 'file' : value.kind === 'annotation' ? 'annotation' : fallback?.kind;
  if (!id || !kind) return null;

  let payload: AnnotationLayerPayload | FileLayerPayload | null = null;
  if (kind === 'annotation') {
    payload = { version: 1 };
  } else {
    const rawPayload: JsonRecord = isRecord(value.payload)
      ? value.payload
      : isRecord(fallback?.payload)
        ? (fallback.payload as unknown as JsonRecord)
        : {};
    const fileType = rawPayload.fileType === 'gpx' ? 'gpx' : rawPayload.fileType === 'geojson' ? 'geojson' : null;
    const contentHash = sanitizeContentHash(rawPayload.contentHash);
    if (!fileType || !contentHash) return null;
    const style = isRecord(rawPayload.style) ? rawPayload.style : {};
    payload = {
      version: 1,
      fileType,
      contentHash,
      contentType:
        sanitizeAnnotationText(rawPayload.contentType, 80) ||
        (fileType === 'gpx' ? 'application/gpx+xml' : 'application/geo+json'),
      contentEncoding: rawPayload.contentEncoding === 'gzip' ? 'gzip' : 'identity',
      contentByteLength: Math.round(sanitizeNumber(rawPayload.contentByteLength, 0, Number.MAX_SAFE_INTEGER, 0)),
      rawByteLength: Math.round(sanitizeNumber(rawPayload.rawByteLength, 0, Number.MAX_SAFE_INTEGER, 0)),
      bounds: sanitizeBounds(rawPayload.bounds),
      style: {
        color: sanitizeColor(style.color),
        opacity: sanitizeNumber(style.opacity, 0.2, 1, 0.95),
        lineWidth: sanitizeNumber(style.lineWidth, 1, 12, 5),
      },
    };
  }

  return {
    id,
    kind,
    name: sanitizeAnnotationText(value.name, 96) || fallback?.name || (kind === 'file' ? 'File layer' : 'Annotations'),
    visible: typeof value.visible === 'boolean' ? value.visible : (fallback?.visible ?? true),
    sortKey: sanitizeSortKey(value.sortKey, fallback?.sortKey || '000010'),
    payload,
    revision: Math.round(sanitizeNumber(value.revision, 0, Number.MAX_SAFE_INTEGER, fallback?.revision || 0)),
    createdAt: Math.round(sanitizeNumber(value.createdAt, 0, Number.MAX_SAFE_INTEGER, fallback?.createdAt || now)),
    updatedAt: Math.round(sanitizeNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now)),
    updatedBy: sanitizeAnnotationText(value.updatedBy, 96) || fallback?.updatedBy,
  };
}

export function sanitizeAnnotationFeature(value: unknown, now = Date.now()): AnnotationFeature | null {
  if (!isRecord(value)) return null;
  const id = sanitizeEntityId(value.id);
  const layerId = sanitizeEntityId(value.layerId);
  const featureType = value.featureType;
  if (!id || !layerId) return null;
  if (
    featureType !== 'point' &&
    featureType !== 'text' &&
    featureType !== 'path' &&
    featureType !== 'route' &&
    featureType !== 'polygon'
  ) {
    return null;
  }
  const rawPayload = isRecord(value.payload) ? value.payload : {};
  const payload = sanitizeAnnotationFeaturePayload(
    {
      ...rawPayload,
      id,
      layerId,
      type: featureType,
      updatedBy: value.updatedBy ?? rawPayload.updatedBy,
      createdAt: value.createdAt ?? rawPayload.createdAt,
      updatedAt: value.updatedAt ?? rawPayload.updatedAt,
    },
    now,
  );
  if (!payload) return null;
  return {
    id,
    layerId,
    featureType,
    payload,
    sortKey: sanitizeSortKey(value.sortKey, '000010'),
    revision: Math.round(sanitizeNumber(value.revision, 0, Number.MAX_SAFE_INTEGER, 0)),
    createdAt: Math.round(sanitizeNumber(value.createdAt, 0, Number.MAX_SAFE_INTEGER, payload.createdAt || now)),
    updatedAt: Math.round(sanitizeNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now)),
    updatedBy: sanitizeAnnotationText(value.updatedBy, 96) || payload.updatedBy || '',
  };
}

export function layerProductType(layer: Layer) {
  return layer.kind === 'annotation' ? 'annotation' : (layer as FileLayer).payload.fileType;
}
