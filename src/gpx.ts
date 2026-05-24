type TrackPoint = { lat: number; lon: number; time: number | null; ele: number | null };
type Waypoint = { lat: number; lon: number; name: string; ele: number | null };
type PendingGpxItem = { xml: string; hash: string; options: OverlayOptions };
type PendingGeoJsonItem = { geojson: GeoJsonFeatureCollection; options: OverlayOptions };

// Turbo colormap (polynomial approximation per channel)
function turboColor(t: number) {
  t = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(255, Math.round(34.61 + t * (1172.33 - t * (10793.56 - t * (33300.12 - t * (38394.49 - t * 14825.05)))))));
  const g = Math.max(0, Math.min(255, Math.round(23.31 + t * (557.33 + t * (1225.33 - t * (3574.96 - t * (1073.77 + t * 707.56)))))));
  const b = Math.max(0, Math.min(255, Math.round(27.2 + t * (3211.1 - t * (15327.97 - t * (27814 - t * (22569.18 - t * 6838.66)))))));
  return [r, g, b];
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpx(xmlString: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const points: TrackPoint[] = [];
  const waypoints: Waypoint[] = [];

  const trkpts = doc.querySelectorAll('trkpt');
  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const timeEl = pt.querySelector('time');
    const eleEl = pt.querySelector('ele');
    points.push({
      lat,
      lon,
      time: timeEl ? new Date(timeEl.textContent).getTime() / 1000 : null,
      ele: eleEl ? parseFloat(eleEl.textContent) : null,
    });
  }

  if (points.length === 0) {
    const rtepts = doc.querySelectorAll('rtept');
    for (const pt of rtepts) {
      points.push({
        lat: parseFloat(pt.getAttribute('lat')),
        lon: parseFloat(pt.getAttribute('lon')),
        time: null,
        ele: null,
      });
    }
  }

  // Parse waypoints (<wpt>)
  const wpts = doc.querySelectorAll('wpt');
  for (const pt of wpts) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const nameEl = pt.querySelector('name');
    const eleEl = pt.querySelector('ele');
    const name = nameEl?.textContent?.trim();
    // Skip empty-name waypoints
    if (!name) continue;
    waypoints.push({
      lat,
      lon,
      name,
      ele: eleEl ? parseFloat(eleEl.textContent) : null,
    });
  }

  return { points, waypoints };
}

const MIN_SEGMENT_LENGTH_M = 10;

function computeSpeeds(points: TrackPoint[]) {
  const speeds = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.time != null && curr.time != null && curr.time > prev.time) {
      const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
      if (dist < MIN_SEGMENT_LENGTH_M) {
        // Accumulate backward until we have enough distance for a reliable speed
        let windowDist = dist;
        let windowTime = curr.time - prev.time;
        for (let j = i - 1; j > 0 && windowDist < MIN_SEGMENT_LENGTH_M; j--) {
          const pj = points[j];
          const pjPrev = points[j - 1];
          if (pjPrev.time == null || pj.time == null) break;
          windowDist += haversineDistance(pjPrev.lat, pjPrev.lon, pj.lat, pj.lon);
          windowTime = curr.time - pjPrev.time;
        }
        speeds.push(windowTime > 0 ? windowDist / windowTime : 0);
      } else {
        speeds.push(dist / (curr.time - prev.time));
      }
    } else {
      speeds.push(0);
    }
  }
  return speeds;
}

function percentile(arr: number[], p: number) {
  const sorted = [...arr].filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] || 1;
}

