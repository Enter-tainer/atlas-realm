import { describe, it, expect, vi } from 'vitest';
import { runWhenStyleInfrastructureReady, runWhenStyleReady, setGlobalStatePropertyWhenReady } from './style-ready.js';

type MockStyleMap = {
  _loaded?: boolean;
  _styleLoaded: boolean;
  _styleInitialized?: boolean;
  _styleInfrastructureInitialized?: boolean;
  _styleReadyLoadMarkerInstalled?: boolean;
  style: { _loaded?: boolean };
  _globalState: Record<string, unknown>;
  isStyleLoaded(): boolean;
  once(event: string, callback: () => void): void;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  setGlobalStateProperty(name: string, value: unknown): void;
  _setStyleLoaded(loaded: boolean): void;
  _setMapLoaded(loaded: boolean): void;
  _setStyleInfrastructureLoaded(loaded: boolean): void;
  _emit(event: string): void;
  _listenerCount(event: string): number;
};

/**
 * Create a mock maplibregl.Map that exercises the style-ready helpers.
 *
 * MapLibre's `isStyleLoaded()` returns false while any tile manager has
 * tiles in 'loading' state — a normal situation after toggling layer
 * visibility kicks off new tile fetches.  The mock's `_setStyleLoaded()`
 * simulates this transient false.
 */
function createMockMap({ styleLoaded = false }: { styleLoaded?: boolean } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const addListener = (event: string, callback: () => void) => {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event)?.push(callback);
  };
  const removeListener = (event: string, callback: () => void) => {
    listeners.set(
      event,
      (listeners.get(event) || []).filter((item) => item !== callback),
    );
  };

  const mock: MockStyleMap = {
    _styleLoaded: styleLoaded,
    _loaded: false,
    _styleInitialized: undefined,
    _styleInfrastructureInitialized: undefined,
    _styleReadyLoadMarkerInstalled: undefined,
    style: { _loaded: styleLoaded },
    _globalState: {} as Record<string, unknown>,

    isStyleLoaded() {
      return this._styleLoaded;
    },
    once(event: string, callback: () => void) {
      const onceCallback = () => {
        removeListener(event, onceCallback);
        callback();
      };
      addListener(event, onceCallback);
    },
    on(event: string, callback: () => void) {
      addListener(event, callback);
    },
    off(event: string, callback: () => void) {
      removeListener(event, callback);
    },
    setGlobalStateProperty(name: string, value: unknown) {
      this._globalState[name] = value;
    },

    /** Simulate isStyleLoaded() flipping after tile fetches start. */
    _setStyleLoaded(loaded: boolean) {
      this._styleLoaded = loaded;
    },
    _setMapLoaded(loaded: boolean) {
      this._loaded = loaded;
    },
    _setStyleInfrastructureLoaded(loaded: boolean) {
      this.style._loaded = loaded;
    },
    _emit(event: string) {
      if (event === 'load') this._loaded = true;
      for (const cb of [...(listeners.get(event) || [])]) cb();
    },
    _listenerCount(event: string) {
      return listeners.get(event)?.length || 0;
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

  it('runs synchronously after the map load event even if tiles later make isStyleLoaded false', () => {
    const map = createMockMap({ styleLoaded: false });
    map._setMapLoaded(true);

    const fn = vi.fn();
    runWhenStyleReady(map, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleInitialized).toBe(true);
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

    const calls: number[] = [];
    for (let i = 0; i < 10; i++) {
      runWhenStyleReady(map, () => calls.push(i));
    }

    expect(calls).toHaveLength(10);
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('runWhenStyleInfrastructureReady', () => {
  it('runs synchronously when the full style is loaded', () => {
    const map = createMockMap({ styleLoaded: true });
    const fn = vi.fn();
    runWhenStyleInfrastructureReady(map, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleInfrastructureInitialized).toBe(true);
  });

  it('runs synchronously when style infrastructure has loaded but tiles are still loading', () => {
    const map = createMockMap({ styleLoaded: false });
    map._setStyleInfrastructureLoaded(true);
    const fn = vi.fn();

    runWhenStyleInfrastructureReady(map, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleInfrastructureInitialized).toBe(true);
    expect(map._styleInitialized).toBeUndefined();
  });

  it('keeps a full load marker when it runs early on style infrastructure', () => {
    const map = createMockMap({ styleLoaded: false });
    map._setStyleInfrastructureLoaded(true);
    const fn = vi.fn();

    runWhenStyleInfrastructureReady(map, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleReadyLoadMarkerInstalled).toBe(true);

    map._emit('load');
    expect(map._styleInitialized).toBe(true);
  });

  it('fires on style.load before the map load event', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn = vi.fn();
    runWhenStyleInfrastructureReady(map, fn);

    expect(fn).not.toHaveBeenCalled();
    map._emit('style.load');

    expect(fn).toHaveBeenCalledOnce();
    expect(map._styleInfrastructureInitialized).toBe(true);
    expect(map._styleInitialized).toBeUndefined();
  });

  it('cleans up paired style.load and load listeners after the first event', () => {
    const map = createMockMap({ styleLoaded: false });
    const fn = vi.fn();

    runWhenStyleInfrastructureReady(map, fn);
    expect(map._listenerCount('style.load')).toBe(1);
    expect(map._listenerCount('load')).toBe(2);

    map._emit('style.load');

    expect(fn).toHaveBeenCalledOnce();
    expect(map._listenerCount('style.load')).toBe(0);
    expect(map._listenerCount('load')).toBe(1);

    map._emit('load');
    expect(map._listenerCount('load')).toBe(0);
    expect(map._styleInitialized).toBe(true);
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
