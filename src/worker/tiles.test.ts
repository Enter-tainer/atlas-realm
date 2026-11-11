import { describe, expect, it } from 'vitest';
import { parseTilePath } from './tiles.js';

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
