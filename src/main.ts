import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import createIconElement from 'lucide/dist/esm/createElement.mjs';
import SatelliteIcon from 'lucide/dist/esm/icons/satellite.mjs';
import { installGpxDragDrop, drainGpxQueue, processOrQueueGpx, processOrQueueGeoJson, mergeBounds } from './gpx.js';
import { installOrmPopups, buildFeatureCatalog } from './popup.js';
import { installPhotonSearch } from './search.js';
import { installMapCollaboration } from './collaboration.js';
import { installWeatherPointPicker } from './weather.js';
import { installLayerManager } from './layer-manager.js';
import { installOsrmRouting } from './routing.js';
import { setGlobalStatePropertyWhenReady, runWhenStyleInfrastructureReady } from './style-ready.js';
import {
  ORM_SOURCE,
  SHOW_BASE_MAP_STATE,
  TerrainToggleControl,
  addMapterhornTerrain,
  addSatelliteSourceAndLayer,
  installSpriteFallback,
  mergeBaseAndOrm,
  rewriteOrmStyle,
  setupMapterhornDem,
  type DemSourceLike,
  type StyleLike,
} from '../packages/atlas-map/src/compose.js';
import { LayerStore } from './layer-store.js';
import { installAnnotationRenderer } from './annotation-renderer.js';
import { installAnnotationTools } from './annotation-tools.js';
import type * as ScreenshotFixtureModule from './screenshot-fixture.js';
import { installLoadStatus, type LoadStatusMap } from './load-status.js';

