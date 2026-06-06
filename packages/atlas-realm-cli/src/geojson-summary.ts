import type { JsonRecord, LngLatTuple, FileLayerSummary } from './types.js';

type CoordinateVisitor = (lng: number, lat: number) => void;

export function visitGeometryCoordinates(geometry: unknown, callback: CoordinateVisitor): void {
  if (!geometry || typeof geometry !== 'object') return;
  const record = geometry as JsonRecord;
  if (record.type === 'GeometryCollection') {
    for (const child of Array.isArray(record.geometries) ? record.geometries : []) {
      visitGeometryCoordinates(child, callback);
    }
    return;
  }
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) callback(lng, lat);
      return;
    }
    for (const child of coords) walk(child);
  };
  walk(record.coordinates);
}

export function geometryFamily(geometry: unknown): 'point' | 'line' | 'polygon' | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const { type } = geometry as JsonRecord;
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  return null;
}

export function geoJsonFeatures(geojson: unknown): JsonRecord[] {
  if (!geojson || typeof geojson !== 'object') return [];
  const record = geojson as JsonRecord;
  if (record.type === 'FeatureCollection') return Array.isArray(record.features) ? record.features : [];
  if (record.type === 'Feature') return [record];
  if (typeof record.type === 'string') return [{ type: 'Feature', properties: {}, geometry: record }];
  return [];
}

export function summarizeGeoJson(geojson: unknown): FileLayerSummary {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let lines = 0;
  let points = 0;
  let polygons = 0;
  const features = geoJsonFeatures(geojson);

  for (const feature of features) {
    const family = geometryFamily(feature?.geometry);
    if (family === 'line') lines += 1;
    if (family === 'point') points += 1;
    if (family === 'polygon') polygons += 1;
    visitGeometryCoordinates(feature?.geometry, (lng: number, lat: number) => {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });
  }

  return {
    lines,
    points,
    polygons,
    features: features.length,
    bounds: Number.isFinite(minLng)
      ? [
          [minLng, minLat],
          [maxLng, maxLat],
        ]
      : null,
  };
}

export function summarizeGpx(text: string): FileLayerSummary {
  const coords: LngLatTuple[] = [];
  const tagRe = /<(?:trkpt|rtept|wpt)\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(text))) {
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)=(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(tagMatch[1]))) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2] ?? attrMatch[3] ?? '';
    }
    const lat = Number(attrs.lat);
    const lng = Number(attrs.lon);
    if (Number.isFinite(lng) && Number.isFinite(lat)) coords.push([lng, lat]);
  }
  if (coords.length === 0) return { points: 0, bounds: null };
  const lngs = coords.map((coord) => coord[0]);
  const lats = coords.map((coord) => coord[1]);
  return {
    points: coords.length,
    bounds: [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
  };
}