export function gpxToGeoJson(xmlString: string) {
  const { points, waypoints } = parseGpx(xmlString);
  if (points.length < 2 && waypoints.length === 0) return null;

  const speeds = computeSpeeds(points);
  const p1 = percentile(speeds, 0.01);
  const p99 = percentile(speeds, 0.99);
  const range = p99 - p1 || 1;

  const GAP_TIME_THRESHOLD = 1800; // 30 minutes in seconds

  const features: GeoJsonFeature[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dt = (curr.time != null && prev.time != null) ? curr.time - prev.time : 0;

    if (dt > GAP_TIME_THRESHOLD) {
      // GPS signal lost — render a great circle arc + arrow instead of a straight line
      const arcCoords = greatCircleInterpolate(prev.lon, prev.lat, curr.lon, curr.lat, 14);
      features.push({
        type: 'Feature',
        properties: { gap: true },
        geometry: { type: 'LineString', coordinates: arcCoords },
      });
      // Arrow at midpoint
      const midIdx = Math.floor(arcCoords.length / 2);
      const [midLon, midLat] = arcCoords[midIdx];
      features.push({
        type: 'Feature',
        properties: {
          arrow: true,
          bearing: bearing(prev.lon, prev.lat, curr.lon, curr.lat),
        },
        geometry: { type: 'Point', coordinates: [midLon, midLat] },
      });
    } else {
      // Normal speed-colored segment
      const speed = speeds[i];
      const normalized = Math.max(0, Math.min(1, (speed - p1) / range));
      const [r, g, b] = turboColor(normalized);
      features.push({
        type: 'Feature',
        properties: {
          speed: Math.round(speed * 3.6 * 10) / 10,
          color: `rgb(${r},${g},${b})`,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [prev.lon, prev.lat],
            [curr.lon, curr.lat],
          ],
        },
      });
    }
  }

  // Add waypoints as Point features
  for (const wp of waypoints) {
    features.push({
      type: 'Feature',
      properties: {
        name: wp.name,
        'marker-color': '#3b82f6',
      },
      geometry: {
        type: 'Point',
        coordinates: [wp.lon, wp.lat],
      },
    });
  }

  // Compute bounds from track points, falling back to waypoints
  let lngs, lats;
  if (points.length > 0) {
    lngs = points.map((p) => p.lon);
    lats = points.map((p) => p.lat);
  } else {
    lngs = waypoints.map((p) => p.lon);
    lats = waypoints.map((p) => p.lat);
  }
  const bounds = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];

  return {
    geojson: { type: 'FeatureCollection', features },
    bounds,
    stats: {
      points: points.length,
      maxSpeed: Math.round(Math.max(...speeds) * 3.6 * 10) / 10,
      p99Speed: Math.round(p99 * 3.6 * 10) / 10,
    },
  };
}

// ── SHA-256 dedup ─────────────────────────────────────────
const loadedGpxHashes = new Set<string>();
const DEFAULT_OVERLAY_COLOR = '#3b82f6';
const OSRM_ROUTE_COLOR = '#0f766e';
const OSRM_KIND_PREFIX = 'osrm_';
const REMOTE_OVERLAY_EVENT_KEY = Symbol('remoteOverlayEvent');
type JsonRecord = Record<string | symbol, unknown>;
type Bounds = [[number, number], [number, number]];
type BoundsLike = number[][];
type GeoJsonGeometry = {
  type?: string | null;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};
type GeoJsonFeature = {
  type: 'Feature';
  properties: JsonRecord;
  geometry: GeoJsonGeometry | null;
};
type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};
type OverlayOptions = JsonRecord & {
  name?: string;
  remote?: boolean;
  syncOverlayId?: string;
  remoteOverlayId?: string;
  contentHash?: string;
  color?: string;
};
type OverlayMap = {
  _overlayStyleReady?: boolean;
  loaded?: () => boolean;
  getContainer(): HTMLElement;
  addSource(id: string, source: unknown): void;
  addLayer(layer: unknown): void;
  hasImage(name: string): boolean;
  addImage(name: string, image: ImageData, options?: Record<string, unknown>): void;
  fitBounds(bounds: Bounds, options?: Record<string, unknown>): void;
};

