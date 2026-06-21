import {
  createDefaultAnnotationLayer,
  sanitizeAnnotationFeature,
  sanitizeLayer,
  type AnnotationFeature,
  type Layer,
} from '../layer-model.js';
import { sortAnnotationFeatures, sortLayers } from '../layer-sync.js';
import { EPHEMERAL_ROOM_TTL_MS, SQL_READY_KEY, UNREFERENCED_FILE_CONTENT_TTL_MS } from './room-constants.js';
import type { RoomPersistence } from './room-types.js';

type SqlValue = string | number | boolean | null | ArrayBuffer;

export interface RoomStorageContext {
  name: string;
  ctx: {
    storage: DurableObjectStorage;
  };
  sql<T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): T[];
}

export type RoomStatus = {
  room: string;
  persistence: RoomPersistence;
  lastActiveAt: number;
  expiresAt: number | null;
};

export async function ensureLayerStorage(room: RoomStorageContext): Promise<void> {
  if (await room.ctx.storage.get(SQL_READY_KEY)) return;
  void room.sql`
    CREATE TABLE IF NOT EXISTS room_meta (
      room_id TEXT PRIMARY KEY,
      persistence TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      expires_at INTEGER
    )
  `;
  void room.sql`
    CREATE TABLE IF NOT EXISTS file_contents (
      content_hash TEXT PRIMARY KEY,
      bytes BLOB NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `;
  void room.sql`
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
  void room.sql`CREATE INDEX IF NOT EXISTS layers_sort_idx ON layers(sort_key, created_at, layer_id)`;
  void room.sql`CREATE INDEX IF NOT EXISTS layers_kind_idx ON layers(kind)`;
  void room.sql`
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
  void room.sql`CREATE INDEX IF NOT EXISTS annotation_features_layer_idx ON annotation_features(layer_id, sort_key, created_at, feature_id)`;
  void room.sql`CREATE INDEX IF NOT EXISTS annotation_features_updated_idx ON annotation_features(updated_at)`;
  void room.sql`
    CREATE TABLE IF NOT EXISTS agent_participants (
      agent_id TEXT PRIMARY KEY,
      user_json TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_action TEXT NOT NULL
    )
  `;
  ensureDefaultAnnotationLayer(room);
  await room.ctx.storage.put(SQL_READY_KEY, true);
}

export async function touchRoom(room: RoomStorageContext): Promise<void> {
  await ensureLayerStorage(room);
  const now = Date.now();
  const expiresAt = now + EPHEMERAL_ROOM_TTL_MS;
  const existing = room.sql<{ room_id: string; persistence: RoomPersistence }>`
    SELECT room_id, persistence FROM room_meta WHERE room_id = ${room.name} LIMIT 1
  `;
  if (existing.length === 0) {
    void room.sql`
      INSERT INTO room_meta (room_id, persistence, created_at, last_active_at, expires_at)
      VALUES (${room.name}, ${'ephemeral'}, ${now}, ${now}, ${expiresAt})
    `;
  } else {
    const persistence = existing[0].persistence === 'persistent' ? 'persistent' : 'ephemeral';
    void room.sql`
      UPDATE room_meta
      SET last_active_at = ${now}, expires_at = ${persistence === 'persistent' ? null : expiresAt}
      WHERE room_id = ${room.name}
    `;
  }
  await room.ctx.storage.setAlarm(expiresAt + 60_000);
}

export function roomStatus(room: RoomStorageContext): RoomStatus {
  const row = room.sql<{
    room_id: string;
    persistence: RoomPersistence;
    last_active_at: number;
    expires_at: number | null;
  }>`
    SELECT room_id, persistence, last_active_at, expires_at
    FROM room_meta
    WHERE room_id = ${room.name}
    LIMIT 1
  `[0];
  return {
    room: row?.room_id || room.name,
    persistence: row?.persistence === 'persistent' ? 'persistent' : 'ephemeral',
    lastActiveAt: Number(row?.last_active_at || Date.now()),
    expiresAt: row?.expires_at === null || row?.expires_at === undefined ? null : Number(row.expires_at),
  };
}

