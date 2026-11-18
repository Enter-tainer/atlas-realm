import { EtagMismatch, PMTiles, ResolvedValueCache, type RangeResponse, type Source, TileType } from 'pmtiles';

const TILE_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\/(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+)\.(?<ext>[a-z]+)$/;
const TILEJSON_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\.json$/;
const VERSION_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\/version$/;

type TileRequestPath =
  | { ok: true; name: string; tile: [number, number, number]; ext: string }
  | { ok: true; name: string; tile: null; ext: 'json' | 'version' }
  | { ok: false };

// The map's tile URLs carry the archive version (?v=, which main.ts asks
// /tiles/<archive>/version for), which changes with every new archive, so a
// tile of the version asked for, empty or not, never changes: browsers keep it
// for a year and ask the Worker only for tiles they have not seen.
// Unversioned requests may outlive an archive, so a day. So may a page opened
// before an archive was replaced, which still asks for the old version: the
// archive has its new tiles only, so those answers are not kept long either,
// or a browser would hold a new tile under the old version for good.
export function tileCacheControl(url: URL, current?: string) {
  const asked = url.searchParams.get('v');
  if (asked === null) return 'public, max-age=86400';
  if (current !== undefined && asked !== current) return 'public, max-age=300';
  return 'public, max-age=31536000, immutable';
}

export function parseTilePath(pathname: string): TileRequestPath {
  const tileMatch = pathname.match(TILE_RE);
  if (tileMatch?.groups) {
    const { name, z, x, y, ext } = tileMatch.groups;
    return { ok: true, name, tile: [+z, +x, +y], ext };
  }
  const versionMatch = pathname.match(VERSION_RE);
  if (versionMatch?.groups) {
    return { ok: true, name: versionMatch.groups.name, tile: null, ext: 'version' };
  }
  const jsonMatch = pathname.match(TILEJSON_RE);
  if (jsonMatch?.groups) {
    return { ok: true, name: jsonMatch.groups.name, tile: null, ext: 'json' };
  }
  return { ok: false };
}

// An archive's version is the start of its R2 ETag: a new upload, a new
// version, with nothing to bump by hand.
export function archiveVersion(etag: string) {
  return etag.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12);
}

// The version of the archive in the bucket now. Answered fresh (a minute in
// browsers, never from the Worker's cache), so the map picks up a new archive
// on its next load.
async function versionResponse(env: Cloudflare.Env, name: string) {
  const object = await env.ORM_BUCKET.head(`${name}.pmtiles`);
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (!object) return new Response(JSON.stringify({ error: 'no such archive' }), { status: 404, headers });
  return new Response(
    JSON.stringify({ version: archiveVersion(object.etag), uploaded: object.uploaded.toISOString() }),
    { headers: { ...headers, 'Cache-Control': 'public, max-age=60' } },
  );
}

export async function nativeDecompress(buf: ArrayBuffer, compression: number): Promise<ArrayBuffer> {
  if (compression === 0 /* None */ || compression === 3 /* Unknown */) {
    return buf;
  }
  if (compression === 2 /* Gzip */) {
    const stream = new Response(buf).body;
    if (!stream) throw new Error('Unable to read gzip stream');
    const result = stream.pipeThrough(new DecompressionStream('gzip'));
    return new Response(result).arrayBuffer();
  }
  throw new Error('Compression method not supported');
}

class R2Source implements Source {
  env: Cloudflare.Env;
  archiveName: string;

  constructor(env: Cloudflare.Env, archiveName: string) {
    this.env = env;
    this.archiveName = archiveName;
  }

  getKey(): string {
    return this.archiveName;
  }

  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const key = `${this.archiveName}.pmtiles`;
    const resp = await this.env.ORM_BUCKET.get(key, {
      range: { offset, length },
      onlyIf: etag ? { etagMatches: etag } : undefined,
    });
    if (!resp) {
      throw new Error('Archive not found: ' + key);
    }
    if (!('body' in resp) || !resp.body || !('arrayBuffer' in resp)) {
      // The archive was replaced since its header was cached. PMTiles catches
      // this error type, drops the cached header and retries once.
      throw new EtagMismatch(`Archive changed: ${key}`);
    }
    const a = await resp.arrayBuffer();
    return {
      data: a,
      etag: resp.etag,
      cacheControl: resp.httpMetadata?.cacheControl,
      expires: resp.httpMetadata?.cacheExpiry?.toISOString(),
    };
  }
}