function normalizeOverlayName(name: unknown, fallback: string) {
  const normalized = String(name || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function dispatchOverlayAdded(map: OverlayMap, overlay: JsonRecord, options: OverlayOptions = {}) {
  const detail: JsonRecord = { ...overlay };
  if (options.remote) detail[REMOTE_OVERLAY_EVENT_KEY] = true;
  map.getContainer()?.dispatchEvent(new CustomEvent('overlay:add', { detail }));
}

export function isRemoteOverlayEvent(overlay: unknown) {
  return Boolean(overlay && typeof overlay === 'object' && (overlay as JsonRecord)[REMOTE_OVERLAY_EVENT_KEY]);
}

function visitGeometryCoordinates(geometry: GeoJsonGeometry | null | undefined, callback: (lng: number, lat: number) => void) {
  if (!geometry) return;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries || []) visitGeometryCoordinates(child, callback);
    return;
  }

  const walk = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [lng, lat] = coords;
      if (Number.isFinite(lng) && Number.isFinite(lat)) callback(lng, lat);
      return;
    }
    for (const child of coords) walk(child);
  };

  walk(geometry.coordinates);
}

function flattenGeometry(geometry: GeoJsonGeometry | null | undefined, properties: JsonRecord = {}): GeoJsonFeature[] {
  if (!geometry) return [{ type: 'Feature', properties, geometry: null }];
  if (geometry.type !== 'GeometryCollection') {
    return [{ type: 'Feature', properties, geometry }];
  }
  return (geometry.geometries || []).flatMap((child) => flattenGeometry(child, properties));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeGeoJson(geojson: unknown): GeoJsonFeatureCollection | null {
  if (!isRecord(geojson)) return null;

  if (geojson.type === 'FeatureCollection') {
    const features = Array.isArray(geojson.features) ? geojson.features : [];
    return {
      type: 'FeatureCollection',
      features: features.flatMap((feature) => {
        if (!isRecord(feature) || feature.type !== 'Feature') return [];
        return flattenGeometry(feature.geometry as GeoJsonGeometry | null, isRecord(feature.properties) ? feature.properties : {});
      }),
    };
  }

  if (geojson.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: flattenGeometry(geojson.geometry as GeoJsonGeometry | null, isRecord(geojson.properties) ? geojson.properties : {}),
    };
  }

  if (typeof geojson.type === 'string') {
    return {
      type: 'FeatureCollection',
      features: flattenGeometry(geojson as GeoJsonGeometry, {}),
    };
  }

  return null;
}

function getGeometryFamily(geometry: GeoJsonGeometry | null | undefined) {
  if (!geometry) return null;
  if (geometry.type === 'Point' || geometry.type === 'MultiPoint') return 'point';
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') return 'line';
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return 'polygon';
  return null;
}

function getFeatureKind(feature: GeoJsonFeature) {
  return String(feature?.properties?.kind || '');
}

function isOsrmFeature(feature: GeoJsonFeature) {
  return feature?.properties?.source === 'OSRM' || getFeatureKind(feature).startsWith(OSRM_KIND_PREFIX);
}

function hasOsrmFeatures(geojson: GeoJsonFeatureCollection) {
  return (geojson.features || []).some(isOsrmFeature);
}

function osrmKindFilter(kind: string) {
  return ['==', ['get', 'kind'], kind];
}

function summarizeGeoJson(geojson: GeoJsonFeatureCollection) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let lines = 0;
  let points = 0;
  let polygons = 0;

  for (const feature of geojson.features || []) {
    const family = getGeometryFamily(feature.geometry);
    if (family === 'line') lines += 1;
    if (family === 'point') points += 1;
    if (family === 'polygon') polygons += 1;

    visitGeometryCoordinates(feature.geometry, (lng, lat) => {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    });
  }

  return {
    lines,
    points,
    polygons,
    features: geojson.features?.length || 0,
    bounds: Number.isFinite(minLng) && Number.isFinite(maxLng)
      ? [[minLng, minLat], [maxLng, maxLat]]
      : null,
  };
}

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isMapReadyForOverlay(map: OverlayMap) {
  return Boolean(map._overlayStyleReady || map.loaded?.());
}

