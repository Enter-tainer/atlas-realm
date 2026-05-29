import { PMTiles, ResolvedValueCache, type RangeResponse, type Source, TileType } from 'pmtiles';
import { routePartykitRequest, Server, type Connection, type ConnectionContext, type WSMessage } from 'partyserver';
import { createEmptyDrawingDoc, DRAWING_DEFAULT_LAYER_ID, normalizeDrawingDoc } from './drawing-model.js';
import { buildDrawingSnapshotMessage, parseDrawingClientMessage, reduceDrawingClientMessage } from './drawing-sync.js';
import type { DrawingDoc } from './drawing-model.js';

const TILE_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\/(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+)\.(?<ext>[a-z]+)$/;
const TILEJSON_RE = /^\/tiles\/(?<name>[0-9a-zA-Z/!\-_.*'()]+)\.json$/;

type TileRequestPath =
  | { ok: true; name: string; tile: [number, number, number]; ext: string }
  | { ok: true; name: string; tile: null; ext: 'json' }
  | { ok: false };

function parseTilePath(pathname: string): TileRequestPath {
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

async function nativeDecompress(buf: ArrayBuffer, compression: number): Promise<ArrayBuffer> {
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

const CACHE = new ResolvedValueCache(25, undefined, nativeDecompress);
type JsonRecord = Record<string, unknown>;
type LngLatTuple = readonly [number, number];
type OverlayType = 'gpx' | 'geojson';
type OverlayContentEncoding = 'gzip' | 'identity';
type RoomPersistence = 'ephemeral' | 'persistent';
type OverlaySubType = 'geojson' | 'osrm' | string;
type OverlayBounds = [[number, number], [number, number]];

interface OverlayManifest extends JsonRecord {
  id: string;
  type: OverlayType;
  subType?: OverlaySubType;
  name: string;
  visible: boolean;
  color: string;
  opacity: number;
  lineWidth: number;
  bounds: OverlayBounds | null;
  contentHash: string;
  contentType: string;
  contentEncoding: OverlayContentEncoding;
  contentByteLength: number;
  rawByteLength: number;
  syncVersion: 1;
  persistence: RoomPersistence;
  updatedAt: number;
  pendingOrderIndex?: number;
}

interface OverlayContentFrame {
  contentHash: string;
  content: Uint8Array;
}

interface UserProfile {
  id: string;
  name: string;
  color: string;
}

type ClientType = 'human' | 'agent' | 'query';

interface AgentParticipant {
  id: string;
  user: UserProfile;
  clientType: 'agent';
  active: boolean;
  lastSeenAt: number;
  expiresAt: number;
  lastAction: string;
}

type OverlayStackItem = { kind: 'overlay'; id: string } | { kind: 'drawing'; layerId: string };

interface CursorState {
  visible: boolean;
  lngLat: LngLatTuple | null;
}

interface LocationState {
  enabled: boolean;
  lngLat: LngLatTuple | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  updatedAt: number | null;
}

interface ViewState {
  terrain: boolean;
  satellite: boolean;
}

interface ViewportState {
  center: LngLatTuple;
  zoom: number;
  bearing: number;
  pitch: number;
  corners: readonly LngLatTuple[];
}

interface PeerState {
  user?: UserProfile;
  clientType?: ClientType;
  presenceVisible?: boolean;
  viewport?: ViewportState | null;
  cursor?: CursorState;
  location?: LocationState;
  followingId?: string | null;
  viewState?: ViewState;
  updatedAt?: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

const CONTENT_TYPES: Partial<Record<TileType, string>> = {
  [TileType.Mvt]: 'application/x-protobuf',
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
  [TileType.Webp]: 'image/webp',
};

const PROFILE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5'];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const OVERLAY_CONTENT_BINARY_VERSION = 1;
const MAX_OVERLAY_CONTENT_BYTES = 2 * 1024 * 1024;
const EPHEMERAL_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const UNREFERENCED_OVERLAY_CONTENT_TTL_MS = 60 * 60 * 1000;
const AGENT_RECENT_TTL_MS = 5 * 60 * 1000;
const AGENT_TOUCH_THROTTLE_MS = 5 * 1000;
const SQL_READY_KEY = '__overlay_sql_ready_v3';
const DRAWING_STATE_KEY = 'main';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function emptyLocation(): LocationState {
  return {
    enabled: false,
    lngLat: null,
    accuracy: null,
    heading: null,
    speed: null,
    updatedAt: null,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function sanitizeOverlayId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[0-9a-zA-Z_-]{1,96}$/.test(id) ? id : null;
}

function sanitizeDrawingLayerId(value: unknown): string | null {
  return sanitizeOverlayId(value);
}

function sanitizeOverlayStackItems(value: unknown): OverlayStackItem[] {
  if (!Array.isArray(value)) return [];
  const items: OverlayStackItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.kind === 'overlay') {
      const id = sanitizeOverlayId(item.id);
      const key = id ? `overlay:${id}` : '';
      if (!id || seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: 'overlay', id });
    } else if (item.kind === 'drawing') {
      const layerId = sanitizeDrawingLayerId(item.layerId) || DRAWING_DEFAULT_LAYER_ID;
      const key = `drawing:${layerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: 'drawing', layerId });
    }
  }
  return items.slice(0, 256);
}

function sanitizeContentHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hash = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function sanitizeOverlayType(value: unknown): OverlayType | null {
  return value === 'gpx' || value === 'geojson' ? value : null;
}

function sanitizeOverlayBounds(value: unknown): OverlayBounds | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const sw = value[0];
  const ne = value[1];
  if (!Array.isArray(sw) || !Array.isArray(ne)) return null;
  const minLng = Number(sw[0]);
  const minLat = Number(sw[1]);
  const maxLng = Number(ne[0]);
  const maxLat = Number(ne[1]);
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function sanitizeOverlayManifest(value: unknown, fallback: JsonRecord = {}): OverlayManifest | null {
  if (!isRecord(value)) return null;
  const id = sanitizeOverlayId(value.id) || sanitizeOverlayId(fallback.id);
  const type = sanitizeOverlayType(value.type || fallback.type);
  const contentHash = sanitizeContentHash(value.contentHash || fallback.contentHash);
  if (!id || !type || !contentHash) return null;
  const bounds = sanitizeOverlayBounds(value.bounds);
  const subType = typeof value.subType === 'string' ? value.subType : undefined;
  return {
    ...value,
    id,
    type,
    subType: subType === 'osrm' ? 'osrm' : subType === 'geojson' ? 'geojson' : subType,
    name: sanitizeText(value.name, type === 'gpx' ? 'GPX overlay' : 'GeoJSON overlay', 96),
    visible: value.visible !== false,
    color: sanitizeColor(value.color, '#3b82f6'),
    opacity: sanitizeOptionalNumber(value.opacity, 0.2, 1) ?? 0.95,
    lineWidth: sanitizeOptionalNumber(value.lineWidth, 1, 12) ?? 5,
    bounds,
    contentHash,
    contentType: sanitizeText(value.contentType, type === 'gpx' ? 'application/gpx+xml' : 'application/geo+json', 80),
    contentEncoding: value.contentEncoding === 'gzip' ? 'gzip' : 'identity',
    contentByteLength: clampNumber(value.contentByteLength, 0, MAX_OVERLAY_CONTENT_BYTES, 0),
    rawByteLength: clampNumber(value.rawByteLength, 0, Number.MAX_SAFE_INTEGER, 0),
    syncVersion: 1,
    persistence: value.persistence === 'persistent' ? 'persistent' : 'ephemeral',
    updatedAt: Date.now(),
  };
}

function normalizeBinaryMessage(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  return null;
}

function decodeOverlayContentFrame(message: unknown): OverlayContentFrame | null {
  const bytes = normalizeBinaryMessage(message);
  if (!bytes || bytes.byteLength < 2 || bytes[0] !== OVERLAY_CONTENT_BINARY_VERSION) return null;
  const hashLength = bytes[1];
  if (bytes.byteLength < 2 + hashLength) return null;
  const contentHash = sanitizeContentHash(textDecoder.decode(bytes.slice(2, 2 + hashLength)));
  if (!contentHash) return null;
  const content = bytes.slice(2 + hashLength);
  if (content.byteLength > MAX_OVERLAY_CONTENT_BYTES) return null;
  return { contentHash, content };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodeOverlayContentFrame(contentHash: string, content: Uint8Array | ArrayBuffer): Uint8Array {
  const hashBytes = textEncoder.encode(contentHash);
  const payload = content instanceof Uint8Array ? content : new Uint8Array(content);
  const buffer = new Uint8Array(2 + hashBytes.byteLength + payload.byteLength);
  buffer[0] = OVERLAY_CONTENT_BINARY_VERSION;
  buffer[1] = hashBytes.byteLength;
  buffer.set(hashBytes, 2);
  buffer.set(payload, 2 + hashBytes.byteLength);
  return buffer;
}

function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

function sanitizeUser(value: unknown, fallback?: UserProfile): UserProfile {
  const base: Partial<UserProfile> = fallback || {};
  if (!isRecord(value))
    return {
      id: base.id || '',
      name: base.name || 'Guest',
      color: base.color || PROFILE_COLORS[0],
    };
  return {
    id: base.id || '',
    name: sanitizeText(value.name, base.name || 'Guest', 32),
    color: sanitizeColor(value.color, base.color || PROFILE_COLORS[0]),
  };
}

function sanitizeClientType(value: unknown): ClientType {
  return value === 'agent' || value === 'query' ? value : 'human';
}

function sanitizeAction(value: unknown, fallback = 'connect'): string {
  return sanitizeText(value, fallback, 80);
}

function sanitizePeerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[0-9a-zA-Z_-]{1,96}$/.test(id) ? id : null;
}

function sanitizeLngLat(value: unknown): LngLatTuple | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lng = clampNumber(value[0], -180, 180, NaN);
  const lat = clampNumber(value[1], -85, 85, NaN);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function sanitizeViewport(value: unknown): ViewportState | null {
  if (!isRecord(value)) return null;
  const center = sanitizeLngLat(value.center);
  const corners = Array.isArray(value.corners) ? value.corners.slice(0, 4).map(sanitizeLngLat) : [];
  if (!center || corners.length !== 4 || corners.some((corner) => !corner)) return null;
  return {
    center,
    zoom: Number(clampNumber(value.zoom, 0, 24, 0).toFixed(3)),
    bearing: Number(clampNumber(value.bearing, -360, 360, 0).toFixed(2)),
    pitch: Number(clampNumber(value.pitch, 0, 85, 0).toFixed(2)),
    corners: corners as LngLatTuple[],
  };
}

function sanitizeCursor(value: unknown): CursorState {
  if (!isRecord(value)) return { visible: false, lngLat: null };
  if (value.visible === false) return { visible: false, lngLat: null };
  const lngLat = sanitizeLngLat(value.lngLat);
  return lngLat ? { visible: true, lngLat } : { visible: false, lngLat: null };
}

function sanitizeOptionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  const number = clampNumber(value, min, max, NaN);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function sanitizeLocation(value: unknown, fallback = emptyLocation()): LocationState {
  if (value === undefined) return fallback;
  if (!isRecord(value) || value.enabled === false) {
    return { ...emptyLocation(), updatedAt: Date.now() };
  }

  const lngLat = sanitizeLngLat(value.lngLat);
  if (!lngLat) return { ...emptyLocation(), updatedAt: Date.now() };

  return {
    enabled: true,
    lngLat,
    accuracy: sanitizeOptionalNumber(value.accuracy, 0, 50_000),
    heading: sanitizeOptionalNumber(value.heading, 0, 360),
    speed: sanitizeOptionalNumber(value.speed, 0, 200),
    updatedAt: Date.now(),
  };
}

function sanitizeViewState(value: unknown, fallback: ViewState = { terrain: false, satellite: false }): ViewState {
  if (!isRecord(value)) return fallback;
  return {
    terrain: Boolean(value.terrain),
    satellite: Boolean(value.satellite),
  };
}

function publicPeer(connection: Connection<PeerState>) {
  const state = connection.state || {};
  if (!state.user || state.presenceVisible === false || state.clientType !== 'human') return null;
  return {
    id: connection.id,
    user: state.user,
    clientType: 'human',
    viewport: state.viewport || null,
    cursor: state.cursor || { visible: false, lngLat: null },
    location: state.location || emptyLocation(),
    followingId: state.followingId || null,
    viewState: state.viewState || { terrain: false, satellite: false },
    updatedAt: state.updatedAt || Date.now(),
  };
}

function encodeMessage(message: unknown): string {
  return JSON.stringify(message);
}

export class MapCollaboration extends Server<Cloudflare.Env> {
  static options = {
    hibernate: true,
  };

  async _ensureOverlayStorage(): Promise<void> {
    if (await this.ctx.storage.get(SQL_READY_KEY)) return;
    this.sql`
      CREATE TABLE IF NOT EXISTS room_meta (
        room_id TEXT PRIMARY KEY,
        persistence TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        expires_at INTEGER
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS overlay_contents (
        content_hash TEXT PRIMARY KEY,
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS overlays (
        overlay_id TEXT PRIMARY KEY,
        manifest_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS drawing_state (
        state_key TEXT PRIMARY KEY,
        doc_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS agent_participants (
        agent_id TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_action TEXT NOT NULL
      )
    `;
    await this.ctx.storage.put(SQL_READY_KEY, true);
  }

  async _touchRoom(): Promise<void> {
    await this._ensureOverlayStorage();
    const now = Date.now();
    const expiresAt = now + EPHEMERAL_ROOM_TTL_MS;
    const existing = this.sql<{ room_id: string; persistence: RoomPersistence }>`
      SELECT room_id, persistence FROM room_meta WHERE room_id = ${this.name} LIMIT 1
    `;
    if (existing.length === 0) {
      this.sql`
        INSERT INTO room_meta (room_id, persistence, created_at, last_active_at, expires_at)
        VALUES (${this.name}, ${'ephemeral'}, ${now}, ${now}, ${expiresAt})
      `;
    } else {
      const persistence = existing[0].persistence === 'persistent' ? 'persistent' : 'ephemeral';
      this.sql`
        UPDATE room_meta
        SET last_active_at = ${now}, expires_at = ${persistence === 'persistent' ? null : expiresAt}
        WHERE room_id = ${this.name}
      `;
    }
    await this.ctx.storage.setAlarm(expiresAt + 60_000);
  }

  _agentParticipants(now = Date.now()): AgentParticipant[] {
    return this.sql<{
      agent_id: string;
      user_json: string;
      last_seen_at: number;
      expires_at: number;
      last_action: string;
    }>`
      SELECT agent_id, user_json, last_seen_at, expires_at, last_action
      FROM agent_participants
      WHERE expires_at > ${now}
      ORDER BY last_seen_at DESC
    `
      .map((row) => {
        try {
          const user = sanitizeUser(JSON.parse(String(row.user_json)), {
            id: row.agent_id,
            name: 'Agent',
            color: PROFILE_COLORS[7],
          });
          return {
            id: row.agent_id,
            user: { ...user, id: row.agent_id },
            clientType: 'agent' as const,
            active: Number(row.expires_at) > now,
            lastSeenAt: Number(row.last_seen_at),
            expiresAt: Number(row.expires_at),
            lastAction: String(row.last_action || 'connect'),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  _pruneAgentParticipants(now = Date.now()): void {
    this.sql`
      DELETE FROM agent_participants
      WHERE expires_at <= ${now}
    `;
  }

  _touchAgentParticipant(user: UserProfile, action = 'connect', now = Date.now()): AgentParticipant | null {
    const agentId = sanitizePeerId(user.id);
    if (!agentId) return null;
    const existing = this.sql<{ last_seen_at: number; expires_at: number }>`
      SELECT last_seen_at, expires_at FROM agent_participants WHERE agent_id = ${agentId} LIMIT 1
    `[0];
    const expiresAt = now + AGENT_RECENT_TTL_MS;
    const lastAction = sanitizeAction(action);
    const shouldWrite =
      !existing || now - Number(existing.last_seen_at) >= AGENT_TOUCH_THROTTLE_MS || lastAction !== 'connect';
    if (shouldWrite) {
      const storedUser = {
        id: agentId,
        name: sanitizeText(user.name, 'Agent', 32),
        color: sanitizeColor(user.color, PROFILE_COLORS[7]),
      };
      this.sql`
        INSERT OR REPLACE INTO agent_participants (agent_id, user_json, last_seen_at, expires_at, last_action)
        VALUES (${agentId}, ${JSON.stringify(storedUser)}, ${now}, ${expiresAt}, ${lastAction})
      `;
      const participant = {
        id: agentId,
        user: storedUser,
        clientType: 'agent' as const,
        active: true,
        lastSeenAt: now,
        expiresAt,
        lastAction,
      };
      this.broadcast(
        encodeMessage({
          type: 'agent:participant:update',
          agent: participant,
        }),
        undefined,
      );
      return participant;
    }
    return {
      id: agentId,
      user,
      clientType: 'agent',
      active: Number(existing.expires_at) > now,
      lastSeenAt: Number(existing.last_seen_at),
      expiresAt: Number(existing.expires_at),
      lastAction,
    };
  }

  _listOverlayManifests(): OverlayManifest[] {
    return this.sql<{ manifest_json: string }>`
      SELECT manifest_json FROM overlays ORDER BY order_index ASC, updated_at ASC
    `
      .map((row) => {
        try {
          return sanitizeOverlayManifest(JSON.parse(String(row.manifest_json)));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  _getOverlayContent(contentHash: string): ArrayBuffer | null {
    const rows = this.sql<{ bytes: ArrayBuffer }>`
      SELECT bytes FROM overlay_contents WHERE content_hash = ${contentHash} LIMIT 1
    `;
    return rows[0]?.bytes || null;
  }

  _pruneUnreferencedOverlayContent({ immediate = false }: { immediate?: boolean } = {}): void {
    const cutoff = immediate ? Date.now() + 1 : Date.now() - UNREFERENCED_OVERLAY_CONTENT_TTL_MS;
    this.sql`
      DELETE FROM overlay_contents
      WHERE content_hash NOT IN (
        SELECT DISTINCT content_hash FROM overlays
      )
      AND created_at < ${cutoff}
    `;
  }

  _broadcastOverlayList(excludeId?: string) {
    this.broadcast(
      encodeMessage({
        type: 'overlay:list',
        persistence: 'ephemeral',
        overlays: this._listOverlayManifests(),
      }),
      excludeId ? [excludeId] : undefined,
    );
  }

  _broadcastDrawingLayerUpsert(layerId: string) {
    const doc = this._getDrawingDoc();
    const layer = doc.layers[layerId];
    if (!layer) return;
    this.broadcast(
      encodeMessage({
        type: 'drawing:layer:upserted',
        revision: doc.revision,
        layer,
      }),
    );
  }

  _getDrawingDoc(): DrawingDoc {
    const row = this.sql<{ doc_json: string }>`
      SELECT doc_json FROM drawing_state WHERE state_key = ${DRAWING_STATE_KEY} LIMIT 1
    `[0];
    if (!row?.doc_json) return createEmptyDrawingDoc();
    try {
      return normalizeDrawingDoc(JSON.parse(String(row.doc_json)));
    } catch {
      return createEmptyDrawingDoc();
    }
  }

  _saveDrawingDoc(doc: DrawingDoc): void {
    const normalized = normalizeDrawingDoc(doc);
    this.sql`
      INSERT OR REPLACE INTO drawing_state (state_key, doc_json, updated_at)
      VALUES (${DRAWING_STATE_KEY}, ${JSON.stringify(normalized)}, ${Date.now()})
    `;
  }

  async onStart(): Promise<void> {
    await this._ensureOverlayStorage();
  }

  async onConnect(connection: Connection<PeerState>, { request }: ConnectionContext): Promise<void> {
    await this._touchRoom();
    const url = new URL(request.url);
    const clientType = sanitizeClientType(url.searchParams.get('clientType'));
    const presenceVisible = clientType === 'human' && url.searchParams.get('headless') !== 'true';
    const color = sanitizeColor(
      url.searchParams.get('color'),
      PROFILE_COLORS[
        Math.abs(connection.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % PROFILE_COLORS.length
      ],
    );
    const user = {
      id: sanitizeText(url.searchParams.get('userId'), connection.id, 80),
      name: sanitizeText(url.searchParams.get('name'), `Guest ${connection.id.slice(0, 4)}`, 32),
      color,
    };
    const agent = clientType === 'agent' ? this._touchAgentParticipant(user, 'connect') : null;

    connection.setState({
      user,
      clientType,
      presenceVisible,
      viewport: null,
      cursor: { visible: false, lngLat: null },
      location: emptyLocation(),
      followingId: null,
      viewState: { terrain: false, satellite: false },
      updatedAt: Date.now(),
    });

    const peers = [...this.getConnections<PeerState>()]
      .filter((peer) => peer.id !== connection.id)
      .map(publicPeer)
      .filter(Boolean);

    connection.send(
      encodeMessage({
        type: 'presence:init',
        id: connection.id,
        room: this.name,
        peers,
        agents: this._agentParticipants(),
      }),
    );

    connection.send(
      encodeMessage({
        type: 'overlay:init',
        persistence: 'ephemeral',
        overlays: this._listOverlayManifests(),
      }),
    );

    connection.send(encodeMessage(buildDrawingSnapshotMessage(this._getDrawingDoc())));

    if (presenceVisible) {
      this.broadcast(
        encodeMessage({
          type: 'presence:join',
          peer: publicPeer(connection),
        }),
        [connection.id],
      );
    } else if (agent) {
      connection.send(
        encodeMessage({
          type: 'agent:participant:update',
          agent,
        }),
      );
    }
  }

  async onMessage(connection: Connection<PeerState>, message: WSMessage): Promise<void> {
    await this._touchRoom();

    if (typeof message !== 'string') {
      const frame = decodeOverlayContentFrame(message);
      if (!frame) return;
      const contentBuffer = toArrayBuffer(frame.content);
      this.ctx.storage.sql.exec(
        `
        INSERT OR REPLACE INTO overlay_contents (content_hash, bytes, byte_length, created_at)
        VALUES (?, ?, ?, ?)
      `,
        frame.contentHash,
        contentBuffer,
        frame.content.byteLength,
        Date.now(),
      );
      connection.send(
        encodeMessage({
          type: 'overlay:content:stored',
          contentHash: frame.contentHash,
        }),
      );
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    if (!isRecord(payload)) return;

    if (payload.type === 'overlay:upsert') {
      const manifest = sanitizeOverlayManifest(payload.manifest);
      if (!manifest) return;
      const hasContent =
        this.sql<{ content_hash: string }>`
        SELECT content_hash FROM overlay_contents WHERE content_hash = ${manifest.contentHash} LIMIT 1
      `.length > 0;
      if (!hasContent) {
        connection.send(
          encodeMessage({
            type: 'overlay:content:needed',
            contentHash: manifest.contentHash,
          }),
        );
        return;
      }
      const existing = this.sql<{ order_index: number }>`
        SELECT order_index FROM overlays WHERE overlay_id = ${manifest.id} LIMIT 1
      `;
      const requestedOrder = Number(manifest.pendingOrderIndex);
      delete manifest.pendingOrderIndex;
      const orderIndex =
        existing.length > 0
          ? Number(existing[0].order_index)
          : Number.isInteger(requestedOrder)
            ? requestedOrder
            : -Date.now();
      this.sql`
        INSERT OR REPLACE INTO overlays (overlay_id, manifest_json, content_hash, order_index, updated_at)
        VALUES (${manifest.id}, ${JSON.stringify(manifest)}, ${manifest.contentHash}, ${orderIndex}, ${Date.now()})
      `;
      this._pruneUnreferencedOverlayContent({ immediate: existing.length > 0 });
      connection.send(
        encodeMessage({
          type: 'overlay:upserted',
          manifest,
        }),
      );
      this._broadcastOverlayList(undefined);
      return;
    }

    if (payload.type === 'overlay:content:request') {
      const contentHash = sanitizeContentHash(payload.contentHash);
      if (!contentHash) return;
      const content = this._getOverlayContent(contentHash);
      if (!content) return;
      connection.send(encodeOverlayContentFrame(contentHash, content));
      return;
    }

    if (payload.type === 'overlay:patch') {
      const overlayId = sanitizeOverlayId(payload.overlayId);
      if (!overlayId || !isRecord(payload.patch)) return;
      const existing = this.sql<{ manifest_json: string }>`
        SELECT manifest_json FROM overlays WHERE overlay_id = ${overlayId} LIMIT 1
      `;
      if (!existing.length) return;
      let manifest: OverlayManifest | null;
      try {
        manifest = sanitizeOverlayManifest(JSON.parse(String(existing[0].manifest_json)));
      } catch {
        return;
      }
      if (!manifest) return;
      const nextManifest = sanitizeOverlayManifest({
        ...manifest,
        ...payload.patch,
        id: overlayId,
        contentHash: manifest.contentHash,
        type: manifest.type,
      });
      if (!nextManifest) return;
      this.sql`
        UPDATE overlays
        SET manifest_json = ${JSON.stringify(nextManifest)}, updated_at = ${Date.now()}
        WHERE overlay_id = ${overlayId}
      `;
      connection.send(
        encodeMessage({
          type: 'overlay:patched',
          manifest: nextManifest,
        }),
      );
      this._broadcastOverlayList(connection.id);
      return;
    }

    if (payload.type === 'overlay:reorder') {
      const orderedIds = Array.isArray(payload.orderedIds)
        ? payload.orderedIds.map(sanitizeOverlayId).filter(Boolean)
        : [];
      orderedIds.forEach((overlayId, index) => {
        this
          .sql`UPDATE overlays SET order_index = ${index}, updated_at = ${Date.now()} WHERE overlay_id = ${overlayId}`;
      });
      connection.send(
        encodeMessage({
          type: 'overlay:reordered',
          orderedIds: this._listOverlayManifests().map((manifest) => manifest.id),
        }),
      );
      this._broadcastOverlayList(connection.id);
      return;
    }

    if (payload.type === 'overlay:stack:reorder') {
      const stackItems = sanitizeOverlayStackItems(payload.stackItems);
      const orderedOverlayIds = stackItems.filter((item) => item.kind === 'overlay').map((item) => item.id);
      orderedOverlayIds.forEach((overlayId, index) => {
        this
          .sql`UPDATE overlays SET order_index = ${index}, updated_at = ${Date.now()} WHERE overlay_id = ${overlayId}`;
      });

      const drawingItems = stackItems
        .map((item, index) => (item.kind === 'drawing' ? { layerId: item.layerId, stackOrder: index } : null))
        .filter(Boolean) as Array<{ layerId: string; stackOrder: number }>;
      const drawingLayerIds: string[] = [];
      if (drawingItems.length > 0) {
        const doc = this._getDrawingDoc();
        let changed = false;
        let nextRevision = doc.revision;
        for (const item of drawingItems) {
          const layer = doc.layers[item.layerId];
          if (!layer || layer.stackOrder === item.stackOrder) continue;
          doc.layers[item.layerId] = {
            ...layer,
            stackOrder: item.stackOrder,
            updatedAt: Date.now(),
          };
          nextRevision += 1;
          changed = true;
          drawingLayerIds.push(item.layerId);
        }
        if (changed) {
          doc.revision = nextRevision;
          doc.updatedAt = Date.now();
          this._saveDrawingDoc(doc);
        }
      }

      connection.send(
        encodeMessage({
          type: 'overlay:reordered',
          orderedIds: this._listOverlayManifests().map((manifest) => manifest.id),
          stackItems,
        }),
      );
      this._broadcastOverlayList(connection.id);
      for (const layerId of drawingLayerIds) this._broadcastDrawingLayerUpsert(layerId);
      return;
    }

    if (payload.type === 'overlay:delete') {
      const overlayId = sanitizeOverlayId(payload.overlayId);
      if (!overlayId) return;
      this.sql`DELETE FROM overlays WHERE overlay_id = ${overlayId}`;
      this._pruneUnreferencedOverlayContent({ immediate: true });
      connection.send(encodeMessage({ type: 'overlay:deleted', overlayId }));
      this.broadcast(encodeMessage({ type: 'overlay:delete', overlayId }), [connection.id]);
      return;
    }

    if (typeof payload.type === 'string' && payload.type.startsWith('drawing:')) {
      const clientMessage = parseDrawingClientMessage(payload);
      if (!clientMessage) return;
      const result = reduceDrawingClientMessage(this._getDrawingDoc(), clientMessage);
      this._saveDrawingDoc(result.doc);
      if (!result.outbound) return;
      if (clientMessage.type === 'drawing:snapshot:request') {
        connection.send(encodeMessage(result.outbound));
      } else {
        this.broadcast(encodeMessage(result.outbound));
      }
      return;
    }

    if (payload.type !== 'client:update') return;

    const previous = connection.state || {};
    if (previous.clientType === 'agent' && previous.user) {
      this._touchAgentParticipant(previous.user, sanitizeAction(payload.action, 'client:update'));
      return;
    }
    if (previous.clientType !== 'human' || previous.presenceVisible === false) return;

    const followingId = sanitizePeerId(payload.followingId);
    const next = {
      user: sanitizeUser(payload.user, previous.user),
      clientType: previous.clientType,
      presenceVisible: previous.presenceVisible,
      viewport: sanitizeViewport(payload.viewport) || previous.viewport || null,
      cursor: sanitizeCursor(payload.cursor),
      location: sanitizeLocation(payload.location, previous.location || emptyLocation()),
      followingId: followingId === connection.id ? null : followingId,
      viewState: sanitizeViewState(payload.viewState, previous.viewState || { terrain: false, satellite: false }),
      updatedAt: Date.now(),
    };

    connection.setState(next);

    this.broadcast(
      encodeMessage({
        type: 'presence:update',
        peer: publicPeer(connection),
      }),
      [connection.id],
    );
  }

  onClose(connection: Connection<PeerState>): void {
    if (connection.state?.presenceVisible === false || connection.state?.clientType !== 'human') return;
    this.broadcast(encodeMessage({ type: 'presence:leave', id: connection.id }));
  }

  onError(connection: Connection<PeerState>): void {
    this.broadcast(
      encodeMessage({
        type: 'presence:leave',
        id: connection.id,
      }),
    );
  }

  onRequest(): Response {
    return new Response('Map collaboration room is ready.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  async onAlarm(): Promise<void> {
    await this._ensureOverlayStorage();
    const room = this.sql<{ persistence: RoomPersistence; expires_at: number | null }>`
      SELECT persistence, expires_at FROM room_meta WHERE room_id = ${this.name} LIMIT 1
    `[0];
    if (!room || room.persistence === 'persistent') return;
    if (room.expires_at && Number(room.expires_at) > Date.now()) {
      this._pruneAgentParticipants();
      await this.ctx.storage.setAlarm(Number(room.expires_at) + 60_000);
      return;
    }
    this.sql`DELETE FROM overlays`;
    this.sql`DELETE FROM overlay_contents`;
    this.sql`DELETE FROM drawing_state`;
    this.sql`DELETE FROM agent_participants`;
    this.sql`DELETE FROM room_meta WHERE room_id = ${this.name}`;
  }
}

async function handleTileRequest(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const parsed = parseTilePath(url.pathname);
  if (!parsed.ok) return null;

  const cache = (caches as CacheStorage & { default: Cache }).default;
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
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
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
} satisfies ExportedHandler<Cloudflare.Env>;
