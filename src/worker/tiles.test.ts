import { describe, expect, it } from 'vitest';
import { archiveVersion, parseTilePath, tileCacheControl } from './tiles.js';

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

  it('parses the version paths', () => {
    expect(parseTilePath('/tiles/openrailwaymap/version')).toEqual({
      ok: true,
      name: 'openrailwaymap',
      tile: null,
      ext: 'version',
    });
  });

  it('rejects unknown paths', () => {
    expect(parseTilePath('/tiles/openrailwaymap/6/56.mvt')).toEqual({ ok: false });
  });
});

describe('archiveVersion', () => {
  it('takes twelve alphanumeric characters out of the ETag', () => {
    expect(archiveVersion('"1a2b3c4d5e6f77889900aabb"')).toBe('1a2b3c4d5e6f');
  });
});

describe('tileCacheControl', () => {
  it('lets browsers keep tiles of the archive asked for for a year', () => {
    expect(tileCacheControl(new URL('https://map.test/tiles/orm/7/113/50.mvt?v=20261111c'), '20261111c')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('keeps tiles asked for under another version for five minutes', () => {
    expect(tileCacheControl(new URL('https://map.test/tiles/orm/7/113/50.mvt?v=20261111c'), '20261116a')).toBe(
      'public, max-age=300',
    );
  });

  it('keeps unversioned tiles to a day', () => {
    expect(tileCacheControl(new URL('https://map.test/tiles/orm/7/113/50.mvt'))).toBe('public, max-age=86400');
  });

  it('still keeps versioned tiles for a year where the archive is unknown', () => {
    expect(tileCacheControl(new URL('https://map.test/tiles/orm/7/113/50.mvt?v=20261111c'))).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});