/** Merge two [[sw],[ne]] bounds into one, returns first if second is null */
export function mergeBounds(a: BoundsLike | null | undefined, b: BoundsLike | null | undefined): Bounds | null | undefined {
  if (!a) return b as Bounds | null | undefined;
  if (!b) return a as Bounds;
  return [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ];
}

let gpxLayerCount = 0;

export function addGpxToMap(map: OverlayMap, xmlString: string, options: OverlayOptions = {}) {
  const result = gpxToGeoJson(xmlString);
  if (!result) return;

  const id = `gpx-track-${gpxLayerCount++}`;
  const color = DEFAULT_OVERLAY_COLOR;
  const layerIds = [];

  map.addSource(id, {
    type: 'geojson',
    data: result.geojson,
    tolerance: 0,
  });

  // Track: outline + speed-colored line (skip if no track points)
  const hasTrack = result.geojson.features.some((f) => f.geometry?.type === 'LineString' && !f.properties?.gap);
  if (hasTrack) {
    const strokeLayerId = `${id}-stroke`;
    map.addLayer({
      id: strokeLayerId,
      type: 'line',
      source: id,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'gap'], true]],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#000000',
        'line-width': 8,
        'line-opacity': 0.9,
      },
    });
    layerIds.push(strokeLayerId);

    // Colored speed line
    const lineLayerId = `${id}-line`;
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: id,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'gap'], true]],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        'line-opacity': 0.95,
      },
    });
    layerIds.push(lineLayerId);
  }

  // Gap arcs: thin gray line for lost-signal segments
  const hasGaps = result.geojson.features.some((f) => f.properties?.gap);
  if (hasGaps) {
    const gapLayerId = `${id}-gap-arc`;
    map.addLayer({
      id: gapLayerId,
      type: 'line',
      source: id,
      filter: ['==', ['get', 'gap'], true],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': 'rgba(80, 90, 120, 0.5)',
        'line-width': 2.5,
      },
    });
    layerIds.push(gapLayerId);
  }

  // Gap arrows: direction indicator at midpoint of each lost-signal segment
  const hasArrows = result.geojson.features.some((f) => f.properties?.arrow);
  if (hasArrows) {
    ensureGapArrowIcon(map);
    const arrowLayerId = `${id}-gap-arrow`;
    map.addLayer({
      id: arrowLayerId,
      type: 'symbol',
      source: id,
      filter: ['==', ['get', 'arrow'], true],
      layout: {
        'icon-image': 'gap-arrow',
        'icon-size': 1.2,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
      paint: {
        'icon-opacity': 0.85,
      },
    });
    layerIds.push(arrowLayerId);
  }

  // Waypoints: symbol layer with collision detection (icon + text)
  const hasWaypoints = result.geojson.features.some((f) => f.geometry?.type === 'Point');
  if (hasWaypoints) {
    ensureMarkerIcon(map, color);
    const waypointLayerId = `${id}-wpt`;
    map.addLayer({
      id: waypointLayerId,
      type: 'symbol',
      source: id,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'arrow'], true]],
      layout: {
        'icon-image': `marker-dot-${color}`,
        'icon-size': 0.5,
        'icon-allow-overlap': false,
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.8],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
    layerIds.push(waypointLayerId);
  }

  const overlay = {
    type: 'gpx',
    id,
    sourceId: id,
    layerIds,
    name: normalizeOverlayName(options.name, `GPX ${gpxLayerCount}`),
    color,
    opacity: 0.95,
    lineWidth: 5,
    visible: true,
    bounds: result.bounds,
    data: result.geojson,
    rawText: xmlString,
    syncOverlayId: options.syncOverlayId,
    remoteOverlayId: options.remoteOverlayId,
    contentHash: options.contentHash,
    ...result.stats,
  };
  dispatchOverlayAdded(map, overlay, { remote: options.remote });
  return overlay;
}

