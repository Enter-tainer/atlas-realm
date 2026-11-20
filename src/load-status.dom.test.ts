// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { installLoadStatus, loadGroups, loadStatusText, type LoadStatusMap } from './load-status.js';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(), 0)));

describe('loadGroups', () => {
  it('splits railway sources from base map ones and drops untimed sources', () => {
    const groups = loadGroups(
      {
        openrailwaymap: { type: 'vector' },
        base: { type: 'vector' },
        annotations: { type: 'geojson' },
        terrain: { type: 'raster-dem' },
        imagery: { type: 'raster' },
      },
      ['openrailwaymap'],
    );
    expect(groups).toEqual({ railways: ['openrailwaymap'], map: ['base', 'imagery'] });
  });

  it('leaves out sources the caller ignores', () => {
    expect(loadGroups({ a: { type: 'vector' }, b: { type: 'vector' } }, [], ['b'])).toEqual({
      railways: [],
      map: ['a'],
    });
  });
});

describe('loadStatusText', () => {
  const status = (railways: [boolean, number | null, number], map: [boolean, number | null, number]) => ({
    railways: { loading: railways[0], pending: railways[1], failed: railways[2] },
    map: { loading: map[0], pending: map[1], failed: map[2] },
  });

  it('counts the tiles left when both groups load', () => {
    expect(loadStatusText(status([true, 4, 0], [true, 3, 0]))).toEqual({
      text: 'Loading map and railways… 7 tiles left',
      failed: false,
    });
  });

  it('says how many failed, before loading', () => {
    expect(loadStatusText(status([true, 4, 0], [true, 0, 2]))).toEqual({
      text: '2 map tiles failed to load',
      failed: true,
    });
    expect(loadStatusText(status([true, 0, 1], [false, 0, 0]))?.text).toBe('1 railway tile failed to load');
    expect(loadStatusText(status([false, 0, 1], [false, 0, 1]))?.text).toBe('2 map and railway tiles failed to load');
  });

  it('hides the chip when nothing is loading or failed', () => {
    expect(loadStatusText(status([false, 0, 0], [false, 0, 0]))).toBeNull();
  });
});

describe('installLoadStatus', () => {
  const fakeMap = (states: string[]) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let loaded = false;
    const setTiles = vi.fn((tiles: string[]) => {
      loaded = false;
      fake.source.tiles = tiles;
      void tiles;
    });
    const fake = {
      source: { type: 'vector', tiles: ['https://map.test/{z}/{x}/{y}.mvt'], setTiles },
      map: {
        getContainer: () => container,
        getSource: (id: string) => (id === 'openrailwaymap' ? fake.source : undefined),
        isSourceLoaded: () => loaded,
        on: () => {},
        style: {
          tileManagers: {
            openrailwaymap: {
              getIds: () => states.map((_, index) => `tile-${index}`),
              getTileByID: (id: string) => ({ state: states[Number(id.slice(5))] }),
            },
          },
        },
      } as unknown as LoadStatusMap,
    };
    return fake;
  };

  it('says which tiles failed and refetches them on Retry', async () => {
    const fake = fakeMap(['errored', 'loaded']);
    const chip = installLoadStatus(fake.map, { openrailwaymap: { type: 'vector' } }, ['openrailwaymap']);
    await nextFrame();

    expect(chip.hidden).toBe(false);
    expect(chip.classList.contains('load-status-failed')).toBe(true);
    expect(chip.querySelector('.load-status-text')?.textContent).toBe('1 railway tile failed to load');
    const retry = chip.querySelector<HTMLButtonElement>('.load-status-retry');
    expect(retry?.hidden).toBe(false);

    retry?.click();
    expect(fake.source.setTiles).toHaveBeenCalledWith(['https://map.test/{z}/{x}/{y}.mvt']);
  });

  it('shows loading while the style is still coming in, after a short delay', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const map = {
      getContainer: () => container,
      getSource: (): undefined => undefined,
      isSourceLoaded: (): boolean => {
        throw new Error('Style is not done loading.');
      },
      on: (): void => {},
      style: {},
    } as unknown as LoadStatusMap;
    const chip = installLoadStatus(map, { openrailwaymap: { type: 'vector' } }, ['openrailwaymap']);
    await nextFrame();
    expect(chip.hidden).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(chip.hidden).toBe(false);
    expect(chip.querySelector('.load-status-text')?.textContent).toBe('Loading railways…');
  });

  it('picks up the sources that come with the style', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const listeners = new Map<string, (event: unknown) => void>();
    let styled = false;
    const map = {
      getContainer: () => container,
      getSource: (id: string): unknown => (styled && id === 'openrailwaymap' ? {} : undefined),
      getStyle: () => (styled ? { sources: { openrailwaymap: { type: 'vector' } } } : undefined),
      isSourceLoaded: (): boolean => false,
      on: (type: string, listener: (event: unknown) => void): void => {
        listeners.set(type, listener);
      },
      style: {},
    } as unknown as LoadStatusMap;
    const chip = installLoadStatus(map, {}, ['openrailwaymap']);
    await nextFrame();
    expect(chip.hidden).toBe(true);

    styled = true;
    listeners.get('style.load')?.({});
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(chip.hidden).toBe(false);
    expect(chip.querySelector('.load-status-text')?.textContent).toBe('Loading railways…');
  });

  it('stays hidden while nothing is loading', async () => {
    const fake = fakeMap(['loaded', 'loaded']);
    const chip = installLoadStatus(fake.map, { openrailwaymap: { type: 'vector' } }, ['openrailwaymap']);
    await nextFrame();
    expect(chip.hidden).toBe(true);
  });
});
