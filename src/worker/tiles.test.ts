import { describe, expect, it } from 'vitest';
import { acceptsGzip, parseTilePath } from './tiles.js';

describe('acceptsGzip', () => {
  it('detects a plain gzip accept-encoding', () => {
    expect(acceptsGzip('gzip')).toBe(true);
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1.0, GZIP;q=0.9')).toBe(true);
  });

  it('rejects missing or non-gzip encodings', () => {
    expect(acceptsGzip(null)).toBe(false);
    expect(acceptsGzip('')).toBe(false);
    expect(acceptsGzip('br, zstd')).toBe(false);
  });
});

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
