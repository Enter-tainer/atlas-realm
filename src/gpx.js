// Turbo colormap (polynomial approximation per channel)
function turboColor(t) {
  t = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(255, Math.round(34.61 + t * (1172.33 - t * (10793.56 - t * (33300.12 - t * (38394.49 - t * 14825.05)))))));
  const g = Math.max(0, Math.min(255, Math.round(23.31 + t * (557.33 + t * (1225.33 - t * (3574.96 - t * (1073.77 + t * 707.56)))))));
  const b = Math.max(0, Math.min(255, Math.round(27.2 + t * (3211.1 - t * (15327.97 - t * (27814 - t * (22569.18 - t * 6838.66)))))));
  return [r, g, b];
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpx(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const points = [];
  const waypoints = [];

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

function computeSpeeds(points) {
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

function percentile(arr, p) {
  const sorted = [...arr].filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] || 1;
}

export function gpxToGeoJson(xmlString) {
  const { points, waypoints } = parseGpx(xmlString);
  if (points.length < 2 && waypoints.length === 0) return null;

  const speeds = computeSpeeds(points);
  const p1 = percentile(speeds, 0.01);
  const p99 = percentile(speeds, 0.99);
  const range = p99 - p1 || 1;

  const GAP_TIME_THRESHOLD = 1800; // 30 minutes in seconds

  const features = [];
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

let gpxLayerCount = 0;

export function addGpxToMap(map, xmlString) {
  const result = gpxToGeoJson(xmlString);
  if (!result) return;

  const id = `gpx-track-${gpxLayerCount++}`;

  map.addSource(id, {
    type: 'geojson',
    data: result.geojson,
    tolerance: 0,
  });

  // Track: outline + speed-colored line (skip if no track points)
  const hasTrack = result.geojson.features.some((f) => f.geometry?.type === 'LineString' && !f.properties?.gap);
  if (hasTrack) {
    map.addLayer({
      id: `${id}-stroke`,
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

    // Colored speed line
    map.addLayer({
      id: `${id}-line`,
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
  }

  // Gap arcs: thin gray line for lost-signal segments
  const hasGaps = result.geojson.features.some((f) => f.properties?.gap);
  if (hasGaps) {
    map.addLayer({
      id: `${id}-gap-arc`,
      type: 'line',
      source: id,
      filter: ['==', ['get', 'gap'], true],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': 'rgba(80, 90, 120, 0.7)',
        'line-width': 2.5,
      },
    });
  }

  // Gap arrows: direction indicator at midpoint of each lost-signal segment
  const hasArrows = result.geojson.features.some((f) => f.properties?.arrow);
  if (hasArrows) {
    ensureGapArrowIcon(map);
    map.addLayer({
      id: `${id}-gap-arrow`,
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
  }

  // Waypoints: symbol layer with collision detection (icon + text)
  const hasWaypoints = result.geojson.features.some((f) => f.geometry?.type === 'Point');
  if (hasWaypoints) {
    ensureMarkerIcon(map, '#3b82f6');
    map.addLayer({
      id: `${id}-wpt`,
      type: 'symbol',
      source: id,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'arrow'], true]],
      layout: {
        'icon-image': 'marker-dot-#3b82f6',
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
  }

  map.fitBounds(result.bounds, { padding: 60, maxZoom: 15 });
  return result.stats;
}

let geojsonLayerCount = 0;

/**
 * Add a GeoJSON FeatureCollection to the map.
 * Supports:
 *   - LineString features → rendered as colored tracks
 *   - Point features → rendered as circle markers with name labels
 */
export function addGeoJsonToMap(map, geojson) {
  if (!geojson || !geojson.features || geojson.features.length === 0) return;

  const lineFeatures = geojson.features.filter((f) => f.geometry?.type === 'LineString');
  const pointFeatures = geojson.features.filter((f) => f.geometry?.type === 'Point');

  const id = `geojson-layer-${geojsonLayerCount++}`;

  // Compute bounds across all features
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const f of geojson.features) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    if (f.geometry.type === 'LineString') {
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    } else if (f.geometry.type === 'Point') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const hasBounds = isFinite(minLng) && isFinite(maxLng);

  // Build a single source with all features (so they share fitBounds)
  map.addSource(id, {
    type: 'geojson',
    data: geojson,
    tolerance: 0,
  });

  // LineString: track rendering
  if (lineFeatures.length > 0) {
    map.addLayer({
      id: `${id}-line-stroke`,
      type: 'line',
      source: id,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'stroke'], '#000000'],
        'line-width': ['coalesce', ['get', 'stroke-width'], 8],
        'line-opacity': 0.9,
      },
    });
    map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], ['get', 'stroke'], '#3b82f6'],
        'line-width': ['coalesce', ['get', 'line-width'], 5],
        'line-opacity': 0.95,
      },
    });
  }

  // Point: symbol layer with collision detection (icon + text)
  if (pointFeatures.length > 0) {
    ensureMarkerIcon(map, '#3b82f6');
    map.addLayer({
      id: `${id}-point`,
      type: 'symbol',
      source: id,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'icon-image': 'marker-dot-#3b82f6',
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
  }

  if (hasBounds) {
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 60, maxZoom: 15 }
    );
  }

  return {
    lines: lineFeatures.length,
    points: pointFeatures.length,
    id,
  };
}

