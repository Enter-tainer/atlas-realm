import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { installGpxDragDrop, drainGpxQueue, processOrQueueGpx, processOrQueueGeoJson, mergeBounds } from './gpx.js';
import { installOrmPopups, buildFeatureCatalog } from './popup.js';
import { installPhotonSearch } from './search.js';
import { installMapCollaboration } from './collaboration.js';
import { installWeatherPointPicker } from './weather.js';
import { installOverlayManager } from './overlay-manager.js';

const LOCAL_ORM_PREFIX = '/orm';
const STYLE_URL = `${LOCAL_ORM_PREFIX}/style/standard.json?v=${__STYLE_HASH__}`;
const TILE_VERSION = '20260511a';
const TILE_URL = `${window.location.origin}/tiles/openrailwaymap/{z}/{x}/{y}.mvt?v=${TILE_VERSION}`;
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MAPTERHORN_TERRAIN_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const SATELLITE_URL = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
const FULLSCREEN_ACTIVE_CLASS = 'route-map-fullscreen-active';
const SHOW_BASE_MAP_STATE = 'showBaseMap';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="map"></div>
`;

const featuresCatalog = buildFeatureCatalog();

function absoluteUrl(path) {
  return `${window.location.origin}${path}`;
}

function importNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === 'data:') return fallback;
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || fallback;
  } catch {
    return fallback;
  }
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.json();
}

async function loadImage(url) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Fetch with stale-while-revalidate caching.
 * Serves cached responses instantly while revalidating in the background.
 */
const swrCache = new Map();
async function fetchWithSwr(url, ttlMs = 3600_000) {
  const cached = swrCache.get(url);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    // Still fresh — return directly
    return cached.response.clone();
  }
  if (cached) {
    // Stale — return cached version, revalidate in background
    fetch(url).then((res) => {
      if (res.ok) swrCache.set(url, { response: res, timestamp: Date.now() });
    }).catch(() => {});
    return cached.response.clone();
  }
  // No cache — fetch and store
  const res = await fetch(url);
  if (res.ok) swrCache.set(url, { response: res.clone(), timestamp: Date.now() });
  return res;
}

function rewriteOrmStyle(style) {
  style.glyphs = absoluteUrl('/orm/font/{fontstack}/{range}');

  if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map((sprite) => ({ ...sprite, url: absoluteUrl(sprite.url.startsWith('/orm/') ? sprite.url : `/orm${sprite.url}`) }));
  } else if (style.sprite?.startsWith('/')) {
    style.sprite = absoluteUrl(`/orm${style.sprite}`);
  }

  const rewrittenSources = [];
  style.sources = Object.fromEntries(Object.entries(style.sources).map(([name, source]) => {
    if (source?.type === 'vector' && source.url?.startsWith('/')) {
      rewrittenSources.push(name);
      return [name, {
        type: 'vector',
        tiles: [TILE_URL],
        attribution: source.attribution,
        promoteId: source.promoteId,
        bounds: source.bounds,
        scheme: source.scheme,
        metadata: source.metadata,
        maxzoom: 15,
      }];
    }
    return [name, source];
  }));

  style.metadata = {
    ...(style.metadata || {}),
    ormClone: true,
    ormRewrittenSources: rewrittenSources,
  };

  return style;
}

function getFirstSymbolLayerId(style) {
  return (style.layers || []).find((layer) => layer.type === 'symbol')?.id;
}

function addMapterhornTerrain(style, demSource) {
  style.sources = {
    ...(style.sources || {}),
    hillshadeSource: {
      type: 'raster-dem',
      url: 'https://tiles.mapterhorn.com/tilejson.json',
    },
    contourSource: {
      type: 'vector',
      tiles: [demSource.contourProtocolUrl({
        thresholds: {
          9: [100, 500],
          10: [50, 250],
          11: [25, 100],
          12: [25, 100],
          13: [10, 50],
          14: [10, 40],
        },
        contourLayer: 'contours',
        elevationKey: 'ele',
        levelKey: 'level',
      })],
      maxzoom: 17,
    },
  };

  const terrainBaseLayers = [
    {
      id: 'trip-hillshade',
      type: 'hillshade',
      source: 'hillshadeSource',
      paint: {
        'hillshade-shadow-color': 'rgba(20, 24, 36, 0.34)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.28)',
        'hillshade-illumination-direction': 315,
        'hillshade-exaggeration': 0.26,
      },
    },
    {
      id: 'trip-contour-lines',
      type: 'line',
      source: 'contourSource',
      'source-layer': 'contours',
      minzoom: 8,
      paint: {
        'line-color': ['match', ['get', 'level'], 0, 'rgba(45, 56, 78, 0.28)', 'rgba(34, 44, 64, 0.44)'],
        'line-width': ['match', ['get', 'level'], 0, 0.45, 1, 1.05, 1.35],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.26, 11, 0.42, 14, 0.65],
      },
    },
  ];

  const contourLabelLayer = {
    id: 'trip-contour-labels',
    type: 'symbol',
    source: 'contourSource',
    'source-layer': 'contours',
    filter: ['>', ['get', 'level'], 0],
    minzoom: 10,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 200,
      'text-size': 10,
      'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
      'text-font': ['Noto Sans Regular'],
      'text-max-angle': 90,
      'text-padding': 1,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': 'rgba(22, 31, 48, 0.6)',
      'text-halo-color': 'rgba(255, 255, 255, 0.82)',
      'text-halo-width': 1.1,
    },
  };

  // Insert hillshade and contour lines before other symbol layers (they render underneath)
  const beforeId = getFirstSymbolLayerId(style);
  const insertIndex = beforeId ? style.layers.findIndex((layer) => layer.id === beforeId) : style.layers.length;
  style.layers.splice(insertIndex === -1 ? style.layers.length : insertIndex, 0, ...terrainBaseLayers);
  // Append contour labels at the very end so they win collision detection against ORM labels
  style.layers.push(contourLabelLayer);
  return style;
}

function addSatelliteSourceAndLayer(style) {
  style.sources = {
    ...(style.sources || {}),
    satellite: {
      type: 'raster',
      tiles: [SATELLITE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 22,
      attribution: '&copy; Google',
    },
  };

  const insertIdx = style.layers.findIndex((l) => l.id === 'trip-hillshade');
  const satelliteLayer = {
    id: 'satellite-layer',
    type: 'raster',
    source: 'satellite',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 1 },
  };

  if (insertIdx !== -1) {
    style.layers.splice(insertIdx, 0, satelliteLayer);
  } else {
    style.layers.push(satelliteLayer);
  }

  return style;
}

function withGlobalStateVisibility(layer, stateName) {
  const layout = { ...(layer.layout || {}) };
  const originalVisibility = structuredClone(layout.visibility ?? 'visible');
  layout.visibility = ['case', ['global-state', stateName], originalVisibility, 'none'];
  return { ...layer, layout };
}

import { setGlobalStatePropertyWhenReady, runWhenStyleReady } from './style-ready.js';

const STATE_DEFAULTS = {
  date: 2026,
  allDates: false,
  theme: 'light',
  stationLowZoomLabel: 'label',
  openHistoricalMap: true,
  showAbandonedInfrastructure: false,
  showRazedInfrastructure: false,
  showConstructionInfrastructure: true,
  showProposedInfrastructure: true,
  hillshade: false,
  [SHOW_BASE_MAP_STATE]: true,
  electrificationRailwayLine: 'voltageFrequency',
  trackRailwayLine: 'gauge',
};

function mergeBaseAndOrm(baseStyle, ormStyle) {
  const merged = structuredClone(baseStyle);
  const baseLayers = (baseStyle.layers || []).map((layer) => withGlobalStateVisibility(layer, SHOW_BASE_MAP_STATE));
  merged.center = ormStyle.center || merged.center;
  merged.zoom = ormStyle.zoom || merged.zoom;
  merged.glyphs = ormStyle.glyphs || merged.glyphs;
  merged.sprite = ormStyle.sprite || merged.sprite;
  // Set state defaults before the style is applied to avoid initial render flash
  const state = { ...(merged.state || {}), ...(ormStyle.state || {}) };
  for (const [key, value] of Object.entries(STATE_DEFAULTS)) {
    state[key] = {
      ...(state[key] || {}),
      default: value,
    };
  }
  merged.state = state;
  merged.metadata = { ...(merged.metadata || {}), ...(ormStyle.metadata || {}) };
  merged.sources = { ...(merged.sources || {}), ...(ormStyle.sources || {}) };
  merged.layers = [...baseLayers, ...(ormStyle.layers || [])];
  return merged;
}

async function loadStyle(demSource) {
  const [baseStyle, ormStyleRaw] = await Promise.all([
    loadJson(OPENFREEMAP_STYLE),
    loadJson(STYLE_URL),
  ]);
  const merged = mergeBaseAndOrm(baseStyle, rewriteOrmStyle(ormStyleRaw));
  const withTerrain = addMapterhornTerrain(merged, demSource);
  return addSatelliteSourceAndLayer(withTerrain);
}

async function loadSpriteAtlases() {
  const specs = [
    { prefix: '', json: '/orm/sprite/symbols.json', png: '/orm/sprite/symbols.png', sdf: false },
    { prefix: 'sdf:', json: '/orm/sdf_sprite/symbols.json', png: '/orm/sdf_sprite/symbols.png', sdf: true },
  ];
  const atlases = [];
  for (const spec of specs) {
    const [index, image] = await Promise.all([loadJson(spec.json), loadImage(spec.png)]);
    atlases.push({ ...spec, index, image });
  }
  return atlases;
}

function installSpriteFallback(map, atlases) {
  map.on('styleimagemissing', (e) => {
    const id = e.id;
    for (const atlas of atlases) {
      const key = id.startsWith(atlas.prefix) ? id.slice(atlas.prefix.length) : null;
      if (key && atlas.index[key]) {
        const meta = atlas.index[key];
        const canvas = document.createElement('canvas');
        canvas.width = meta.width;
        canvas.height = meta.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(atlas.image, meta.x, meta.y, meta.width, meta.height, 0, 0, meta.width, meta.height);
        const data = ctx.getImageData(0, 0, meta.width, meta.height).data;
        if (!map.hasImage(id)) {
          map.addImage(id, { width: meta.width, height: meta.height, data }, { pixelRatio: meta.pixelRatio || 1, sdf: atlas.sdf });
        }
        return;
      }
    }
  });
}

async function init() {
  try {
    const demSource = new mlcontour.DemSource({
      url: MAPTERHORN_TERRAIN_URL,
      encoding: 'terrarium',
      maxzoom: 17,
      worker: true,
    });
    demSource.setupMaplibre(maplibregl);
    const [style, atlases] = await Promise.all([loadStyle(demSource), loadSpriteAtlases()]);


    window._mlmap = null;
    const map = new maplibregl.Map({
      container: 'map',
      style,
      center: [105, 35],
      zoom: 4,
      hash: true,
      attributionControl: true,
      renderWorldCopies: false,
      maxZoom: 20,
      maxPitch: 85,
    });

    window._mlmap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    const geolocateControl = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    });
    const emitCollaborationLocation = (detail) => {
      map.getContainer().dispatchEvent(new CustomEvent('collaboration:locationchange', { detail }));
    };
    const clearCollaborationLocation = () => emitCollaborationLocation({ enabled: false });
    const clearCollaborationLocationIfOff = () => {
      if (geolocateControl._watchState === 'OFF') clearCollaborationLocation();
    };
    geolocateControl.on('geolocate', (event) => {
      const coords = event?.coords;
      if (!coords) {
        clearCollaborationLocation();
        return;
      }
      emitCollaborationLocation({
        enabled: true,
        lngLat: [coords.longitude, coords.latitude],
        accuracy: coords.accuracy,
        heading: coords.heading,
        speed: coords.speed,
        timestamp: event.timestamp || Date.now(),
      });
    });
    geolocateControl.on('trackuserlocationend', clearCollaborationLocationIfOff);
    geolocateControl.on('error', clearCollaborationLocation);
    geolocateControl.on('outofmaxbounds', clearCollaborationLocation);
    map.addControl(geolocateControl, 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    installPhotonSearch(map, maplibregl);
    installWeatherPointPicker(map, maplibregl);
    installOverlayManager(map);

    installSpriteFallback(map, atlases);

    // Register GPX drag-drop immediately (map container exists now)
    // Don't wait for 'load' — user may drag a file before tiles finish loading
    installGpxDragDrop(map);

    // Load GPX from URL parameters (?gpx=url1&gpx=url2)
    // Compatible with MapLibre's hash-based URL sync (hash and query string are independent)
    const gpxUrls = new URLSearchParams(window.location.search).getAll('gpx');
    if (gpxUrls.length > 0) {
      (async () => {
        let bounds = null;
        await Promise.allSettled(gpxUrls.map(async (gpxUrl) => {
          try {
            const res = await fetchWithSwr(gpxUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const xml = await res.text();
            const stats = await processOrQueueGpx(map, xml, { name: importNameFromUrl(gpxUrl, 'GPX URL') });
            if (stats?.bounds) bounds = mergeBounds(bounds, stats.bounds);
          } catch (err) {
            console.error('Failed to load GPX from URL:', gpxUrl, err);
          }
        }));
        if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      })();
    }

    // Load GeoJSON from URL parameters (?geojson=url1&geojson=url2)
    // Supports both LineString (tracks) and Point (waypoints) features
    const geojsonUrls = new URLSearchParams(window.location.search).getAll('geojson');
    if (geojsonUrls.length > 0) {
      (async () => {
        let bounds = null;
        await Promise.allSettled(geojsonUrls.map(async (geojsonUrl) => {
          try {
            const res = await fetchWithSwr(geojsonUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const result = processOrQueueGeoJson(map, data, { name: importNameFromUrl(geojsonUrl, 'GeoJSON URL') });
            if (result?.bounds) bounds = mergeBounds(bounds, result.bounds);
          } catch (err) {
            console.error('Failed to load GeoJSON from URL:', geojsonUrl, err);
          }
        }));
        if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      })();
    }

    let terrainControl = null;
    let satelliteControl = null;
    const getCollaborationViewState = () => ({
      terrain: Boolean(terrainControl?._enabled),
      satellite: Boolean(satelliteControl?._enabled),
    });
    const emitCollaborationViewState = () => {
      map.getContainer().dispatchEvent(new CustomEvent('collaboration:viewstatechange', {
        detail: getCollaborationViewState(),
      }));
    };

    // Terrain toggle control
    class TerrainToggleControl {
      constructor(onChange) {
        this._onChange = onChange;
      }
      onAdd(map) {
        this._map = map;
        this._enabled = false;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        this._btn = document.createElement('button');
        this._btn.type = 'button';
        this._btn.title = '3D Terrain';
        this._btn.setAttribute('aria-label', '3D Terrain');
        this._btn.className = 'maplibregl-ctrl-terrain';
        this._btn.textContent = '3D';
        this._btn.addEventListener('click', () => this.setEnabled(!this._enabled));
        this._container.appendChild(this._btn);
        return this._container;
      }
      setEnabled(enabled, options = {}) {
        const next = Boolean(enabled);
        if (this._enabled === next) return;
        this._enabled = next;
        runWhenStyleReady(this._map, () => {
          this._map.setTerrain(next ? { source: 'hillshadeSource', exaggeration: 1.0 } : null);
        });
        this._btn?.classList.toggle('maplibregl-ctrl-terrain-enabled', next);
        if (!options.silent) this._onChange?.();
      }
      onRemove() {
        this._container.parentNode?.removeChild(this._container);
        this._map = undefined;
      }
    }
    terrainControl = new TerrainToggleControl(emitCollaborationViewState);
    map.addControl(terrainControl, 'top-right');

    // Satellite imagery toggle control
    class SatelliteToggleControl {
      constructor(onChange) {
        this._onChange = onChange;
      }
      onAdd(map) {
        this._map = map;
        this._enabled = false;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        this._btn = document.createElement('button');
        this._btn.type = 'button';
        this._btn.title = 'Satellite Imagery';
        this._btn.setAttribute('aria-label', 'Satellite Imagery');
        this._btn.className = 'maplibregl-ctrl-satellite';
        this._btn.textContent = 'Sat';
        this._btn.addEventListener('click', () => this._toggle());
        this._container.appendChild(this._btn);
        return this._container;
      }
      _toggle() {
        this.setEnabled(!this._enabled);
      }
      setEnabled(enabled, options = {}) {
        const next = Boolean(enabled);
        if (this._enabled === next) return;
        this._enabled = next;
        if (next) {
          this._enable();
        } else {
          this._disable();
        }
        this._btn?.classList.toggle('maplibregl-ctrl-satellite-enabled', next);
        if (!options.silent) this._onChange?.();
      }
      _enable() {
        runWhenStyleReady(this._map, () => {
          setGlobalStatePropertyWhenReady(this._map, SHOW_BASE_MAP_STATE, false);
          if (this._map.getLayer('satellite-layer')) {
            this._map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
          }
        });
      }
      _disable() {
        runWhenStyleReady(this._map, () => {
          if (this._map.getLayer('satellite-layer')) {
            this._map.setLayoutProperty('satellite-layer', 'visibility', 'none');
          }
          setGlobalStatePropertyWhenReady(this._map, SHOW_BASE_MAP_STATE, true);
        });
      }
      onRemove() {
        this._container.parentNode?.removeChild(this._container);
        this._map = undefined;
      }
    }
    satelliteControl = new SatelliteToggleControl(emitCollaborationViewState);
    map.addControl(satelliteControl, 'top-right');
    map.getCollaborationViewState = getCollaborationViewState;
    map.setCollaborationViewState = (viewState, options = {}) => {
      terrainControl?.setEnabled(Boolean(viewState?.terrain), { silent: true });
      satelliteControl?.setEnabled(Boolean(viewState?.satellite), { silent: true });
      if (!options.silent) emitCollaborationViewState();
    };
    installMapCollaboration(map);

    let didRunMapReadySetup = false;
    const runMapReadySetup = () => {
      if (didRunMapReadySetup) return;
      didRunMapReadySetup = true;
      installOrmPopups(map, maplibregl, featuresCatalog);
      drainGpxQueue(map);
      let resizeFrame = 0;
      const scheduleResize = () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          map.resize();
        });
      };
      const syncFullscreenState = () => {
        const isFullscreen = document.fullscreenElement === map.getContainer() || document.webkitFullscreenElement === map.getContainer();
        document.body.classList.toggle(FULLSCREEN_ACTIVE_CLASS, isFullscreen);
        scheduleResize();
      };
      scheduleResize();
      setTimeout(scheduleResize, 240);
      setTimeout(scheduleResize, 800);
      window.addEventListener('resize', scheduleResize, { passive: true });
      new ResizeObserver(() => scheduleResize()).observe(map.getContainer());
      syncFullscreenState();
      document.addEventListener('fullscreenchange', syncFullscreenState, { passive: true });
      document.addEventListener('webkitfullscreenchange', syncFullscreenState, { passive: true });
    };
    map.on('load', runMapReadySetup);
    if (map.loaded()) runMapReadySetup();

    map.on('error', (e) => console.error('MapLibre error:', e));
  } catch (error) {
    console.error(error);
  }
}

init();
