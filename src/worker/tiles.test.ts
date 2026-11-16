import { describe, expect, it } from 'vitest';
import { parseTilePath, tileCacheControl } from './tiles.js';

describe('parseTilePath', () => {
  it('parses tile paths with an archive name', () => {
    expect(parseTilePath('/tiles/openrailwaymap/6/56/25.mvt')).toEqual({
      ok: true,
      name: 'openrailwaymap',
      tile: [6, 56, 25],
      ext: 'mvt',
    });
  });

  it('parses tilejson paths', () => {
    expect(parseTilePath('/tiles/openrailwaymap-test-123.json')).toEqual({
      ok: true,
      name: 'openrailwaymap-test-123',
      tile: null,
      ext: 'json',
    });
  });

  it('rejects unknown paths', () => {
    expect(parseTilePath('/tiles/openrailwaymap/6/56.mvt')).toEqual({ ok: false });
  });
});

describe('tileCacheControl', () => {
  it('lets browsers keep versioned tiles for a year', () => {
    expect(tileCacheControl(new URL('https://map.test/tiles/orm/7/113/50.mvt?v=20261111c'))).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('keeps unversioned tiles to a day', () => {
    expect(tileCacheControl(new URL('https://map.test/tiles/orm/7/113/50.mvt'))).toBe('public, max-age=86400');
  });
});
