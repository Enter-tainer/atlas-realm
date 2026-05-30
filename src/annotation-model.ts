import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';

export const ANNOTATION_DEFAULT_LAYER_ID = 'annotation-default';
export const ANNOTATION_SOURCE_ID = 'annotation-source';
export const ANNOTATION_KIND_PREFIX = 'annotation_';
export const ANNOTATION_TEXT_DEFAULT_WIDTH = 154;
export const ANNOTATION_TEXT_DEFAULT_HEIGHT = 64;
export const ANNOTATION_TEXT_MIN_WIDTH = 96;
export const ANNOTATION_TEXT_MIN_HEIGHT = 48;
export const ANNOTATION_TEXT_MAX_WIDTH = 420;
export const ANNOTATION_TEXT_MAX_HEIGHT = 260;

export type LngLatTuple = [number, number];
export type AnnotationFeatureType = 'point' | 'text' | 'path' | 'route' | 'polygon';
export type AnnotationRouteProfile = 'driving' | 'walking' | 'cycling';

export type AnnotationFeaturePayloadBase = {
  id: string;
  layerId: string;
  type: AnnotationFeatureType;
  label: string;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type AnnotationPointPayload = AnnotationFeaturePayloadBase & {
  type: 'point';
  coordinate: LngLatTuple;
};

export type AnnotationTextPayload = AnnotationFeaturePayloadBase & {
  type: 'text';
  coordinate: LngLatTuple;
  width: number;
  height: number;
};

export type AnnotationPathPayload = AnnotationFeaturePayloadBase & {
  type: 'path';
  points: LngLatTuple[];
  directed: boolean;
  width: number;
};

export type AnnotationPolygonPayload = AnnotationFeaturePayloadBase & {
  type: 'polygon';
  points: LngLatTuple[];
  width: number;
  fillOpacity: number;
};

export type AnnotationRoutePayload = AnnotationFeaturePayloadBase & {
  type: 'route';
  waypoints: LngLatTuple[];
  profile: AnnotationRouteProfile;
  directed: boolean;
  width: number;
  geometry: LngLatTuple[];
  distance: number | null;
  duration: number | null;
  distanceText: string;
  durationText: string;
};

export type AnnotationFeaturePayload =
  | AnnotationPointPayload
  | AnnotationTextPayload
  | AnnotationPathPayload
  | AnnotationPolygonPayload
  | AnnotationRoutePayload;

export type AnnotationGeoJsonProperties = {
  kind: string;
  source: 'Annotation';
  annotation_id: string;
  parent_id?: string;
  feature_type: AnnotationFeatureType;
  name?: string;
  label?: string;
  description?: string;
  color?: string;
  directed?: boolean;
  profile?: AnnotationRouteProfile;
  distance?: number | null;
  duration?: number | null;
  distance_text?: string;
  duration_text?: string;
  bearing?: number;
  width?: number;
  fill_opacity?: number;
  'line-width'?: number;
  text_width?: number;
  text_height?: number;
};

type JsonRecord = Record<string, unknown>;
type AnnotationGeoJsonOptions = {
  layerId?: string;
};
type AnnotationBoundsOptions = {
  layerId?: string;
};

const DEFAULT_ANNOTATION_COLOR = '#2563eb';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[0-9a-zA-Z_-]{1,96}$/;
const MAX_ANNOTATION_POINTS = 512;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function sanitizeAnnotationId(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const id = value.trim();
  return ID_RE.test(id) ? id : fallback;
}

export function createAnnotationId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 72)}`;
}

export function sanitizeAnnotationText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

export function sanitizeAnnotationColor(value: unknown, fallback = DEFAULT_ANNOTATION_COLOR) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback;
}

function sanitizeNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeOptionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

export function sanitizeAnnotationTextWidth(value: unknown) {
  return Math.round(
    sanitizeNumber(value, ANNOTATION_TEXT_MIN_WIDTH, ANNOTATION_TEXT_MAX_WIDTH, ANNOTATION_TEXT_DEFAULT_WIDTH),
  );
}

export function sanitizeAnnotationTextHeight(value: unknown) {
  return Math.round(
    sanitizeNumber(value, ANNOTATION_TEXT_MIN_HEIGHT, ANNOTATION_TEXT_MAX_HEIGHT, ANNOTATION_TEXT_DEFAULT_HEIGHT),
  );
}

export function sanitizeLngLat(value: unknown): LngLatTuple | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Number(Math.min(180, Math.max(-180, lng)).toFixed(6)), Number(Math.min(85, Math.max(-85, lat)).toFixed(6))];
}

function sanitizeLngLatList(value: unknown, minLength: number, maxLength = MAX_ANNOTATION_POINTS) {
  if (!Array.isArray(value)) return null;
  const points = value.map(sanitizeLngLat).filter(Boolean) as LngLatTuple[];
  return points.length >= minLength ? points.slice(0, maxLength) : null;
}

function sanitizeRouteGeometry(value: unknown) {
  if (!Array.isArray(value)) return null;
  const points = value.map(sanitizeLngLat).filter(Boolean) as LngLatTuple[];
  return points.length >= 2 ? points : null;
}

function sanitizeRouteProfile(value: unknown): AnnotationRouteProfile {
  if (value === 'walking' || value === 'cycling') return value;
  return 'driving';
}

function baseFeature(value: JsonRecord, type: AnnotationFeatureType, now: number): AnnotationFeaturePayloadBase | null {
  const id = sanitizeAnnotationId(value.id);
  if (!id) return null;
  return {
    id,
    layerId: sanitizeAnnotationId(value.layerId, ANNOTATION_DEFAULT_LAYER_ID),
    type,
    label: sanitizeAnnotationText(value.label ?? value.name, 120),
    note: sanitizeAnnotationText(value.note ?? value.description, 1200),
    color: sanitizeAnnotationColor(value.color),
    createdAt: sanitizeNumber(value.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: sanitizeNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedBy: sanitizeAnnotationText(value.updatedBy, 96),
  };
}

export function sanitizeAnnotationFeaturePayload(value: unknown, now = Date.now()): AnnotationFeaturePayload | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== 'point' && type !== 'text' && type !== 'path' && type !== 'route' && type !== 'polygon') return null;
  const base = baseFeature(value, type, now);
  if (!base) return null;

  if (type === 'point' || type === 'text') {
    const coordinate = sanitizeLngLat(value.coordinate);
    if (!coordinate) return null;
    if (type === 'text') {
      return {
        ...base,
        type,
        coordinate,
        width: sanitizeAnnotationTextWidth(value.width ?? value.text_width),
        height: sanitizeAnnotationTextHeight(value.height ?? value.text_height),
      };
    }
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
  const geometry = sanitizeRouteGeometry(value.geometry) || waypoints;
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
    distanceText: sanitizeAnnotationText(value.distanceText ?? value.distance_text, 64),
    durationText: sanitizeAnnotationText(value.durationText ?? value.duration_text, 64),
  };
}

function featureBaseProperties(feature: AnnotationFeaturePayload, kind: string): AnnotationGeoJsonProperties {
  return {
    kind,
    source: 'Annotation',
    annotation_id: feature.id,
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

function closeRing(points: LngLatTuple[]) {
  const ring = points.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return ring;
}

function lineArrowFeature(feature: AnnotationPathPayload | AnnotationRoutePayload, coordinates: LngLatTuple[]) {
  if (!feature.directed || coordinates.length < 2) return null;
  return {
    type: 'Feature' as const,
    properties: {
      ...featureBaseProperties(feature, 'annotation_arrow'),
      parent_id: feature.id,
      annotation_id: feature.id,
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

function polygonFeature(feature: AnnotationPolygonPayload): Feature<Polygon, AnnotationGeoJsonProperties> {
  return {
    type: 'Feature',
    properties: {
      ...featureBaseProperties(feature, 'annotation_polygon'),
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

function polygonOutlineFeature(feature: AnnotationPolygonPayload): Feature<LineString, AnnotationGeoJsonProperties> {
  return {
    type: 'Feature',
    properties: {
      ...featureBaseProperties(feature, 'annotation_polygon_outline'),
      parent_id: feature.id,
      annotation_id: feature.id,
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
  feature: AnnotationPathPayload | AnnotationRoutePayload,
  kind: 'annotation_path' | 'annotation_route',
  coordinates: LngLatTuple[],
): Feature<LineString, AnnotationGeoJsonProperties> {
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

export function annotationFeaturePayloadToGeoJsonFeatures(feature: AnnotationFeaturePayload): Feature[] {
  if (feature.type === 'point' || feature.type === 'text') {
    return [
      {
        type: 'Feature',
        properties: {
          ...featureBaseProperties(feature, feature.type === 'text' ? 'annotation_text' : 'annotation_point'),
          ...(feature.type === 'text' ? { text_width: feature.width, text_height: feature.height } : {}),
        },
        geometry: {
          type: 'Point',
          coordinates: feature.coordinate,
        } satisfies Point,
      },
    ];
  }

  if (feature.type === 'polygon') {
    return [polygonFeature(feature), polygonOutlineFeature(feature)];
  }

  const coordinates = feature.type === 'route' ? feature.geometry : feature.points;
  const helpers = [lineArrowFeature(feature, coordinates)].filter(Boolean);
  return [
    lineFeature(feature, feature.type === 'route' ? 'annotation_route' : 'annotation_path', coordinates),
    ...helpers,
  ];
}

export function annotationFeaturePayloadsToGeoJson(
  payloads: readonly AnnotationFeaturePayload[],
  options: AnnotationGeoJsonOptions = {},
): FeatureCollection {
  const features = payloads.flatMap((feature) => {
    if (options.layerId && feature.layerId !== options.layerId) return [];
    return annotationFeaturePayloadToGeoJsonFeatures(feature);
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

export function annotationFeaturePayloadsBounds(
  payloads: readonly AnnotationFeaturePayload[],
  options: AnnotationBoundsOptions = {},
): [[number, number], [number, number]] | null {
  let bounds: [number, number, number, number] | null = null;
  for (const feature of payloads) {
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