const LOCAL_ORM_PREFIX = '/orm';
const STYLE_URL = `${LOCAL_ORM_PREFIX}/style/standard.json?v=${__STYLE_HASH__}`;
// Optional ?tileset=<archive-name> override to point at a test tileset
// (e.g. openrailwaymap-test-<run_id>), defaulting to the production archive.
const TILE_ARCHIVE = new URLSearchParams(window.location.search).get('tileset') ?? 'openrailwaymap';
// The tile URL carries the archive's version, which the Worker tells
// (/tiles/<archive>/version), so a new archive shows on the next load and its
// tiles can still be cached for good. Without an answer the URL has no version,
// and tiles are cached for a day.
const TILE_URL = fetch(`/tiles/${TILE_ARCHIVE}/version`)
  .then((res): Promise<{ version?: string }> | { version?: string } => (res.ok ? res.json() : {}))
  .catch((): { version?: string } => ({}))
  .then(({ version }) => {
    const query = version ? `?v=${encodeURIComponent(version)}` : '';
    return `${window.location.origin}/tiles/${TILE_ARCHIVE}/{z}/{x}/{y}.mvt${query}`;
  });
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const FULLSCREEN_ACTIVE_CLASS = 'route-map-fullscreen-active';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="map"></div>
`;

const featuresCatalog = buildFeatureCatalog();
const layerStore = new LayerStore();

type MapLibreErrorEvent = ErrorEvent & {
  error?: unknown;
  sourceId?: string;
  tile?: unknown;
};
type Bounds = [[number, number], [number, number]];
type SwrCacheEntry = { response: Response; timestamp: number };
type CollaborationLocationDetail = {
  enabled: boolean;
  lngLat?: [number, number];
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  timestamp?: number;
};
type ToggleOptions = { silent?: boolean };
type CollaborationViewState = { terrain?: boolean; satellite?: boolean };
type MapWithCollaboration = maplibregl.Map & {
  getCollaborationViewState?: () => { terrain: boolean; satellite: boolean };
  setCollaborationViewState?: (viewState: CollaborationViewState, options?: ToggleOptions) => void;
};
type GeolocateControlWithState = maplibregl.GeolocateControl & {
  _watchState?: 'OFF' | string;
};
type GeolocateControlOptionsWithHeading = maplibregl.GeolocateControlOptions & {
  showUserHeading?: boolean;
};
type ToggleControl = maplibregl.IControl & {
  _enabled: boolean;
  setEnabled(enabled: boolean, options?: ToggleOptions): void;
};
type ScreenshotFixture = typeof ScreenshotFixtureModule;

async function loadScreenshotFixture() {
  if (!__SCREENSHOT_FIXTURES__) return null;
  return (await import('./screenshot-fixture.js')) as ScreenshotFixture;
}

function importNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === 'data:') return fallback;
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || fallback;
  } catch {
    return fallback;
  }
}

async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.json()) as T;
}

function appendIcon(parent: Element, icon: LucideIcon, className = 'satellite-icon') {
  const svg = createIconElement(icon, {
    class: className,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  parent.appendChild(svg);
  return svg;
}

/**
 * Fetch with stale-while-revalidate caching.
 * Serves cached responses instantly while revalidating in the background.
 */
const swrCache = new Map<string, SwrCacheEntry>();
async function fetchWithSwr(url: string, ttlMs = 3600_000) {
  const cached = swrCache.get(url);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    // Still fresh — return directly
    return cached.response.clone();
  }
  if (cached) {
    // Stale — return cached version, revalidate in background
    fetch(url)
      .then((res) => {
        if (res.ok) swrCache.set(url, { response: res, timestamp: Date.now() });
      })
      .catch(() => {});
    return cached.response.clone();
  }
  // No cache — fetch and store
  const res = await fetch(url);
  if (res.ok) swrCache.set(url, { response: res.clone(), timestamp: Date.now() });
  return res;
}

function isMapResourceLoadError(event: MapLibreErrorEvent): boolean {
  const message = event.error instanceof Error ? event.error.message : String(event.error || '');
  return Boolean(event.sourceId || event.tile || /(?:tile|glyph|sprite|image|resource|fetch|load)/i.test(message));
}

function installMapLibreErrorLogging(map: maplibregl.Map) {
  map.on('error', (event: MapLibreErrorEvent) => {
    if (isMapResourceLoadError(event)) {
      console.debug('MapLibre resource load skipped:', event);
      return;
    }
    console.error('MapLibre error:', event);
  });
}

async function loadStyle(demSource: DemSourceLike): Promise<StyleLike> {
  const [baseStyle, ormStyleRaw, tileUrl] = await Promise.all([
    loadJson<StyleLike>(OPENFREEMAP_STYLE),
    loadJson<StyleLike>(STYLE_URL),
    TILE_URL,
  ]);
  const merged = mergeBaseAndOrm(baseStyle, rewriteOrmStyle(ormStyleRaw, tileUrl));
  const withTerrain = addMapterhornTerrain(merged, demSource);
  return addSatelliteSourceAndLayer(withTerrain);
}

async function init() {
  try {
    const screenshotFixtureModule = await loadScreenshotFixture();
    const screenshotFixtureMode = screenshotFixtureModule?.getScreenshotFixtureMode() ?? null;
    const screenshotFixtureView =
      screenshotFixtureModule && screenshotFixtureMode
        ? screenshotFixtureModule.getScreenshotFixtureView(screenshotFixtureMode)
        : null;
    const screenshotFixture =
      screenshotFixtureModule && screenshotFixtureMode
        ? screenshotFixtureModule.createScreenshotCollaborationFixture(screenshotFixtureMode)
        : null;
    const demSource = setupMapterhornDem(maplibregl);
    const style = await loadStyle(demSource);

    window._mlmap = null;
    const map = new maplibregl.Map({
      container: 'map',
      style: style as maplibregl.StyleSpecification,
      center: screenshotFixtureView ? screenshotFixtureView.center : [105, 35],
      zoom: screenshotFixtureView ? screenshotFixtureView.zoom : 4,
      hash: true,
      attributionControl: {} as maplibregl.AttributionControlOptions,
      renderWorldCopies: false,
      maxZoom: 20,
      maxPitch: 85,
    });

    window._mlmap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    installLoadStatus(map as unknown as LoadStatusMap, (style.sources ?? {}) as Record<string, { type?: unknown }>, [
      ORM_SOURCE,
    ]);
    const geolocateOptions: GeolocateControlOptionsWithHeading = {
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    };
    const geolocateControl = new maplibregl.GeolocateControl(geolocateOptions);
    const emitCollaborationLocation = (detail: CollaborationLocationDetail) => {
      map.getContainer().dispatchEvent(new CustomEvent('collaboration:locationchange', { detail }));
    };
    const clearCollaborationLocation = () => emitCollaborationLocation({ enabled: false });
    const clearCollaborationLocationIfOff = () => {
      if ((geolocateControl as GeolocateControlWithState)._watchState === 'OFF') clearCollaborationLocation();
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
    installOsrmRouting(map, maplibregl);
    if (screenshotFixtureModule && screenshotFixtureMode) {
      screenshotFixtureModule.installScreenshotFixtureData(layerStore, screenshotFixtureMode);
    }
    installAnnotationRenderer(map, layerStore);
    installAnnotationTools(map, layerStore);
    installLayerManager(map, layerStore);
    if (screenshotFixtureModule && screenshotFixtureMode) {
      screenshotFixtureModule.installScreenshotFixtureMapLayers(map, screenshotFixtureMode);
    }

    installSpriteFallback(map);

    // Register GPX drag-drop immediately (map container exists now)
    // Don't wait for 'load' — user may drag a file before tiles finish loading
    installGpxDragDrop(map);

    // Load GPX from URL parameters (?gpx=url1&gpx=url2)
    // Compatible with MapLibre's hash-based URL sync (hash and query string are independent)
    const gpxUrls = screenshotFixtureMode ? [] : new URLSearchParams(window.location.search).getAll('gpx');
    if (gpxUrls.length > 0) {
      (async () => {
        let bounds: Bounds | null = null;
        await Promise.allSettled(
          gpxUrls.map(async (gpxUrl) => {
            try {
              const res = await fetchWithSwr(gpxUrl);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const xml = await res.text();
              const stats = await processOrQueueGpx(map, xml, { name: importNameFromUrl(gpxUrl, 'GPX URL') });
              if (stats?.bounds) bounds = mergeBounds(bounds, stats.bounds);
            } catch (err) {
              console.error('Failed to load GPX from URL:', gpxUrl, err);
            }
          }),
        );
        if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      })();
    }

    // Load GeoJSON from URL parameters (?geojson=url1&geojson=url2)
    // Supports both LineString (tracks) and Point (waypoints) features
    const geojsonUrls = screenshotFixtureMode ? [] : new URLSearchParams(window.location.search).getAll('geojson');
    if (geojsonUrls.length > 0) {
      (async () => {
        let bounds: Bounds | null = null;
        await Promise.allSettled(
          geojsonUrls.map(async (geojsonUrl) => {
            try {
              const res = await fetchWithSwr(geojsonUrl);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              const result = processOrQueueGeoJson(map, data, { name: importNameFromUrl(geojsonUrl, 'GeoJSON URL') });
              if (result?.bounds) bounds = mergeBounds(bounds, result.bounds);
            } catch (err) {
              console.error('Failed to load GeoJSON from URL:', geojsonUrl, err);
            }
          }),
        );
        if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      })();
    }

    let terrainControl: ToggleControl | null = null;
    let satelliteControl: ToggleControl | null = null;
    const getCollaborationViewState = () => ({
      terrain: Boolean(terrainControl?._enabled),
      satellite: Boolean(satelliteControl?._enabled),
    });
    const emitCollaborationViewState = () => {
      map.getContainer().dispatchEvent(
        new CustomEvent('collaboration:viewstatechange', {
          detail: getCollaborationViewState(),
        }),
      );
    };

    terrainControl = new TerrainToggleControl(() => emitCollaborationViewState()) as unknown as ToggleControl;
    map.addControl(terrainControl, 'top-right');

    // Satellite imagery toggle control
    class SatelliteToggleControl {
      _onChange: () => void;
      _map?: maplibregl.Map;
      _enabled = false;
      _container?: HTMLElement;
      _btn?: HTMLButtonElement;

      constructor(onChange: () => void) {
        this._onChange = onChange;
      }
      onAdd(map: maplibregl.Map) {
        this._map = map;
        this._enabled = false;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        this._btn = document.createElement('button');
        this._btn.type = 'button';
        this._btn.title = 'Satellite Imagery';
        this._btn.setAttribute('aria-label', 'Satellite Imagery');
        this._btn.className = 'maplibregl-ctrl-satellite';
        appendIcon(this._btn, SatelliteIcon);
        this._btn.addEventListener('click', () => this._toggle());
        this._container.appendChild(this._btn);
        return this._container;
      }
      _toggle() {
        this.setEnabled(!this._enabled);
      }
      setEnabled(enabled: boolean, options: ToggleOptions = {}) {
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
        runWhenStyleInfrastructureReady(this._map, () => {
          setGlobalStatePropertyWhenReady(this._map, SHOW_BASE_MAP_STATE, false);
          if (this._map.getLayer('satellite-layer')) {
            this._map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
          }
        });
      }
      _disable() {
        runWhenStyleInfrastructureReady(this._map, () => {
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

    // GitHub link control
    class GitHubControl {
      _container?: HTMLElement;

      onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'GitHub';
        btn.setAttribute('aria-label', 'GitHub');
        btn.className = 'maplibregl-ctrl-github';
        btn.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
        btn.addEventListener('click', () => {
          window.open('https://github.com/Enter-tainer/orm-pmtiles-demo', '_blank', 'noopener');
        });
        this._container.appendChild(btn);
        return this._container;
      }
      onRemove() {
        this._container?.parentNode?.removeChild(this._container);
        this._container = undefined;
      }
    }
    map.addControl(new GitHubControl(), 'top-right');

    const mapWithCollaboration = map as MapWithCollaboration;
    mapWithCollaboration.getCollaborationViewState = getCollaborationViewState;
    mapWithCollaboration.setCollaborationViewState = (viewState, options: ToggleOptions = {}) => {
      terrainControl?.setEnabled(Boolean(viewState?.terrain), { silent: true });
      satelliteControl?.setEnabled(Boolean(viewState?.satellite), { silent: true });
      if (!options.silent) emitCollaborationViewState();
    };
    installMapCollaboration(map, layerStore, { fixture: screenshotFixture });
    if (screenshotFixtureModule && screenshotFixtureMode) {
      screenshotFixtureModule.applyScreenshotFixtureScene(screenshotFixtureMode, map);
    }

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
        const isFullscreen =
          document.fullscreenElement === map.getContainer() || document.webkitFullscreenElement === map.getContainer();
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
    // 'load' waits for every in-view tile and can be delayed indefinitely — or
    // never fire — which would strand the deferred GPX/GeoJSON queue and leave
    // popups uninstalled. A parsed style is enough for everything set up here.
    else runWhenStyleInfrastructureReady(map, runMapReadySetup);

    installMapLibreErrorLogging(map);
  } catch (error) {
    console.error(error);
  }
}

init();