export async function setRoomPersistence(room: RoomStorageContext, persistence: RoomPersistence): Promise<RoomStatus> {
  await ensureLayerStorage(room);
  const now = Date.now();
  const existing = room.sql<{ created_at: number }>`
    SELECT created_at FROM room_meta WHERE room_id = ${room.name} LIMIT 1
  `[0];
  const expiresAt = persistence === 'persistent' ? null : now + EPHEMERAL_ROOM_TTL_MS;
  if (existing) {
    void room.sql`
      UPDATE room_meta
      SET persistence = ${persistence}, last_active_at = ${now}, expires_at = ${expiresAt}
      WHERE room_id = ${room.name}
    `;
  } else {
    void room.sql`
      INSERT INTO room_meta (room_id, persistence, created_at, last_active_at, expires_at)
      VALUES (${room.name}, ${persistence}, ${now}, ${now}, ${expiresAt})
    `;
  }
  if (expiresAt) await room.ctx.storage.setAlarm(expiresAt + 60_000);
  return roomStatus(room);
}

export function ensureDefaultAnnotationLayer(room: RoomStorageContext): void {
  const defaultLayer = createDefaultAnnotationLayer();
  const exists = room.sql<{ layer_id: string }>`
    SELECT layer_id FROM layers WHERE layer_id = ${defaultLayer.id} LIMIT 1
  `;
  if (exists.length > 0) return;
  upsertLayerRow(room, defaultLayer);
}

export function upsertLayerRow(room: RoomStorageContext, layer: Layer): void {
  void room.sql`
    INSERT OR REPLACE INTO layers
      (layer_id, kind, name, visible, sort_key, payload_json, revision, created_at, updated_at, updated_by)
    VALUES
      (${layer.id}, ${layer.kind}, ${layer.name}, ${layer.visible ? 1 : 0}, ${layer.sortKey},
       ${JSON.stringify(layer.payload)}, ${layer.revision}, ${layer.createdAt}, ${layer.updatedAt}, ${layer.updatedBy || null})
  `;
}

export function layerFromRow(row: {
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

export function listLayers(room: RoomStorageContext): Layer[] {
  return sortLayers(
    room.sql<{
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
      .map((row) => layerFromRow(row))
      .filter(Boolean),
  );
}

export function getLayer(room: RoomStorageContext, layerId: string): Layer | null {
  const row = room.sql<{
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
  return row ? layerFromRow(row) : null;
}

export function annotationFeatureFromRow(row: {
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

export function listAnnotationFeatures(room: RoomStorageContext, layerId?: string): AnnotationFeature[] {
  const rows = layerId
    ? room.sql<{
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
    : room.sql<{
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
  return sortAnnotationFeatures(rows.map((row) => annotationFeatureFromRow(row)).filter(Boolean));
}

export function getAnnotationFeature(room: RoomStorageContext, featureId: string): AnnotationFeature | null {
  const row = room.sql<{
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
    WHERE feature_id = ${featureId}
    LIMIT 1
  `[0];
  return row ? annotationFeatureFromRow(row) : null;
}

export function upsertAnnotationFeatureRow(room: RoomStorageContext, feature: AnnotationFeature): void {
  void room.sql`
    INSERT OR REPLACE INTO annotation_features
      (feature_id, layer_id, feature_type, feature_json, sort_key, revision, created_at, updated_at, updated_by)
    VALUES
      (${feature.id}, ${feature.layerId}, ${feature.featureType}, ${JSON.stringify(feature.payload)}, ${feature.sortKey},
       ${feature.revision}, ${feature.createdAt}, ${feature.updatedAt}, ${feature.updatedBy})
  `;
}

export function getFileContent(room: RoomStorageContext, contentHash: string): ArrayBuffer | null {
  const rows = room.sql<{ bytes: ArrayBuffer }>`
    SELECT bytes FROM file_contents WHERE content_hash = ${contentHash} LIMIT 1
  `;
  return rows[0]?.bytes || null;
}

export function pruneUnreferencedFileContent(
  room: RoomStorageContext,
  { immediate = false }: { immediate?: boolean } = {},
): void {
  const cutoff = immediate ? Date.now() + 1 : Date.now() - UNREFERENCED_FILE_CONTENT_TTL_MS;
  void room.sql`
    DELETE FROM file_contents
    WHERE content_hash NOT IN (
      SELECT json_extract(payload_json, '$.contentHash') FROM layers WHERE kind = 'file'
    )
    AND created_at < ${cutoff}
  `;
}
