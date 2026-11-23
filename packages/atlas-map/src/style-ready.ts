/**
 * Style-ready helpers — safely run map API calls once the style
 * infrastructure (layers, sources, sprite) is initialised.
 *
 * MapLibre's `map.isStyleLoaded()` delegates to `Style.loaded()` which
 * checks three things:
 *   1. `this._loaded`        — style JSON parsed & layers created
 *   2. `this._updatedSources` — any source reloads pending
 *   3. every TileManager's `loaded()` — all in-view tiles finished loading
 *
 * Check (3) is too strict for our purposes.  `setLayoutProperty` and
 * `setGlobalStateProperty` do not depend on tile state — they only need
 * the style infrastructure (layers, sources, sprite) to be ready, which
 * is guaranteed once the initial `'load'` event has fired.
 *
 * Trigger (classic reproduction of the Sat/3D toggle bug):
 *   setLayoutProperty('satellite-layer', 'visibility', 'visible')
 *     → MapLibre starts fetching raster tiles
 *       → tile.state = 'loading'
 *         → TileManager.loaded() returns false (check 3)
 *           → Style.loaded() returns false
 *             → map.isStyleLoaded() returns false
 *
 * If the user clicks again while tiles are in-flight, the old helper
 * would defer the callback onto `map.once('load', cb)` — but `'load'`
 * fires only once, so the callback is silently dropped.
 *
 * Solution: track `map._styleInitialized = true` after the first load.
 * After that every call runs synchronously, because the style
 * infrastructure is already set up and none of our API calls need tiles.
 *
 * KNOWN LIMITATION: if someone calls `map.setStyle()` to load a
 * different style, `_styleInitialized` is NOT reset.  Calls during the
 * new style's loading phase may fail.  This application does not use
 * `setStyle()`.
 */

type StyleReadyMap = {
  _loaded?: boolean;
  _styleInitialized?: boolean;
  _styleInfrastructureInitialized?: boolean;
  _styleReadyLoadMarkerInstalled?: boolean;
  style?: { _loaded?: boolean };
  isStyleLoaded(): boolean | void;
  setGlobalStateProperty(propertyName: string, value: unknown): void;
  once(event: 'load' | 'style.load', callback: () => void): void;
  on?(event: 'load' | 'style.load', callback: () => void): void;
  off?(event: 'load' | 'style.load', callback: () => void): void;
};

function isFullStyleReady(map: StyleReadyMap) {
  return Boolean(map._styleInitialized || map._loaded || map.isStyleLoaded());
}

function isStyleInfrastructureReady(map: StyleReadyMap) {
  return Boolean(map._styleInfrastructureInitialized || isFullStyleReady(map) || map.style?._loaded);
}

function markStyleReady(map: StyleReadyMap) {
  map._styleInitialized = true;
  map._styleInfrastructureInitialized = true;
}

function markStyleInfrastructureReady(map: StyleReadyMap) {
  map._styleInfrastructureInitialized = true;
}

function ensureStyleReadyLoadMarker(map: StyleReadyMap) {
  if (isFullStyleReady(map)) {
    markStyleReady(map);
    return;
  }
  if (map._styleReadyLoadMarkerInstalled) return;
  map._styleReadyLoadMarkerInstalled = true;
  map.once('load', () => {
    markStyleReady(map);
  });
}

function runWhenFullStyleReady(map: StyleReadyMap, callback: () => void) {
  if (isFullStyleReady(map)) {
    markStyleReady(map);
    callback();
    return;
  }
  map.once('load', () => {
    markStyleReady(map);
    callback();
  });
}

/**
 * Set a global state property on the map.
 * Once the style has been initialised, always sets synchronously.
 */
export function setGlobalStatePropertyWhenReady(map: StyleReadyMap, propertyName: string, value: unknown) {
  runWhenFullStyleReady(map, () => {
    map.setGlobalStateProperty(propertyName, value);
  });
}

/**
 * Run a callback once the style infrastructure is ready.
 * After the first load, runs synchronously (tile loading state ignored).
 */
export function runWhenStyleReady(map: StyleReadyMap, callback: () => void) {
  runWhenFullStyleReady(map, callback);
}

/**
 * Run a callback once source/layer APIs are safe to use.
 *
 * MapLibre's `'style.load'` fires after style JSON has been parsed and
 * style layers/sources exist, while the later map `'load'` event waits
 * for all required tiles and images. Annotation sources and draft layers
 * only need the earlier infrastructure point.
 */
export function runWhenStyleInfrastructureReady(map: StyleReadyMap, callback: () => void) {
  if (isFullStyleReady(map)) {
    markStyleReady(map);
    callback();
    return;
  }

  if (isStyleInfrastructureReady(map)) {
    ensureStyleReadyLoadMarker(map);
    markStyleInfrastructureReady(map);
    callback();
    return;
  }

  ensureStyleReadyLoadMarker(map);
  let didRun = false;
  const run = (markFullStyleReady: boolean) => {
    if (didRun) return;
    didRun = true;
    map.off?.('style.load', runFromStyleLoad);
    map.off?.('load', runFromLoad);
    if (markFullStyleReady) {
      markStyleReady(map);
    } else {
      markStyleInfrastructureReady(map);
    }
    callback();
  };
  const runFromStyleLoad = () => run(false);
  const runFromLoad = () => run(true);

  if (map.on) {
    map.on('style.load', runFromStyleLoad);
    map.on('load', runFromLoad);
    return;
  }

  map.once('style.load', runFromStyleLoad);
  map.once('load', runFromLoad);
}
