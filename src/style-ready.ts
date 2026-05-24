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
  _styleInitialized?: boolean;
  isStyleLoaded(): boolean | void;
  setGlobalStateProperty(propertyName: string, value: unknown): void;
  once(event: 'load', callback: () => void): void;
};

/**
 * Set a global state property on the map.
 * Once the style has been initialised, always sets synchronously.
 */
export function setGlobalStatePropertyWhenReady(
  map: StyleReadyMap,
  propertyName: string,
  value: unknown,
) {
  if (map.isStyleLoaded()) {
    map._styleInitialized = true;
    map.setGlobalStateProperty(propertyName, value);
    return;
  }
  if (map._styleInitialized) {
    map.setGlobalStateProperty(propertyName, value);
    return;
  }
  map.once('load', () => {
    map._styleInitialized = true;
    map.setGlobalStateProperty(propertyName, value);
  });
}

/**
 * Run a callback once the style infrastructure is ready.
 * After the first load, runs synchronously (tile loading state ignored).
 */
export function runWhenStyleReady(map: StyleReadyMap, callback: () => void) {
  if (map.isStyleLoaded()) {
    map._styleInitialized = true;
    callback();
    return;
  }
  if (map._styleInitialized) {
    callback();
    return;
  }
  map.once('load', () => {
    map._styleInitialized = true;
    callback();
  });
}
