import {
  PMTiles,
  ResolvedValueCache,
  TileType,
} from 'pmtiles';
import { routePartykitRequest, Server } from 'partyserver';

const TILE_RE = /^\/tiles\/(?<name>[0-9a-zA-Z\/!\-_.*'()]+)\/(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+)\.(?<ext>[a-z]+)$/;
const TILEJSON_RE = /^\/tiles\/(?<name>[0-9a-zA-Z\/!\-_.*'()]+)\.json$/;

function parseTilePath(pathname) {
  const tileMatch = pathname.match(TILE_RE);
  if (tileMatch) {
    const { name, z, x, y, ext } = tileMatch.groups;
    return { ok: true, name, tile: [+z, +x, +y], ext };
  }
  const jsonMatch = pathname.match(TILEJSON_RE);
  if (jsonMatch) {
    return { ok: true, name: jsonMatch.groups.name, tile: null, ext: 'json' };
  }
  return { ok: false };
}

async function nativeDecompress(buf, compression) {
  if (compression === 0 /* None */ || compression === 3 /* Unknown */) {
    return buf;
  }
  if (compression === 2 /* Gzip */) {
    const stream = new Response(buf).body;
    const result = stream.pipeThrough(new DecompressionStream('gzip'));
    return new Response(result).arrayBuffer();
  }
  throw new Error('Compression method not supported');
}

const CACHE = new ResolvedValueCache(25, undefined, nativeDecompress);

class R2Source {
  constructor(env, archiveName) {
    this.env = env;
    this.archiveName = archiveName;
  }

  getKey() {
    return this.archiveName;
  }

  async getBytes(offset, length, signal, etag) {
    const key = `${this.archiveName}.pmtiles`;
    const resp = await this.env.ORM_BUCKET.get(key, {
      range: { offset, length },
      onlyIf: etag ? { etagMatches: etag } : undefined,
    });
    if (!resp) {
      throw new Error('Archive not found: ' + key);
    }
    if (!resp.body) {
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

const CONTENT_TYPES = {
  [TileType.Mvt]: 'application/x-protobuf',
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
  [TileType.Webp]: 'image/webp',
};

const EXT_TO_TYPE = {
  mvt: TileType.Mvt,
  pbf: TileType.Mvt,
  png: TileType.Png,
  jpg: TileType.Jpeg,
  webp: TileType.Webp,
};

const PROFILE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#be123c',
  '#4f46e5',
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function sanitizeColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

function sanitizeUser(value, fallback) {
  const base = fallback || {};
  if (!value || typeof value !== 'object') return base;
  return {
    id: base.id || '',
    name: sanitizeText(value.name, base.name || 'Guest', 32),
    color: sanitizeColor(value.color, base.color || PROFILE_COLORS[0]),
  };
}

function sanitizePeerId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[0-9a-zA-Z_-]{1,96}$/.test(id) ? id : null;
}

function sanitizeLngLat(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lng = clampNumber(value[0], -180, 180, NaN);
  const lat = clampNumber(value[1], -85, 85, NaN);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function sanitizeViewport(value) {
  if (!value || typeof value !== 'object') return null;
  const center = sanitizeLngLat(value.center);
  const corners = Array.isArray(value.corners)
    ? value.corners.slice(0, 4).map(sanitizeLngLat)
    : [];
  if (!center || corners.length !== 4 || corners.some((corner) => !corner)) return null;
  return {
    center,
    zoom: Number(clampNumber(value.zoom, 0, 24, 0).toFixed(3)),
    bearing: Number(clampNumber(value.bearing, -360, 360, 0).toFixed(2)),
    pitch: Number(clampNumber(value.pitch, 0, 85, 0).toFixed(2)),
    corners,
  };
}

function sanitizeCursor(value) {
  if (!value || typeof value !== 'object') return { visible: false, lngLat: null };
  if (value.visible === false) return { visible: false, lngLat: null };
  const lngLat = sanitizeLngLat(value.lngLat);
  return lngLat ? { visible: true, lngLat } : { visible: false, lngLat: null };
}

function sanitizeLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const lngLat = sanitizeLngLat(value.lngLat || value.coords);
  if (!lngLat) return null;
  return {
    lngLat,
    accuracy: Math.min(Number(value.accuracy) || 0, 10_000),
    heading: Number.isFinite(value.heading) ? Number(value.heading.toFixed(1)) : null,
  };
}

function sanitizeViewState(value, fallback = { terrain: false, satellite: false }) {
  if (!value || typeof value !== 'object') return fallback;
  return {
    terrain: Boolean(value.terrain),
    satellite: Boolean(value.satellite),
  };
}

function publicPeer(connection) {
  const state = connection.state || {};
  if (!state.user) return null;
  return {
    id: connection.id,
    user: state.user,
    viewport: state.viewport || null,
    cursor: state.cursor || { visible: false, lngLat: null },
    location: state.location || null,
    followingId: state.followingId || null,
    viewState: state.viewState || { terrain: false, satellite: false },
    updatedAt: state.updatedAt || Date.now(),
  };
}

function encodeMessage(message) {
  return JSON.stringify(message);
}

export class MapCollaboration extends Server {
  static options = {
    hibernate: true,
  };

  onConnect(connection, { request }) {
    const url = new URL(request.url);
    const color = sanitizeColor(
      url.searchParams.get('color'),
      PROFILE_COLORS[Math.abs(connection.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % PROFILE_COLORS.length],
    );
    const user = {
      id: sanitizeText(url.searchParams.get('userId'), connection.id, 80),
      name: sanitizeText(url.searchParams.get('name'), `Guest ${connection.id.slice(0, 4)}`, 32),
      color,
    };

    connection.setState({
      user,
      viewport: null,
      cursor: { visible: false, lngLat: null },
      location: null,
      followingId: null,
      viewState: { terrain: false, satellite: false },
      updatedAt: Date.now(),
    });

    const peers = [...this.getConnections()]
      .filter((peer) => peer.id !== connection.id)
      .map(publicPeer)
      .filter(Boolean);

    connection.send(encodeMessage({
      type: 'presence:init',
      id: connection.id,
      room: this.name,
      peers,
    }));

    this.broadcast(encodeMessage({
      type: 'presence:join',
      peer: publicPeer(connection),
    }), [connection.id]);
  }

  onMessage(connection, message) {
    if (typeof message !== 'string') return;

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }

    if (payload?.type !== 'client:update') return;

    const previous = connection.state || {};
    const followingId = sanitizePeerId(payload.followingId);
    const next = {
      user: sanitizeUser(payload.user, previous.user),
      viewport: sanitizeViewport(payload.viewport) || previous.viewport || null,
      cursor: sanitizeCursor(payload.cursor),
      location: sanitizeLocation(payload.location),
      followingId: followingId === connection.id ? null : followingId,
      viewState: sanitizeViewState(payload.viewState, previous.viewState || { terrain: false, satellite: false }),
      updatedAt: Date.now(),
    };

    connection.setState(next);

    this.broadcast(encodeMessage({
      type: 'presence:update',
      peer: publicPeer(connection),
    }), [connection.id]);
  }

  onClose(connection) {
    this.broadcast(encodeMessage({
      type: 'presence:leave',
      id: connection.id,
    }));
  }

  onError(connection) {
    this.broadcast(encodeMessage({
      type: 'presence:leave',
      id: connection.id,
    }));
  }

  onRequest() {
    return new Response('Map collaboration room is ready.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function handleTileRequest(request, env, ctx) {
  const url = new URL(request.url);
  const parsed = parseTilePath(url.pathname);
  if (!parsed.ok) return null;

  const cache = caches.default;
  const cached = await cache.match(request.url);
  if (cached) return cached;

  const source = new R2Source(env, parsed.name);
  const p = new PMTiles(source, CACHE, nativeDecompress);
  const header = await p.getHeader();

  // TileJSON request
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
  const resp = new Response(tiledata.data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
  ctx.waitUntil(cache.put(request.url, resp.clone()));
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const partyResponse = await routePartykitRequest(request, env, { cors: true });
    if (partyResponse) return partyResponse;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);

    // /tiles/* → PMTiles from R2
    if (url.pathname.startsWith('/tiles/')) {
      try {
        const resp = await handleTileRequest(request, env, ctx);
        if (resp) return resp;
      } catch (err) {
        console.error('Tile error:', err);
        return new Response('Tile fetch failed', { status: 500 });
      }
    }

    // Everything else → static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