let pendingGpxQueue = [];
let pendingGeoJsonQueue = [];

/**
 * Defer GPX processing until map is loaded. If map is already loaded,
 * process immediately; otherwise queue for later.
 */
export function processOrQueueGpx(map, xmlString) {
  if (map.loaded()) {
    const stats = addGpxToMap(map, xmlString);
    if (stats) {
      console.log(`GPX loaded: ${stats.points} points, max ${stats.maxSpeed} km/h, p99 ${stats.p99Speed} km/h`);
    }
  } else {
    pendingGpxQueue.push(xmlString);
    console.log('Map not yet loaded, queued GPX for after load');
  }
}

/**
 * Defer GeoJSON processing until map is loaded.
 */
export function processOrQueueGeoJson(map, geojson) {
  if (map.loaded()) {
    const result = addGeoJsonToMap(map, geojson);
    if (result) {
      console.log(`GeoJSON loaded: ${result.lines} lines, ${result.points} points`);
    }
  } else {
    pendingGeoJsonQueue.push(geojson);
    console.log('Map not yet loaded, queued GeoJSON for after load');
  }
}

export function drainGpxQueue(map) {
  for (const xml of pendingGpxQueue) {
    const stats = addGpxToMap(map, xml);
    if (stats) {
      console.log(`GPX loaded (deferred): ${stats.points} points, max ${stats.maxSpeed} km/h, p99 ${stats.p99Speed} km/h`);
    }
  }
  pendingGpxQueue = [];
  for (const geojson of pendingGeoJsonQueue) {
    const result = addGeoJsonToMap(map, geojson);
    if (result) {
      console.log(`GeoJSON loaded (deferred): ${result.lines} lines, ${result.points} points`);
    }
  }
  pendingGeoJsonQueue = [];
}

/**
 * Generate a colored circle marker image and register it on the map.
 * The image is cached by color — subsequent calls with the same color are no-ops.
 */
function ensureMarkerIcon(map, color = '#3b82f6') {
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
function ensureGapArrowIcon(map) {
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
function greatCircleInterpolate(lon1, lat1, lon2, lat2, numPoints) {
  const toRad = (x) => (x * Math.PI) / 180;
  const toDeg = (x) => (x * 180) / Math.PI;

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

  const result = [];
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
function bearing(lon1, lat1, lon2, lat2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const toDeg = (x) => (x * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function installGpxDragDrop(map) {
  const container = map.getContainer();

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    container.style.outline = '3px dashed #2563eb';
  });

  container.addEventListener('dragleave', () => {
    container.style.outline = '';
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.style.outline = '';

    const file = e.dataTransfer.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.gpx')) return;

    const reader = new FileReader();
    reader.onload = () => processOrQueueGpx(map, reader.result);
    reader.readAsText(file);
  });
}