let geojsonLayerCount = 0;

/**
 * Add a GeoJSON FeatureCollection to the map.
 * Supports:
 *   - LineString features → rendered as colored tracks
 *   - Point features → rendered as circle markers with name labels
 */
export function addGeoJsonToMap(map: OverlayMap, geojson: unknown, options: OverlayOptions = {}) {
  const normalized = normalizeGeoJson(geojson);
  if (!normalized || !normalized.features || normalized.features.length === 0) return;

  const summary = summarizeGeoJson(normalized);
  const color = options.color || DEFAULT_OVERLAY_COLOR;
  const containsOsrm = hasOsrmFeatures(normalized);
  const routeFeature = containsOsrm
    ? normalized.features.find((feature) => getFeatureKind(feature) === 'osrm_route')
    : null;
  const lineFeatures = normalized.features.filter((f) => getGeometryFamily(f.geometry) === 'line');
  const pointFeatures = normalized.features.filter((f) => getGeometryFamily(f.geometry) === 'point');
  const polygonFeatures = normalized.features.filter((f) => getGeometryFamily(f.geometry) === 'polygon');
  const layerIds = [];

  const id = `geojson-layer-${geojsonLayerCount++}`;

  // Build a single source with all features (so they share fitBounds)
  map.addSource(id, {
    type: 'geojson',
    data: normalized,
    tolerance: 0,
  });

  if (containsOsrm) {
    const osrmStepLayerId = `${id}-osrm-step`;
    map.addLayer({
      id: osrmStepLayerId,
      type: 'line',
      source: id,
      filter: osrmKindFilter('osrm_step'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], color, OSRM_ROUTE_COLOR],
        'line-width': 9,
        'line-opacity': 0.01,
      },
    });
    layerIds.push(osrmStepLayerId);

    const osrmRouteStrokeLayerId = `${id}-osrm-route-stroke`;
    map.addLayer({
      id: osrmRouteStrokeLayerId,
      type: 'line',
      source: id,
      filter: osrmKindFilter('osrm_route'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#000000',
        'line-width': ['coalesce', ['get', 'stroke-width'], 8],
        'line-opacity': 0.82,
      },
    });
    layerIds.push(osrmRouteStrokeLayerId);

    const osrmRouteLayerId = `${id}-osrm-route`;
    map.addLayer({
      id: osrmRouteLayerId,
      type: 'line',
      source: id,
      filter: osrmKindFilter('osrm_route'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], ['get', 'stroke'], color, OSRM_ROUTE_COLOR],
        'line-width': ['coalesce', ['get', 'line-width'], 5],
        'line-opacity': 0.95,
      },
    });
    layerIds.push(osrmRouteLayerId);

    const osrmSegmentLayerId = `${id}-osrm-segment`;
    map.addLayer({
      id: osrmSegmentLayerId,
      type: 'line',
      source: id,
      filter: osrmKindFilter('osrm_segment'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'speed_kmh'], 0],
          0, '#b91c1c',
          20, '#f97316',
          40, '#eab308',
          70, '#22c55e',
          100, '#2563eb',
        ],
        'line-width': 3,
        'line-opacity': 0.72,
      },
    });
    layerIds.push(osrmSegmentLayerId);

    const osrmManeuverLayerId = `${id}-osrm-maneuver`;
    map.addLayer({
      id: osrmManeuverLayerId,
      type: 'circle',
      source: id,
      filter: osrmKindFilter('osrm_maneuver'),
      paint: {
        'circle-radius': [
          'case',
          ['in', ['get', 'maneuver'], ['literal', ['depart', 'arrive']]],
          5.5,
          4,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'maneuver'], 'depart'], '#16a34a',
          ['==', ['get', 'maneuver'], 'arrive'], '#dc2626',
          '#ffffff',
        ],
        'circle-stroke-color': ['coalesce', ['get', 'color'], ['get', 'stroke'], color, OSRM_ROUTE_COLOR],
        'circle-stroke-width': 2,
        'circle-opacity': 0.96,
        'circle-stroke-opacity': 0.96,
      },
    });
    layerIds.push(osrmManeuverLayerId);
  } else if (polygonFeatures.length > 0) {
    const fillLayerId = `${id}-polygon-fill`;
    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: id,
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: {
        'fill-color': ['coalesce', ['get', 'fill'], ['get', 'marker-color'], color],
        'fill-opacity': 0.18,
      },
    });
    layerIds.push(fillLayerId);

    const outlineLayerId = `${id}-polygon-outline`;
    map.addLayer({
      id: outlineLayerId,
      type: 'line',
      source: id,
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'stroke'], color],
        'line-width': ['coalesce', ['get', 'stroke-width'], 2],
        'line-opacity': 0.8,
      },
    });
    layerIds.push(outlineLayerId);
  }

  // LineString: track rendering
  if (!containsOsrm && lineFeatures.length > 0) {
    const strokeLayerId = `${id}-line-stroke`;
    map.addLayer({
      id: strokeLayerId,
      type: 'line',
      source: id,
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'stroke'], '#000000'],
        'line-width': ['coalesce', ['get', 'stroke-width'], 8],
        'line-opacity': 0.9,
      },
    });
    layerIds.push(strokeLayerId);

    const lineLayerId = `${id}-line`;
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: id,
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], ['get', 'stroke'], color],
        'line-width': ['coalesce', ['get', 'line-width'], 5],
        'line-opacity': 0.95,
      },
    });
    layerIds.push(lineLayerId);
  }

  // Point: symbol layer with collision detection (icon + text)
  if (!containsOsrm && pointFeatures.length > 0) {
    ensureMarkerIcon(map, color);
    const pointLayerId = `${id}-point`;
    map.addLayer({
      id: pointLayerId,
      type: 'symbol',
      source: id,
      filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
      layout: {
        'icon-image': `marker-dot-${color}`,
        'icon-size': 0.5,
        'icon-allow-overlap': false,
        'text-field': ['coalesce', ['get', 'name'], ['get', 'title'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 1.8],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
    layerIds.push(pointLayerId);
  }

  const overlay = {
    type: 'geojson',
    subType: containsOsrm ? 'osrm' : 'geojson',
    id,
    sourceId: id,
    layerIds,
    name: normalizeOverlayName(options.name, `GeoJSON ${geojsonLayerCount}`),
    color,
    opacity: 0.95,
    lineWidth: 5,
    visible: true,
    data: normalized,
    syncOverlayId: options.syncOverlayId,
    remoteOverlayId: options.remoteOverlayId,
    contentHash: options.contentHash,
    distanceText: routeFeature?.properties?.distance_text,
    durationText: routeFeature?.properties?.duration_text,
    stepCount: routeFeature?.properties?.step_count,
    annotationSegmentCount: routeFeature?.properties?.annotation_segment_count,
    ...summary,
  };
  dispatchOverlayAdded(map, overlay, { remote: options.remote });
  return overlay;
}

let pendingGpxQueue: PendingGpxItem[] = [];
let pendingGeoJsonQueue: PendingGeoJsonItem[] = [];

/**
 * Defer GPX processing until map is loaded. If map is already loaded,
 * process immediately; otherwise queue for later.
 * Returns the stats or null if skipped (duplicate).
 */
export async function processOrQueueGpx(map: OverlayMap, xmlString: string, options: OverlayOptions = {}) {
  // SHA-256 dedup — skip if we've seen identical content before
  const hash = await sha256(xmlString);
  if (!options.remote && loadedGpxHashes.has(hash)) {
    console.log('GPX skipped: duplicate content (SHA-256 match)');
    return null;
  }
  loadedGpxHashes.add(hash);

  if (isMapReadyForOverlay(map)) {
    const stats = addGpxToMap(map, xmlString, options);
    if (stats) {
      console.log(`GPX loaded: ${stats.points} points, max ${stats.maxSpeed} km/h, p99 ${stats.p99Speed} km/h`);
    }
    return stats || null;
  } else {
    // Compute bounds now so caller can fitBounds immediately,
    // without waiting for the map tiles to finish loading.
    const result = gpxToGeoJson(xmlString);
    pendingGpxQueue.push({ xml: xmlString, hash, options });
    console.log('Map not yet loaded, queued GPX for after load');
    if (result) {
      return { bounds: result.bounds, points: result.stats.points, maxSpeed: result.stats.maxSpeed, p99Speed: result.stats.p99Speed };
    }
    return null;
  }
}

/**
 * Defer GeoJSON processing until map is loaded.
 * Also returns bounds immediately so the caller can zoom before map tiles load.
 */
export function processOrQueueGeoJson(map: OverlayMap, geojson: unknown, options: OverlayOptions = {}) {
  const normalized = normalizeGeoJson(geojson);
  const summary = normalized ? summarizeGeoJson(normalized) : { bounds: null as Bounds | null };
  if (!normalized || normalized.features.length === 0) return null;

  if (isMapReadyForOverlay(map)) {
    const result = addGeoJsonToMap(map, normalized, options);
    if (result) {
      console.log(`GeoJSON loaded: ${result.lines} lines, ${result.points} points`);
    }
    return summary.bounds ? { bounds: summary.bounds } : null;
  } else {
    pendingGeoJsonQueue.push({ geojson: normalized, options });
    console.log('Map not yet loaded, queued GeoJSON for after load');
    return summary.bounds ? { bounds: summary.bounds } : null;
  }
}

export function drainGpxQueue(map: OverlayMap) {
  map._overlayStyleReady = true;
  let bounds: Bounds | null = null;
  for (const item of pendingGpxQueue) {
    const stats = addGpxToMap(map, item.xml, item.options);
    if (stats) {
      console.log(`GPX loaded (deferred): ${stats.points} points, max ${stats.maxSpeed} km/h, p99 ${stats.p99Speed} km/h`);
      bounds = mergeBounds(bounds, stats.bounds);
    }
  }
  pendingGpxQueue = [];
  for (const item of pendingGeoJsonQueue) {
    const result = addGeoJsonToMap(map, item.geojson, item.options);
    if (result) {
      console.log(`GeoJSON loaded (deferred): ${result.lines} lines, ${result.points} points`);
      bounds = mergeBounds(bounds, result.bounds);
    }
  }
  pendingGeoJsonQueue = [];
  if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
}

/**
 * Generate a colored circle marker image and register it on the map.
 * The image is cached by color — subsequent calls with the same color are no-ops.
 */
function ensureMarkerIcon(map: OverlayMap, color = '#3b82f6') {
  const imageName = `marker-dot-${color}`;
  if (map.hasImage(imageName)) return;

  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size * 4;
  canvas.height = size * 4;
  const ctx = canvas.getContext('2d');

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  ctx.beginPath();
  ctx.arc(size * 2, size * 2, size - 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  map.addImage(imageName, imageData, { pixelRatio: 2 });
}

/**
 * Generate a small triangular arrow icon pointing upward (north).
 * Used as a direction indicator on lost-signal gap arcs.
 */
function ensureGapArrowIcon(map: OverlayMap) {
  if (map.hasImage('gap-arrow')) return;

  const size = 14;
  const canvas = document.createElement('canvas');
  canvas.width = size * 4;
  canvas.height = size * 4;
  const ctx = canvas.getContext('2d');

  const cx = size * 2;
  const cy = size * 2;
  const r = size;

  // Arrowhead pointing up
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);          // top tip
  ctx.lineTo(cx + r * 0.6, cy + r * 0.2);  // right bottom
  ctx.lineTo(cx + r * 0.15, cy + r * 0.1);  // inner right
  ctx.lineTo(cx + r * 0.15, cy + r);        // right tail
  ctx.lineTo(cx - r * 0.15, cy + r);        // left tail
  ctx.lineTo(cx - r * 0.15, cy + r * 0.1);  // inner left
  ctx.lineTo(cx - r * 0.6, cy + r * 0.2);   // left bottom
  ctx.closePath();
  ctx.fillStyle = 'rgba(60, 70, 100, 0.85)';
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  map.addImage('gap-arrow', imageData, { pixelRatio: 2 });
}

/**
 * Interpolate points along a great circle arc between two coordinates.
 * Uses spherical linear interpolation (SLERP) for a natural curved path
 * on the Mercator projection.
 */
function greatCircleInterpolate(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  numPoints: number,
) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const toDeg = (x: number) => (x * 180) / Math.PI;

  const phi1 = toRad(lat1);
  const lambda1 = toRad(lon1);
  const phi2 = toRad(lat2);
  const lambda2 = toRad(lon2);

  // Convert to 3D Cartesian
  const x1 = Math.cos(phi1) * Math.cos(lambda1);
  const y1 = Math.cos(phi1) * Math.sin(lambda1);
  const z1 = Math.sin(phi1);

  const x2 = Math.cos(phi2) * Math.cos(lambda2);
  const y2 = Math.cos(phi2) * Math.sin(lambda2);
  const z2 = Math.sin(phi2);

  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);

  const result: number[][] = [];
  if (omega < 1e-10) {
    // Nearly identical points — return straight line
    result.push([lon1, lat1], [lon2, lat2]);
    return result;
  }

  const sinOmega = Math.sin(omega);
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    const x = a * x1 + b * x2;
    const y = a * y1 + b * y2;
    const z = a * z1 + b * z2;
    result.push([toDeg(Math.atan2(y, x)), toDeg(Math.asin(z))]);
  }
  return result;
}

