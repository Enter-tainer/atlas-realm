// Turbo colormap (subset of Google's turbo, 256 entries approximated by formula)
function turboColor(t) {
  // t in [0, 1], returns [r, g, b] in [0, 255]
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

  // If no trkpts, try rtept or wpt
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

  return points;
}

function computeSpeeds(points) {
  const speeds = [0]; // first point has no speed
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.time != null && curr.time != null && curr.time > prev.time) {
      const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
      const dt = curr.time - prev.time;
      speeds.push(dist / dt); // m/s
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
  const points = parseGpx(xmlString);
  if (points.length < 2) return null;

  const speeds = computeSpeeds(points);
  const p95 = percentile(speeds, 0.95);

  // Build line segments, each colored by speed
  const features = [];
  for (let i = 1; i < points.length; i++) {
    const speed = speeds[i];
    const normalized = Math.min(speed / p95, 1);
    const [r, g, b] = turboColor(normalized);
    features.push({
      type: 'Feature',
      properties: {
        speed: Math.round(speed * 3.6 * 10) / 10, // km/h
        color: `rgb(${r},${g},${b})`,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [points[i - 1].lon, points[i - 1].lat],
          [points[i].lon, points[i].lat],
        ],
      },
    });
  }

  // Compute bounds
  const lngs = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
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
      p95Speed: Math.round(p95 * 3.6 * 10) / 10,
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
  });

  map.addLayer({
    id: `${id}-line`,
    type: 'line',
    source: id,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 3,
      'line-opacity': 0.9,
    },
  });

  map.fitBounds(result.bounds, { padding: 60, maxZoom: 15 });
  return result.stats;
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
    reader.onload = () => {
      const stats = addGpxToMap(map, reader.result);
      if (stats) {
        console.log(`GPX loaded: ${stats.points} points, max ${stats.maxSpeed} km/h, p95 ${stats.p95Speed} km/h`);
      }
    };
    reader.readAsText(file);
  });
}
