import { describe, it, expect, vi } from 'vitest';
import { runWhenStyleReady, setGlobalStatePropertyWhenReady } from './style-ready.js';

/**
 * Create a mock maplibregl.Map object that supports:
 *  - isStyleLoaded()
 *  - once(event, callback)
 *  - setGlobalStateProperty(name, value)
 *  - _styleEverLoaded (mutable property — the real MapLibre does not provide this)
 */
function createMockMap({ styleLoaded = false } = {}) {
  const listeners = new Map(); // eventName → callback[]

  const mock = {
    _styleLoaded: styleLoaded,
    _styleEverLoaded: undefined,
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

    // Test helpers
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
  it('runs synchronously when style is already loaded (isStyleLoaded=true)', () => {
    const map = createMockMap({ styleLoaded: true });
    const fn = vi.fn();
    runWhenStyleReady(map, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleEverLoaded).toBe(true);
  });

  it('defers to load event when style is not loaded', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn = vi.fn();
    runWhenStyleReady(map, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(map._styleEverLoaded).toBeUndefined();
  });

  it('executes deferred callbacks when load event fires', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn = vi.fn();
    runWhenStyleReady(map, fn);

    map._emit('load');

    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleEverLoaded).toBe(true);
  });

  it('runs synchronously after style has ever been loaded, even if isStyleLoaded() temporarily returns false', () => {
    const map = createMockMap({ styleLoaded: true });
    const fn1 = vi.fn();
    runWhenStyleReady(map, fn1);
    expect(fn1).toHaveBeenCalledOnce();
    expect(map._styleEverLoaded).toBe(true);

    // Now simulate transient isStyleLoaded() → false (the MapLibre bug)
    map._setStyleLoaded(false);

    const fn2 = vi.fn();
    runWhenStyleReady(map, fn2);
    expect(fn2).toHaveBeenCalledOnce(); // runs synchronously despite isStyleLoaded=false
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
    expect(map._styleEverLoaded).toBe(true);
  });

  it('does not double-execute: rapid toggles before load fires', () => {
    const map = createMockMap({ styleLoaded: false });

    const enable = vi.fn();
    const disable = vi.fn();

    runWhenStyleReady(map, enable);
    runWhenStyleReady(map, disable);

    map._emit('load');

    // Both registered, both fire — order is preserved
    expect(enable).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledOnce();
  });

  it('rapid toggles after style was loaded: all run synchronously', () => {
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
  it('sets property synchronously when style is loaded', () => {
    const map = createMockMap({ styleLoaded: true });
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', false);
    expect(map._globalState.showBaseMap).toBe(false);
    expect(map._styleEverLoaded).toBe(true);
  });

  it('sets property after load event when style is not loaded', () => {
    const map = createMockMap({ styleLoaded: false });
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', false);
    expect(map._globalState.showBaseMap).toBeUndefined();

    map._emit('load');
    expect(map._globalState.showBaseMap).toBe(false);
    expect(map._styleEverLoaded).toBe(true);
  });

  it('sets property synchronously after style ever loaded, even if isStyleLoaded() temporarily false', () => {
    const map = createMockMap({ styleLoaded: true });
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', false);
    expect(map._globalState.showBaseMap).toBe(false);

    map._setStyleLoaded(false); // transient bug repro
    setGlobalStatePropertyWhenReady(map, 'showBaseMap', true);
    expect(map._globalState.showBaseMap).toBe(true); // synchronous
  });

  it('handles rapid toggles: final value wins', () => {
    const map = createMockMap({ styleLoaded: true });

    // 10 rapid toggles
    for (let i = 0; i < 10; i++) {
      setGlobalStatePropertyWhenReady(map, 'showBaseMap', i % 2 === 0);
    }

    // Odd count (10) → last is i=9, i%2=1 → false
    expect(map._globalState.showBaseMap).toBe(false);
  });
});
