import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';

export const DRAWING_DOC_VERSION = 1;
export const DRAWING_DEFAULT_LAYER_ID = 'drawing-default';
export const DRAWING_SOURCE_ID = 'drawing-plan-source';
export const DRAWING_KIND_PREFIX = 'drawing_';

export type LngLatTuple = [number, number];
export type DrawingFeatureType = 'point' | 'text' | 'path' | 'route' | 'polygon';
export type DrawingRouteProfile = 'driving' | 'walking' | 'cycling';

export type DrawingLayer = {
  id: string;
  name: string;
  visible: boolean;
  stackOrder?: number;
  createdAt: number;
  updatedAt: number;
};

export type DrawingFeatureBase = {
  id: string;
  layerId: string;
  type: DrawingFeatureType;
  label: string;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type DrawingPointFeature = DrawingFeatureBase & {
  type: 'point';
  coordinate: LngLatTuple;
};

export type DrawingTextFeature = DrawingFeatureBase & {
  type: 'text';
  coordinate: LngLatTuple;
};

export type DrawingPathFeature = DrawingFeatureBase & {
  type: 'path';
  points: LngLatTuple[];
  directed: boolean;
  width: number;
};

export type DrawingPolygonFeature = DrawingFeatureBase & {
  type: 'polygon';
  points: LngLatTuple[];
  width: number;
  fillOpacity: number;
};

export type DrawingRouteFeature = DrawingFeatureBase & {
  type: 'route';
  waypoints: LngLatTuple[];
  profile: DrawingRouteProfile;
  directed: boolean;
  width: number;
  geometry: LngLatTuple[];
  distance: number | null;
  duration: number | null;
  distanceText: string;
  durationText: string;
};

export type DrawingFeature =
  | DrawingPointFeature
  | DrawingTextFeature
  | DrawingPathFeature
  | DrawingPolygonFeature
  | DrawingRouteFeature;

export type DrawingDoc = {
  version: typeof DRAWING_DOC_VERSION;
  layers: Record<string, DrawingLayer>;
  layerOrder: string[];
  features: Record<string, DrawingFeature>;
  featureOrder: string[];
  revision: number;
  updatedAt: number;
};

export type DrawingGeoJsonProperties = {
  kind: string;
  source: 'Drawing';
  drawing_id: string;
  parent_id?: string;
  feature_type: DrawingFeatureType;
  name?: string;
  label?: string;
  description?: string;
  color?: string;
  directed?: boolean;
  profile?: DrawingRouteProfile;
  distance?: number | null;
  duration?: number | null;
  distance_text?: string;
  duration_text?: string;
  bearing?: number;
  width?: number;
  fill_opacity?: number;
  'line-width'?: number;
};

type JsonRecord = Record<string, unknown>;
type DrawingMutationOptions = {
  revision?: number;
  now?: number;
};
type DrawingGeoJsonOptions = {
  includeHidden?: boolean;
  layerId?: string;
};
type DrawingBoundsOptions = {
  layerId?: string;
};

const DEFAULT_DRAWING_COLOR = '#2563eb';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[0-9a-zA-Z_-]{1,96}$/;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sanitizeId(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const id = value.trim();
  return ID_RE.test(id) ? id : fallback;
}

export function createDrawingId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 72)}`;
}

export function sanitizeDrawingText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

export function sanitizeDrawingColor(value: unknown, fallback = DEFAULT_DRAWING_COLOR) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback;
}

function sanitizeNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
}

function sanitizeOptionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

export function sanitizeLngLat(value: unknown): LngLatTuple | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Number(Math.min(180, Math.max(-180, lng)).toFixed(6)), Number(Math.min(85, Math.max(-85, lat)).toFixed(6))];
}

function sanitizeLngLatList(value: unknown, minLength: number) {
  if (!Array.isArray(value)) return null;
  const points = value.map(sanitizeLngLat).filter(Boolean) as LngLatTuple[];
  return points.length >= minLength ? points.slice(0, 128) : null;
}

function sanitizeRouteProfile(value: unknown): DrawingRouteProfile {
  if (value === 'walking' || value === 'cycling') return value;
  return 'driving';
}

export function createDefaultDrawingLayer(now = Date.now()): DrawingLayer {
  return {
    id: DRAWING_DEFAULT_LAYER_ID,
    name: 'Annotations',
    visible: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyDrawingDoc(now = Date.now()): DrawingDoc {
  const layer = createDefaultDrawingLayer(now);
  return {
    version: DRAWING_DOC_VERSION,
    layers: { [layer.id]: layer },
    layerOrder: [layer.id],
    features: {},
    featureOrder: [],
    revision: 0,
    updatedAt: now,
  };
}

export function sanitizeDrawingLayer(value: unknown, now = Date.now()): DrawingLayer | null {
  if (!isRecord(value)) return null;
  const id = sanitizeId(value.id);
  if (!id) return null;
  const layer: DrawingLayer = {
    id,
    name: sanitizeDrawingText(value.name, 80) || 'Annotations',
    visible: value.visible !== false,
    createdAt: sanitizeNumber(value.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: sanitizeNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
  };
  const stackOrder = sanitizeOptionalInteger(value.stackOrder, 0, 4096);
  if (stackOrder !== undefined) layer.stackOrder = stackOrder;
  return layer;
}

function baseFeature(value: JsonRecord, type: DrawingFeatureType, now: number): DrawingFeatureBase | null {
  const id = sanitizeId(value.id);
  if (!id) return null;
  return {
    id,
    layerId: sanitizeId(value.layerId, DRAWING_DEFAULT_LAYER_ID),
    type,
    label: sanitizeDrawingText(value.label ?? value.name, 120),
    note: sanitizeDrawingText(value.note ?? value.description, 1200),
    color: sanitizeDrawingColor(value.color),
    createdAt: sanitizeNumber(value.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: sanitizeNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedBy: sanitizeDrawingText(value.updatedBy, 96),
  };
}

export function sanitizeDrawingFeature(value: unknown, now = Date.now()): DrawingFeature | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== 'point' && type !== 'text' && type !== 'path' && type !== 'route' && type !== 'polygon') return null;
  const base = baseFeature(value, type, now);
  if (!base) return null;

  if (type === 'point' || type === 'text') {
    const coordinate = sanitizeLngLat(value.coordinate);
    if (!coordinate) return null;
    return { ...base, type, coordinate };
  }

  if (type === 'path') {
    const points = sanitizeLngLatList(value.points, 2);
    if (!points) return null;
    return {
      ...base,
      type: 'path',
      points,
      directed: value.directed !== false,
      width: sanitizeNumber(value.width, 1, 12, 4),
    };
  }

  if (type === 'polygon') {
    const points = sanitizeLngLatList(value.points, 3);
    if (!points) return null;
    return {
      ...base,
      type: 'polygon',
      points,
      width: sanitizeNumber(value.width, 1, 12, 3),
      fillOpacity: sanitizeNumber(value.fillOpacity ?? value.fill_opacity, 0.05, 0.7, 0.22),
    };
  }

  const waypoints = sanitizeLngLatList(value.waypoints, 2);
  const geometry = sanitizeLngLatList(value.geometry, 2) || waypoints;
  if (!waypoints || !geometry) return null;
  return {
    ...base,
    type: 'route',
    waypoints,
    profile: sanitizeRouteProfile(value.profile),
    directed: value.directed !== false,
    width: sanitizeNumber(value.width, 1, 12, 5),
    geometry,
    distance: sanitizeOptionalNumber(value.distance, 0, Number.MAX_SAFE_INTEGER),
    duration: sanitizeOptionalNumber(value.duration, 0, Number.MAX_SAFE_INTEGER),
    distanceText: sanitizeDrawingText(value.distanceText ?? value.distance_text, 64),
    durationText: sanitizeDrawingText(value.durationText ?? value.duration_text, 64),
  };
}

export function normalizeDrawingDoc(value: unknown, now = Date.now()): DrawingDoc {
  const empty = createEmptyDrawingDoc(now);
  if (!isRecord(value)) return empty;

  const layers = Object.fromEntries(
    Object.values(isRecord(value.layers) ? value.layers : {})
      .map((layer) => sanitizeDrawingLayer(layer, now))
      .filter(Boolean)
      .map((layer) => [layer.id, layer]),
  ) as Record<string, DrawingLayer>;
  if (!layers[DRAWING_DEFAULT_LAYER_ID]) layers[DRAWING_DEFAULT_LAYER_ID] = createDefaultDrawingLayer(now);

  const features = Object.fromEntries(
    Object.values(isRecord(value.features) ? value.features : {})
      .map((feature) => {
        const sanitized = sanitizeDrawingFeature(feature, now);
        if (!sanitized) return null;
        return layers[sanitized.layerId] ? sanitized : { ...sanitized, layerId: DRAWING_DEFAULT_LAYER_ID };
      })
      .filter(Boolean)
      .map((feature) => [feature.id, feature]),
  ) as Record<string, DrawingFeature>;

  const layerOrder = Array.isArray(value.layerOrder)
    ? value.layerOrder.map((id) => sanitizeId(id)).filter((id) => id && layers[id])
    : [];
  if (!layerOrder.includes(DRAWING_DEFAULT_LAYER_ID)) layerOrder.unshift(DRAWING_DEFAULT_LAYER_ID);
  for (const id of Object.keys(layers)) {
    if (!layerOrder.includes(id)) layerOrder.push(id);
  }

  const featureOrder = Array.isArray(value.featureOrder)
    ? value.featureOrder.map((id) => sanitizeId(id)).filter((id) => id && features[id])
    : [];
  for (const id of Object.keys(features)) {
    if (!featureOrder.includes(id)) featureOrder.push(id);
  }

  return {
    version: DRAWING_DOC_VERSION,
    layers,
    layerOrder,
    features,
    featureOrder,
    revision: sanitizeNumber(value.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: sanitizeNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
  };
}

function nextRevision(doc: DrawingDoc, options: DrawingMutationOptions) {
  return options.revision == null ? doc.revision + 1 : Math.max(doc.revision, options.revision);
}

export function applyDrawingFeatureUpsert(
  doc: DrawingDoc,
  input: DrawingFeature,
  options: DrawingMutationOptions = {},
): DrawingDoc {
  const now = options.now || Date.now();
  const feature = sanitizeDrawingFeature(input, now);
  if (!feature) return doc;
  const featureOrder = doc.featureOrder.filter((id) => id !== feature.id);
  featureOrder.push(feature.id);
  return {
    ...doc,
    features: { ...doc.features, [feature.id]: feature },
    featureOrder,
    revision: nextRevision(doc, options),
    updatedAt: now,
  };
}

export function applyDrawingLayerUpsert(
  doc: DrawingDoc,
  input: DrawingLayer,
  options: DrawingMutationOptions = {},
): DrawingDoc {
  const now = options.now || Date.now();
  const layer = sanitizeDrawingLayer(input, now);
  if (!layer) return doc;
  const existing = doc.layers[layer.id];
  const layerOrder = doc.layerOrder.includes(layer.id) ? doc.layerOrder.slice() : [...doc.layerOrder, layer.id];
  return {
    ...doc,
    layers: {
      ...doc.layers,
      [layer.id]: {
        ...existing,
        ...layer,
        id: layer.id,
        createdAt: existing?.createdAt ?? layer.createdAt,
        updatedAt: layer.updatedAt || now,
      },
    },
    layerOrder,
    revision: nextRevision(doc, options),
    updatedAt: now,
  };
}

export function applyDrawingFeatureDelete(
  doc: DrawingDoc,
  featureId: string,
  options: DrawingMutationOptions = {},
): DrawingDoc {
  const id = sanitizeId(featureId);
  if (!id || !doc.features[id]) return doc;
  const features = { ...doc.features };
  delete features[id];
  return {
    ...doc,
    features,
    featureOrder: doc.featureOrder.filter((item) => item !== id),
    revision: nextRevision(doc, options),
    updatedAt: options.now || Date.now(),
  };
}

export function applyDrawingFeatureReorder(
  doc: DrawingDoc,
  orderedIds: readonly string[],
  options: DrawingMutationOptions = {},
): DrawingDoc {
  const explicit = orderedIds.map((id) => sanitizeId(id)).filter((id) => id && doc.features[id]);
  const order = [...explicit, ...doc.featureOrder.filter((id) => doc.features[id] && !explicit.includes(id))];
  return {
    ...doc,
    featureOrder: order,
    revision: nextRevision(doc, options),
    updatedAt: options.now || Date.now(),
  };
}

function featureBaseProperties(feature: DrawingFeature, kind: string): DrawingGeoJsonProperties {
  return {
    kind,
    source: 'Drawing',
    drawing_id: feature.id,
    feature_type: feature.type,
    name: feature.label || undefined,
    label: feature.label || undefined,
    description: feature.note || undefined,
    color: feature.color,
  };
}

function lineCoordinateAt(points: LngLatTuple[], fraction: number): LngLatTuple {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const index = Math.min(points.length - 2, Math.max(0, Math.floor((points.length - 1) * fraction)));
  const start = points[index];
  const end = points[index + 1];
  return [Number(((start[0] + end[0]) / 2).toFixed(6)), Number(((start[1] + end[1]) / 2).toFixed(6))];
}

function lineBearing(points: LngLatTuple[], fraction: number) {
  if (points.length < 2) return 0;
  const index = Math.min(points.length - 2, Math.max(0, Math.floor((points.length - 1) * fraction)));
  const start = points[index];
  const end = points[index + 1];
  return Number(((Math.atan2(end[0] - start[0], end[1] - start[1]) * 180) / Math.PI).toFixed(2));
}

function lineLabelFeature(feature: DrawingPathFeature | DrawingRouteFeature, coordinates: LngLatTuple[]) {
  if (!feature.label && !feature.note) return null;
  return {
    type: 'Feature' as const,
    properties: {
      ...featureBaseProperties(feature, 'drawing_label'),
      parent_id: feature.id,
      drawing_id: feature.id,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: lineCoordinateAt(coordinates, 0.5),
    },
  };
}

function closeRing(points: LngLatTuple[]) {
  const ring = points.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return ring;
}

function polygonLabelCoordinate(points: LngLatTuple[]): LngLatTuple {
  const coordinateCount = Math.max(1, points.length);
  const total = points.reduce(
    (acc, point) => {
      acc[0] += point[0];
      acc[1] += point[1];
      return acc;
    },
    [0, 0] as LngLatTuple,
  );
  return [Number((total[0] / coordinateCount).toFixed(6)), Number((total[1] / coordinateCount).toFixed(6))];
}

function polygonLabelFeature(feature: DrawingPolygonFeature) {
  if (!feature.label && !feature.note) return null;
  return {
    type: 'Feature' as const,
    properties: {
      ...featureBaseProperties(feature, 'drawing_label'),
      parent_id: feature.id,
      drawing_id: feature.id,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: polygonLabelCoordinate(feature.points),
    },
  };
}

function lineArrowFeature(feature: DrawingPathFeature | DrawingRouteFeature, coordinates: LngLatTuple[]) {
  if (!feature.directed || coordinates.length < 2) return null;
  return {
    type: 'Feature' as const,
    properties: {
      ...featureBaseProperties(feature, 'drawing_arrow'),
      parent_id: feature.id,
      drawing_id: feature.id,
      bearing: lineBearing(coordinates, 0.78),
      width: feature.width,
      'line-width': feature.width,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: lineCoordinateAt(coordinates, 0.78),
    },
  };
}

function polygonFeature(feature: DrawingPolygonFeature): Feature<Polygon, DrawingGeoJsonProperties> {
  return {
    type: 'Feature',
    properties: {
      ...featureBaseProperties(feature, 'drawing_polygon'),
      width: feature.width,
      fill_opacity: feature.fillOpacity,
      'line-width': feature.width,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [closeRing(feature.points)],
    },
  };
}

function polygonOutlineFeature(feature: DrawingPolygonFeature): Feature<LineString, DrawingGeoJsonProperties> {
  return {
    type: 'Feature',
    properties: {
      ...featureBaseProperties(feature, 'drawing_polygon_outline'),
      parent_id: feature.id,
      drawing_id: feature.id,
      width: feature.width,
      'line-width': feature.width,
    },
    geometry: {
      type: 'LineString',
      coordinates: closeRing(feature.points),
    },
  };
}

function lineFeature(
  feature: DrawingPathFeature | DrawingRouteFeature,
  kind: 'drawing_path' | 'drawing_route',
  coordinates: LngLatTuple[],
): Feature<LineString, DrawingGeoJsonProperties> {
  return {
    type: 'Feature',
    properties: {
      ...featureBaseProperties(feature, kind),
      directed: feature.directed,
      profile: feature.type === 'route' ? feature.profile : undefined,
      distance: feature.type === 'route' ? feature.distance : undefined,
      duration: feature.type === 'route' ? feature.duration : undefined,
      distance_text: feature.type === 'route' ? feature.distanceText : undefined,
      duration_text: feature.type === 'route' ? feature.durationText : undefined,
      width: feature.width,
      'line-width': feature.width,
    },
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

export function drawingFeatureToGeoJsonFeatures(feature: DrawingFeature): Feature[] {
  if (feature.type === 'point' || feature.type === 'text') {
    return [
      {
        type: 'Feature',
        properties: featureBaseProperties(feature, feature.type === 'text' ? 'drawing_text' : 'drawing_point'),
        geometry: {
          type: 'Point',
          coordinates: feature.coordinate,
        } satisfies Point,
      },
    ];
  }

  if (feature.type === 'polygon') {
    return [polygonFeature(feature), polygonOutlineFeature(feature), polygonLabelFeature(feature)].filter(Boolean);
  }

  const coordinates = feature.type === 'route' ? feature.geometry : feature.points;
  const helpers = [lineLabelFeature(feature, coordinates), lineArrowFeature(feature, coordinates)].filter(Boolean);
  return [lineFeature(feature, feature.type === 'route' ? 'drawing_route' : 'drawing_path', coordinates), ...helpers];
}

export function drawingDocToGeoJson(doc: DrawingDoc, options: DrawingGeoJsonOptions = {}): FeatureCollection {
  const normalized = normalizeDrawingDoc(doc);
  const features = normalized.featureOrder.flatMap((id) => {
    const feature = normalized.features[id];
    if (!feature) return [];
    if (options.layerId && feature.layerId !== options.layerId) return [];
    if (!options.includeHidden && normalized.layers[feature.layerId]?.visible === false) return [];
    return feature ? drawingFeatureToGeoJsonFeatures(feature) : [];
  });
  return {
    type: 'FeatureCollection',
    features,
  };
}

function extendBounds(bounds: [number, number, number, number] | null, coordinate: LngLatTuple) {
  if (!bounds) return [coordinate[0], coordinate[1], coordinate[0], coordinate[1]] as [number, number, number, number];
  bounds[0] = Math.min(bounds[0], coordinate[0]);
  bounds[1] = Math.min(bounds[1], coordinate[1]);
  bounds[2] = Math.max(bounds[2], coordinate[0]);
  bounds[3] = Math.max(bounds[3], coordinate[1]);
  return bounds;
}

export function drawingDocBounds(
  doc: DrawingDoc,
  options: DrawingBoundsOptions = {},
): [[number, number], [number, number]] | null {
  const normalized = normalizeDrawingDoc(doc);
  let bounds: [number, number, number, number] | null = null;
  for (const id of normalized.featureOrder) {
    const feature = normalized.features[id];
    if (!feature || (options.layerId && feature.layerId !== options.layerId)) continue;
    if (feature.type === 'point' || feature.type === 'text') {
      bounds = extendBounds(bounds, feature.coordinate);
    } else {
      const coordinates = feature.type === 'route' ? feature.geometry : feature.points;
      for (const coordinate of coordinates) bounds = extendBounds(bounds, coordinate);
    }
  }
  return bounds
    ? [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ]
    : null;
}