/**
 * Calculate initial bearing (in degrees clockwise from north) from point A to B.
 */
function bearing(lon1: number, lat1: number, lon2: number, lat2: number) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const toDeg = (x: number) => (x * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function installGpxDragDrop(map: OverlayMap) {
  const container = map.getContainer();

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    container.style.outline = '3px dashed #2563eb';
  });

  container.addEventListener('dragleave', () => {
    container.style.outline = '';
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.style.outline = '';

    const supportedFiles = (Array.from(e.dataTransfer?.files || []) as File[])
      .filter((f) => /\.(gpx|geojson|json)$/i.test(f.name));
    if (supportedFiles.length === 0) return;

    let bounds: Bounds | null = null;
    let loaded = 0;
    for (const file of supportedFiles) {
      const text = await file.text();
      try {
        if (/\.gpx$/i.test(file.name)) {
          const stats = await processOrQueueGpx(map, text, { name: file.name });
          if (stats) {
            loaded++;
            console.log(`GPX loaded: ${file.name} — ${stats.points} points, max ${stats.maxSpeed} km/h, p99 ${stats.p99Speed} km/h`);
            bounds = mergeBounds(bounds, stats.bounds);
          }
        } else {
          const result = processOrQueueGeoJson(map, JSON.parse(text), { name: file.name });
          if (result) {
            loaded++;
            console.log(`GeoJSON loaded: ${file.name}`);
            bounds = mergeBounds(bounds, result.bounds);
          }
        }
      } catch (error) {
        console.error(`Failed to load overlay file: ${file.name}`, error);
      }
    }
    if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    if (loaded === 0) console.log('No overlay files loaded');
  });
}
