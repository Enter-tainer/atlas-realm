import { PMTiles, ResolvedValueCache, type RangeResponse, type Source, TileType } from 'pmtiles';

const TILE_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\/(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+)\.(?<ext>[a-z]+)$/;
const TILEJSON_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\.json$/;

type TileRequestPath =
  | { ok: true; name: string; tile: [number, number, number]; ext: string }
  | { ok: true; name: string; tile: null; ext: 'json' }
  | { ok: false };

export function parseTilePath(pathname: string): TileRequestPath {
  const tileMatch = pathname.match(TILE_RE);
  if (tileMatch?.groups) {
    const { name, z, x, y, ext } = tileMatch.groups;
    return { ok: true, name, tile: [+z, +x, +y], ext };
  }
  const jsonMatch = pathname.match(TILEJSON_RE);
  if (jsonMatch?.groups) {
    return { ok: true, name: jsonMatch.groups.name, tile: null, ext: 'json' };
  }
  return { ok: false };
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
      throw new Error('ETag mismatch');
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

  if (z < header.minZoom || z > header.maxZoom) {
    return new Response(null, { status: 404 });
  }

  const tiledata = await p.getZxy(z, x, y);
  if (!tiledata) {
    return new Response(null, { status: 204 });
  }

  const contentType = CONTENT_TYPES[header.tileType] || 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  };
  if (header.tileCompression === 2 /* Gzip */) headers['Content-Encoding'] = 'gzip';
  ctx.waitUntil(cache.put(request.url, gzipTileResponse(tiledata.data, { headers })));
  return gzipTileResponse(tiledata.data, { headers });
}