const CACHE = new ResolvedValueCache(25, undefined, nativeDecompress);

// Tiles stay gzip-compressed and go out with Content-Encoding: gzip; low-zoom
// railway tiles are several MB compressed and 3-5x that raw. The cache above
// still decompresses directories, which the reader needs.
async function keepGzipTiles(buf: ArrayBuffer, compression: number): Promise<ArrayBuffer> {
  return compression === 2 /* Gzip */ ? buf : nativeDecompress(buf, compression);
}

const CONTENT_TYPES: Partial<Record<TileType, string>> = {
  [TileType.Mvt]: 'application/x-protobuf',
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
  [TileType.Webp]: 'image/webp',
};

// The runtime gzips bodies of responses that carry Content-Encoding unless they
// are built with encodeBody: 'manual', and neither clone() nor cache.match()
// keeps that flag. Cached gzip tiles therefore go into the cache as freshly
// built manual responses and come out rewrapped the same way; otherwise they are
// stored and sent gzipped twice, and browsers, which undo one layer, cannot
// parse them.
function gzipTileResponse(body: BodyInit | null, init: { status?: number; headers: HeadersInit }) {
  return new Response(body, { ...init, encodeBody: 'manual' });
}

function passThroughEncoded(cached: Response) {
  if (!cached.headers.has('Content-Encoding')) return cached;
  return gzipTileResponse(cached.body, { status: cached.status, headers: cached.headers });
}

export async function handleTileRequest(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const parsed = parseTilePath(url.pathname);
  if (!parsed.ok) return null;
  if (parsed.ext === 'version') return versionResponse(env, parsed.name);

  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cached = await cache.match(request.url);
  if (cached) return passThroughEncoded(cached);

  const source = new R2Source(env, parsed.name);
  // TileJSON reads the archive metadata, which must be decompressed.
  const p = new PMTiles(source, CACHE, parsed.tile ? keepGzipTiles : nativeDecompress);
  const header = await p.getHeader();

  if (!parsed.tile) {
    const t = await p.getTileJson(`https://${url.hostname}/tiles/${parsed.name}`);
    const resp = new Response(JSON.stringify(t), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
    ctx.waitUntil(cache.put(request.url, resp.clone()));
    return resp;
  }

  const [z, x, y] = parsed.tile;
  // How long an answer may be kept depends on whether the version asked for is
  // the archive's. The header read first may be of an archive replaced since (it
  // is cached); reading the tile notices that and reads it again.
  const caching = async () => {
    const latest = await p.getHeader();
    const cacheControl = tileCacheControl(url, latest.etag ? archiveVersion(latest.etag) : undefined);
    // Only tiles of the version asked for go into the Worker's cache, which is
    // keyed by the URL, version included.
    return { latest, cacheControl, keep: cacheControl.includes('immutable') || !url.searchParams.has('v') };
  };
  // Areas without railways (oceans, deserts) have no tile. Browsers cache that
  // answer like a tile, or every view of them would reach the Worker again; the
  // Worker's own cache would not help (it runs inside the Worker, which is
  // invoked either way) and refuses responses without a body.
  const noTile = async (status: number) =>
    new Response(null, {
      status,
      headers: { 'Cache-Control': (await caching()).cacheControl, 'Access-Control-Allow-Origin': '*' },
    });

  if (z < header.minZoom || z > header.maxZoom) return noTile(404);

  const tiledata = await p.getZxy(z, x, y);
  if (!tiledata) return noTile(204);

  const { latest, cacheControl, keep } = await caching();
  const contentType = CONTENT_TYPES[latest.tileType] || 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*',
  };
  if (latest.tileCompression === 2 /* Gzip */) headers['Content-Encoding'] = 'gzip';
  if (keep) ctx.waitUntil(cache.put(request.url, gzipTileResponse(tiledata.data, { headers })));
  return gzipTileResponse(tiledata.data, { headers });
}
