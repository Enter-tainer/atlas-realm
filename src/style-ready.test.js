import { describe, it, expect, vi } from 'vitest';
import { runWhenStyleReady, setGlobalStatePropertyWhenReady } from './style-ready.js';

/**
 * Create a mock maplibregl.Map that exercises the style-ready helpers.
 *
 * MapLibre's `isStyleLoaded()` returns false while any tile manager has
 * tiles in 'loading' state — a normal situation after toggling layer
 * visibility kicks off new tile fetches.  The mock's `_setStyleLoaded()`
 * simulates this transient false.
 */
function createMockMap({ styleLoaded = false } = {}) {
  const listeners = new Map();

  const mock = {
    _styleLoaded: styleLoaded,
    _styleInitialized: undefined,
    _globalState: {},

    isStyleLoaded() {
      return this._styleLoaded;
    },
    once(event, callback) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
    },
    setGlobalStateProperty(name, value) {
      this._globalState[name] = value;
    },

    /** Simulate isStyleLoaded() flipping after tile fetches start. */
    _setStyleLoaded(loaded) {
      this._styleLoaded = loaded;
    },
    _emit(event) {
      for (const cb of listeners.get(event) || []) cb();
    },
  };

  return mock;
}

describe('runWhenStyleReady', () => {
  it('runs synchronously when style is loaded', () => {
    const map = createMockMap({ styleLoaded: true });
    const fn = vi.fn();
    runWhenStyleReady(map, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleInitialized).toBe(true);
  });

  it('defers to the load event when style has not loaded yet', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn = vi.fn();
    runWhenStyleReady(map, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(map._styleInitialized).toBeUndefined();
  });

  it('executes deferred callbacks when the load event fires', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn = vi.fn();
    runWhenStyleReady(map, fn);

    map._emit('load');

    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleInitialized).toBe(true);
  });

  it('runs synchronously while tiles are still loading, once the style has been initialised', () => {
    const map = createMockMap({ styleLoaded: true });
    const fn1 = vi.fn();
    runWhenStyleReady(map, fn1);
    expect(fn1).toHaveBeenCalledOnce();
    expect(map._styleInitialized).toBe(true);

    // Simulate isStyleLoaded()→false caused by in-flight tile loads
    // (e.g. satellite visibility toggle triggered tile fetches).
    map._setStyleLoaded(false);

    const fn2 = vi.fn();
    runWhenStyleReady(map, fn2);
    expect(fn2).toHaveBeenCalledOnce(); // synchronous despite tile loading
  });

  it('handles multiple deferred callbacks on the load event', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    runWhenStyleReady(map, fn1);
    runWhenStyleReady(map, fn2);

    map._emit('load');

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
    expect(map._styleInitialized).toBe(true);
  });

  it('preserves callback order for rapid toggles queued before load fires', () => {
    const map = createMockMap({ styleLoaded: false });

    const enable = vi.fn();
    const disable = vi.fn();

    runWhenStyleReady(map, enable);
    runWhenStyleReady(map, disable);

    map._emit('load');

    expect(enable).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledOnce();
  });

  it('rapid toggles after initialisation: all run synchronously', () => {
    const map = createMockMap({ styleLoaded: true });

    const calls = [];
    for (let i = 0; i < 10; i++) {
      runWhenStyleReady(map, () => calls.push(i));
    }

    expect(calls).toHaveLength(10);
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('setGlobalStatePropertyWhenReady', () => {
  it('sets the property synchronously when style is loaded', () => {
    const map = createMockMap({ styleLoaded: true });
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', false);
    expect(map._globalState.showBaseMap).toBe(false);
    expect(map._styleInitialized).toBe(true);
  });

  it('sets the property after the load event when style has not loaded yet', () => {
    const map = createMockMap({ styleLoaded: false });
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', false);
    expect(map._globalState.showBaseMap).toBeUndefined();

    map._emit('load');
    expect(map._globalState.showBaseMap).toBe(false);
    expect(map._styleInitialized).toBe(true);
  });

  it('sets the property synchronously while tiles are still loading, once style has been initialised', () => {
    const map = createMockMap({ styleLoaded: true });
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', false);
    expect(map._globalState.showBaseMap).toBe(false);

    // Simulate isStyleLoaded()→false caused by in-flight tile loads.
    map._setStyleLoaded(false);

    setGlobalStatePropertyWhenReady(map, 'showBaseMap', true);
    expect(map._globalState.showBaseMap).toBe(true);
  });

  it('rapid toggles: last write wins, all applied', () => {
    const map = createMockMap({ styleLoaded: true });

    for (let i = 0; i < 10; i++) {
      setGlobalStatePropertyWhenReady(map, 'showBaseMap', i % 2 === 0);
    }

    // 10 toggles → last is i=9, false
    expect(map._globalState.showBaseMap).toBe(false);
  });
});
