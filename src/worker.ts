import { PMTiles, ResolvedValueCache, type RangeResponse, type Source, TileType } from 'pmtiles';
import { routePartykitRequest, Server, type Connection, type ConnectionContext, type WSMessage } from 'partyserver';
import {
  createDefaultAnnotationLayer,
  sanitizeAnnotationFeature,
  sanitizeLayer,
  type AnnotationFeature,
  type FileLayerPayload,
  type FileLayer,
  type Layer,
} from './layer-model.js';
import {
  parseAnnotationFeatureClientMessage,
  parseLayerClientMessage,
  sortAnnotationFeatures,
  sortLayers,
} from './layer-sync.js';

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
type RoomPersistence = 'ephemeral' | 'persistent';

interface FileContentFrame {
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
const FILE_CONTENT_BINARY_VERSION = 1;
const MAX_FILE_CONTENT_BYTES = 2 * 1024 * 1024;
const EPHEMERAL_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const UNREFERENCED_FILE_CONTENT_TTL_MS = 60 * 60 * 1000;
const AGENT_RECENT_TTL_MS = 5 * 60 * 1000;
const AGENT_TOUCH_THROTTLE_MS = 5 * 1000;
const SQL_READY_KEY = '__layer_sql_ready_v2_clean_break';
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

function sanitizeContentHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hash = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function normalizeBinaryMessage(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  return null;
}

function decodeFileContentFrame(message: unknown): FileContentFrame | null {
  const bytes = normalizeBinaryMessage(message);
  if (!bytes || bytes.byteLength < 2 || bytes[0] !== FILE_CONTENT_BINARY_VERSION) return null;
  const hashLength = bytes[1];
  if (bytes.byteLength < 2 + hashLength) return null;
  const contentHash = sanitizeContentHash(textDecoder.decode(bytes.slice(2, 2 + hashLength)));
  if (!contentHash) return null;
  const content = bytes.slice(2 + hashLength);
  if (content.byteLength > MAX_FILE_CONTENT_BYTES) return null;
  return { contentHash, content };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodeFileContentFrame(contentHash: string, content: Uint8Array | ArrayBuffer): Uint8Array {
  const hashBytes = textEncoder.encode(contentHash);
  const payload = content instanceof Uint8Array ? content : new Uint8Array(content);
  const buffer = new Uint8Array(2 + hashBytes.byteLength + payload.byteLength);
  buffer[0] = FILE_CONTENT_BINARY_VERSION;
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

  async _ensureLayerStorage(): Promise<void> {
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
      CREATE TABLE IF NOT EXISTS file_contents (
        content_hash TEXT PRIMARY KEY,
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS layers (
        layer_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        visible INTEGER NOT NULL,
        sort_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      )
    `;
    this.sql`CREATE INDEX IF NOT EXISTS layers_sort_idx ON layers(sort_key, created_at, layer_id)`;
    this.sql`CREATE INDEX IF NOT EXISTS layers_kind_idx ON layers(kind)`;
    this.sql`
      CREATE TABLE IF NOT EXISTS annotation_features (
        feature_id TEXT PRIMARY KEY,
        layer_id TEXT NOT NULL,
        feature_type TEXT NOT NULL,
        feature_json TEXT NOT NULL,
        sort_key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL
      )
    `;
    this
      .sql`CREATE INDEX IF NOT EXISTS annotation_features_layer_idx ON annotation_features(layer_id, sort_key, created_at, feature_id)`;
    this.sql`CREATE INDEX IF NOT EXISTS annotation_features_updated_idx ON annotation_features(updated_at)`;
    this.sql`
      CREATE TABLE IF NOT EXISTS agent_participants (
        agent_id TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_action TEXT NOT NULL
      )
    `;
    this._ensureDefaultAnnotationLayer();
    await this.ctx.storage.put(SQL_READY_KEY, true);
  }

  async _touchRoom(): Promise<void> {
    await this._ensureLayerStorage();
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

  _ensureDefaultAnnotationLayer(): void {
    const defaultLayer = createDefaultAnnotationLayer();
    const exists = this.sql<{ layer_id: string }>`
      SELECT layer_id FROM layers WHERE layer_id = ${defaultLayer.id} LIMIT 1
    `;
    if (exists.length > 0) return;
    this._upsertLayerRow(defaultLayer);
  }

  _upsertLayerRow(layer: Layer): void {
    this.sql`
      INSERT OR REPLACE INTO layers
        (layer_id, kind, name, visible, sort_key, payload_json, revision, created_at, updated_at, updated_by)
      VALUES
        (${layer.id}, ${layer.kind}, ${layer.name}, ${layer.visible ? 1 : 0}, ${layer.sortKey},
         ${JSON.stringify(layer.payload)}, ${layer.revision}, ${layer.createdAt}, ${layer.updatedAt}, ${layer.updatedBy || null})
    `;
  }

  _layerFromRow(row: {
    layer_id: string;
    kind: string;
    name: string;
    visible: number;
    sort_key: string;
    payload_json: string;
    revision: number;
    created_at: number;
    updated_at: number;
    updated_by: string | null;
  }): Layer | null {
    try {
      return sanitizeLayer({
        id: row.layer_id,
        kind: row.kind,
        name: row.name,
        visible: Number(row.visible) !== 0,
        sortKey: row.sort_key,
        payload: JSON.parse(String(row.payload_json)),
        revision: Number(row.revision),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        updatedBy: row.updated_by || undefined,
      });
    } catch {
      return null;
    }
  }

  _listLayers(): Layer[] {
    return sortLayers(
      this.sql<{
        layer_id: string;
        kind: string;
        name: string;
        visible: number;
        sort_key: string;
        payload_json: string;
        revision: number;
        created_at: number;
        updated_at: number;
        updated_by: string | null;
      }>`
        SELECT layer_id, kind, name, visible, sort_key, payload_json, revision, created_at, updated_at, updated_by
        FROM layers
        ORDER BY sort_key ASC, created_at ASC, layer_id ASC
      `
        .map((row) => this._layerFromRow(row))
        .filter(Boolean),
    );
  }

  _getLayer(layerId: string): Layer | null {
    const row = this.sql<{
      layer_id: string;
      kind: string;
      name: string;
      visible: number;
      sort_key: string;
      payload_json: string;
      revision: number;
      created_at: number;
      updated_at: number;
      updated_by: string | null;
    }>`
      SELECT layer_id, kind, name, visible, sort_key, payload_json, revision, created_at, updated_at, updated_by
      FROM layers
      WHERE layer_id = ${layerId}
      LIMIT 1
    `[0];
    return row ? this._layerFromRow(row) : null;
  }

  _annotationFeatureFromRow(row: {
    feature_id: string;
    layer_id: string;
    feature_type: string;
    feature_json: string;
    sort_key: string;
    revision: number;
    created_at: number;
    updated_at: number;
    updated_by: string;
  }): AnnotationFeature | null {
    try {
      return sanitizeAnnotationFeature({
        id: row.feature_id,
        layerId: row.layer_id,
        featureType: row.feature_type,
        payload: JSON.parse(String(row.feature_json)),
        sortKey: row.sort_key,
        revision: Number(row.revision),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        updatedBy: row.updated_by,
      });
    } catch {
      return null;
    }
  }

  _listAnnotationFeatures(layerId?: string): AnnotationFeature[] {
    const rows = layerId
      ? this.sql<{
          feature_id: string;
          layer_id: string;
          feature_type: string;
          feature_json: string;
          sort_key: string;
          revision: number;
          created_at: number;
          updated_at: number;
          updated_by: string;
        }>`
          SELECT feature_id, layer_id, feature_type, feature_json, sort_key, revision, created_at, updated_at, updated_by
          FROM annotation_features
          WHERE layer_id = ${layerId}
          ORDER BY sort_key ASC, created_at ASC, feature_id ASC
        `
      : this.sql<{
          feature_id: string;
          layer_id: string;
          feature_type: string;
          feature_json: string;
          sort_key: string;
          revision: number;
          created_at: number;
          updated_at: number;
          updated_by: string;
        }>`
          SELECT feature_id, layer_id, feature_type, feature_json, sort_key, revision, created_at, updated_at, updated_by
          FROM annotation_features
          ORDER BY layer_id ASC, sort_key ASC, created_at ASC, feature_id ASC
        `;
    return sortAnnotationFeatures(rows.map((row) => this._annotationFeatureFromRow(row)).filter(Boolean));
  }

  _upsertAnnotationFeatureRow(feature: AnnotationFeature): void {
    this.sql`
      INSERT OR REPLACE INTO annotation_features
        (feature_id, layer_id, feature_type, feature_json, sort_key, revision, created_at, updated_at, updated_by)
      VALUES
        (${feature.id}, ${feature.layerId}, ${feature.featureType}, ${JSON.stringify(feature.payload)}, ${feature.sortKey},
         ${feature.revision}, ${feature.createdAt}, ${feature.updatedAt}, ${feature.updatedBy})
    `;
  }

  _getFileContent(contentHash: string): ArrayBuffer | null {
    const rows = this.sql<{ bytes: ArrayBuffer }>`
      SELECT bytes FROM file_contents WHERE content_hash = ${contentHash} LIMIT 1
    `;
    return rows[0]?.bytes || null;
  }

  _pruneUnreferencedFileContent({ immediate = false }: { immediate?: boolean } = {}): void {
    const cutoff = immediate ? Date.now() + 1 : Date.now() - UNREFERENCED_FILE_CONTENT_TTL_MS;
    this.sql`
      DELETE FROM file_contents
      WHERE content_hash NOT IN (
        SELECT json_extract(payload_json, '$.contentHash') FROM layers WHERE kind = 'file'
      )
      AND created_at < ${cutoff}
    `;
  }

  async onStart(): Promise<void> {
    await this._ensureLayerStorage();
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
        type: 'layer:list',
        layers: this._listLayers(),
      }),
    );
    connection.send(
      encodeMessage({
        type: 'annotation-feature:list',
        features: this._listAnnotationFeatures(),
      }),
    );

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
      const frame = decodeFileContentFrame(message);
      if (!frame) return;
      const contentBuffer = toArrayBuffer(frame.content);
      this.ctx.storage.sql.exec(
        `
        INSERT OR REPLACE INTO file_contents (content_hash, bytes, byte_length, created_at)
        VALUES (?, ?, ?, ?)
      `,
        frame.contentHash,
        contentBuffer,
        frame.content.byteLength,
        Date.now(),
      );
      connection.send(
        encodeMessage({
          type: 'file:content:stored',
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

    const layerMessage = parseLayerClientMessage(payload);
    if (layerMessage) {
      if (layerMessage.type === 'layer:list:request') {
        connection.send(encodeMessage({ type: 'layer:list', layers: this._listLayers() }));
        return;
      }
      if (layerMessage.type === 'layer:create') {
        const existing = this._getLayer(layerMessage.layer.id);
        const layer = sanitizeLayer(
          {
            ...layerMessage.layer,
            revision: (existing?.revision || 0) + 1,
            createdAt: existing?.createdAt || layerMessage.layer.createdAt || Date.now(),
            updatedAt: Date.now(),
          },
          Date.now(),
          existing || undefined,
        );
        if (!layer) return;
        if (layer.kind === 'file') {
          const fileLayer = layer as FileLayer;
          const hasContent =
            this.sql<{ content_hash: string }>`
              SELECT content_hash FROM file_contents WHERE content_hash = ${fileLayer.payload.contentHash} LIMIT 1
            `.length > 0;
          if (!hasContent) {
            connection.send(encodeMessage({ type: 'file:content:needed', contentHash: fileLayer.payload.contentHash }));
            return;
          }
        }
        this._upsertLayerRow(layer);
        if (existing?.kind === 'file') this._pruneUnreferencedFileContent({ immediate: true });
        connection.send(encodeMessage({ type: 'layer:created', layer }));
        this.broadcast(encodeMessage({ type: 'layer:created', layer }), [connection.id]);
        return;
      }
      if (layerMessage.type === 'layer:update') {
        const existing = this._getLayer(layerMessage.layerId);
        if (!existing) return;
        const patchPayload = isRecord(layerMessage.patch.payload) ? layerMessage.patch.payload : {};
        const nextPayload =
          layerMessage.patch.payload && existing.kind === 'file'
            ? {
                ...(existing as FileLayer).payload,
                style: {
                  ...(existing.payload as FileLayerPayload).style,
                  ...(isRecord(patchPayload.style) ? patchPayload.style : {}),
                },
                bounds: patchPayload.bounds ?? (existing.payload as FileLayerPayload).bounds,
              }
            : existing.payload;
        const next = sanitizeLayer(
          {
            ...existing,
            ...layerMessage.patch,
            payload: existing.kind === 'annotation' ? { version: 1 } : nextPayload,
            revision: existing.revision + 1,
            updatedAt: Date.now(),
          },
          Date.now(),
          existing,
        );
        if (!next) return;
        this._upsertLayerRow(next);
        connection.send(encodeMessage({ type: 'layer:updated', layer: next }));
        this.broadcast(encodeMessage({ type: 'layer:updated', layer: next }), [connection.id]);
        return;
      }
      if (layerMessage.type === 'layer:delete') {
        const existing = this._getLayer(layerMessage.layerId);
        if (!existing) return;
        this.sql`DELETE FROM annotation_features WHERE layer_id = ${layerMessage.layerId}`;
        this.sql`DELETE FROM layers WHERE layer_id = ${layerMessage.layerId}`;
        if (existing.kind === 'file') this._pruneUnreferencedFileContent({ immediate: true });
        connection.send(encodeMessage({ type: 'layer:deleted', layerId: layerMessage.layerId }));
        this.broadcast(encodeMessage({ type: 'layer:deleted', layerId: layerMessage.layerId }), [connection.id]);
        return;
      }
      if (layerMessage.type === 'layer:reorder') {
        for (const update of layerMessage.updates) {
          const existing = this._getLayer(update.layerId);
          if (!existing) continue;
          this.sql`
            UPDATE layers
            SET sort_key = ${update.sortKey}, revision = ${existing.revision + 1}, updated_at = ${Date.now()}
            WHERE layer_id = ${update.layerId}
          `;
        }
        const layers = this._listLayers();
        connection.send(encodeMessage({ type: 'layer:reordered', layers }));
        this.broadcast(encodeMessage({ type: 'layer:reordered', layers }), [connection.id]);
        return;
      }
    }

    const annotationMessage = parseAnnotationFeatureClientMessage(payload);
    if (annotationMessage) {
      if (annotationMessage.type === 'annotation-feature:list:request') {
        connection.send(
          encodeMessage({
            type: 'annotation-feature:list',
            layerId: annotationMessage.layerId,
            features: this._listAnnotationFeatures(annotationMessage.layerId),
          }),
        );
        return;
      }
      if (annotationMessage.type === 'annotation-feature:upsert') {
        const parent = this._getLayer(annotationMessage.feature.layerId);
        if (!parent || parent.kind !== 'annotation') {
          connection.send(
            encodeMessage({
              type: 'annotation-feature:rejected',
              featureId: annotationMessage.feature.id,
              reason: 'missing-layer',
            }),
          );
          return;
        }
        const existing = this.sql<{ revision: number; created_at: number }>`
          SELECT revision, created_at FROM annotation_features WHERE feature_id = ${annotationMessage.feature.id} LIMIT 1
        `[0];
        const feature = sanitizeAnnotationFeature(
          {
            ...annotationMessage.feature,
            revision: Number(existing?.revision || 0) + 1,
            createdAt: Number(existing?.created_at || annotationMessage.feature.createdAt),
            updatedAt: Date.now(),
          },
          Date.now(),
        );
        if (!feature) {
          connection.send(
            encodeMessage({
              type: 'annotation-feature:rejected',
              featureId: annotationMessage.feature.id,
              reason: 'invalid-feature',
            }),
          );
          return;
        }
        this._upsertAnnotationFeatureRow(feature);
        connection.send(encodeMessage({ type: 'annotation-feature:upserted', feature }));
        this.broadcast(encodeMessage({ type: 'annotation-feature:upserted', feature }), [connection.id]);
        return;
      }
      if (annotationMessage.type === 'annotation-feature:delete') {
        this.sql`DELETE FROM annotation_features WHERE feature_id = ${annotationMessage.featureId}`;
        connection.send(encodeMessage({ type: 'annotation-feature:deleted', featureId: annotationMessage.featureId }));
        this.broadcast(encodeMessage({ type: 'annotation-feature:deleted', featureId: annotationMessage.featureId }), [
          connection.id,
        ]);
        return;
      }
      if (annotationMessage.type === 'annotation-feature:reorder') {
        for (const update of annotationMessage.updates) {
          this.sql`
            UPDATE annotation_features
            SET sort_key = ${update.sortKey}, revision = revision + 1, updated_at = ${Date.now()}
            WHERE feature_id = ${update.featureId}
          `;
        }
        const features = this._listAnnotationFeatures();
        connection.send(encodeMessage({ type: 'annotation-feature:reordered', features }));
        this.broadcast(encodeMessage({ type: 'annotation-feature:reordered', features }), [connection.id]);
        return;
      }
    }

    if (payload.type === 'file:content:request') {
      const contentHash = sanitizeContentHash(payload.contentHash);
      if (!contentHash) return;
      const content = this._getFileContent(contentHash);
      if (!content) return;
      connection.send(encodeFileContentFrame(contentHash, content));
      return;
    }

    if (
      typeof payload.type === 'string' &&
      (payload.type.startsWith('overlay:') || payload.type.startsWith('drawing:'))
    ) {
      connection.send(
        encodeMessage({
          type: 'protocol:error',
          reason: 'unsupported-protocol',
          message: 'Use layer, annotation-feature, and file:content messages.',
        }),
      );
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
    await this._ensureLayerStorage();
    const room = this.sql<{ persistence: RoomPersistence; expires_at: number | null }>`
      SELECT persistence, expires_at FROM room_meta WHERE room_id = ${this.name} LIMIT 1
    `[0];
    if (!room || room.persistence === 'persistent') return;
    if (room.expires_at && Number(room.expires_at) > Date.now()) {
      this._pruneAgentParticipants();
      await this.ctx.storage.setAlarm(Number(room.expires_at) + 60_000);
      return;
    }
    this.sql`DELETE FROM layers`;
    this.sql`DELETE FROM annotation_features`;
    this.sql`DELETE FROM file_contents`;
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
