/**
 * Style-ready helpers — safely run callbacks when MapLibre style is loaded.
 *
 * The problem: `map.isStyleLoaded()` can temporarily return `false` *after*
 * the initial load (e.g. during a style mutation triggered by
 * `setGlobalStateProperty`).  The original `runWhenStyleReady` / 
 * `setGlobalStatePropertyWhenReady` used `map.once('load', cb)` to defer,
 * but `'load'` only fires once — so callbacks queued after that were
 * silently dropped.
 *
 * Fix: track `map._styleEverLoaded = true` the first time we observe that
 * the style IS loaded (or when the `'load'` event fires).  After that point
 * every call runs synchronously, even if `isStyleLoaded()` transiently lies.
 */

/**
 * Set a global state property on the map, waiting for the style if needed.
 * Once the style has ever been loaded, always sets synchronously.
 */
export function setGlobalStatePropertyWhenReady(map, propertyName, value) {
  if (map.isStyleLoaded()) {
    map._styleEverLoaded = true;
    map.setGlobalStateProperty(propertyName, value);
    return;
  }
  if (map._styleEverLoaded) {
    map.setGlobalStateProperty(propertyName, value);
    return;
  }
  map.once('load', () => {
    map._styleEverLoaded = true;
    map.setGlobalStateProperty(propertyName, value);
  });
}

/**
 * Run a callback when the map style is ready.
 * Once the style has ever been loaded, always runs synchronously.
 */
export function runWhenStyleReady(map, callback) {
  if (map.isStyleLoaded()) {
    map._styleEverLoaded = true;
    callback();
    return;
  }
  if (map._styleEverLoaded) {
    callback();
    return;
  }
  map.once('load', () => {
    map._styleEverLoaded = true;
    callback();
  });
}
