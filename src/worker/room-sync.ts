import type { Connection } from 'partyserver';
import {
  CLIENT_LEASE_MS,
  MAX_BATCH_BYTES,
  MAX_BATCH_COMMANDS,
  MAX_RESULT_BYTES,
  ROOM_SYNC_VERSION,
  stableJson,
  type RoomCommand,
  type BatchResult,
} from '../room-sync-protocol.js';
import { sanitizeEntityId } from '../layer-model.js';
import { encodeMessage, isRecord } from './json-utils.js';
import { CommandError, executeCommands } from './room-sync-commands.js';
import type { RoomMessageContext } from './room-message-types.js';
import type { PeerState } from './room-types.js';

type ClientRow = {
  client_id: string;
  owner_id: string;
  connection_id: string;
  last_seq: number;
  request_hash: string;
  result_json: string | null;
  expires_at: number;
};
type ClientRowWithCreation = { client_id: string; connection_id: string; created_at: number };
// One owner may not register more than this many fresh sync clients per
// minute. This is the only hard client_limit: it stops registration floods.
const RECENT_REGISTRATION_LIMIT = 16;
// Absolute row budgets for sync_clients. Reaching a cap no longer rejects
// sync:open — rows are evicted to make room (dead rows first, oldest first,
// then the oldest live rows). An evicted client recovers through the
// client_expired path, so the caps bound storage without bricking clients.
const OWNED_CLIENT_CAP = 128;
const TOTAL_CLIENT_CAP = 1024;
const encoder = new TextEncoder();
function owner(connection: Connection<PeerState>) {
  return connection.state?.auth?.userId || connection.state?.user?.id || connection.id;
}
function connectionKey(connection: Connection<PeerState>) {
  return connection.state?.syncConnectionToken || connection.id;
}
function getState(room: RoomMessageContext) {
  return room.sql<{ epoch: string; seq: number }>`SELECT epoch, seq FROM sync_state WHERE singleton = 1`[0];
}
function getClient(room: RoomMessageContext, id: string) {
  return room.sql<ClientRow>`SELECT * FROM sync_clients WHERE client_id = ${id}`[0];
}
/**
 * Keep sync_clients inside its per-owner and room-wide budgets. The lease lasts
 * a week, so workflows that register one client per invocation (the CLI) used
 * to hit the caps and get every later connection rejected with an opaque
 * client_limit. Instead of rejecting, evict rows to make room — rows without a
 * live connection first, oldest first, and only then the oldest live rows so
 * the caps stay absolute even against an owner that holds many connections
 * open. An evicted client only loses its resume slot and re-registers through
 * the existing client_expired recovery.
 */
function evictSyncClients(room: RoomMessageContext, ownerId: string): void {
  const live = room._liveSyncConnectionKeys();
  const evictable = (rows: ClientRowWithCreation[], cap: number) => {
    const oldestFirst = (a: ClientRowWithCreation, b: ClientRowWithCreation) =>
      a.created_at - b.created_at || a.client_id.localeCompare(b.client_id);
    const dead = rows.filter((row) => !live.has(row.connection_id)).sort(oldestFirst);
    const liveRows = rows.filter((row) => live.has(row.connection_id)).sort(oldestFirst);
    return [...dead, ...liveRows].slice(0, Math.max(0, rows.length - (cap - 1)));
  };
  const owned = room.sql<ClientRowWithCreation>`SELECT client_id, connection_id, created_at FROM sync_clients WHERE owner_id = ${ownerId}`;
  for (const row of evictable(owned, OWNED_CLIENT_CAP))
    void room.sql`DELETE FROM sync_clients WHERE client_id = ${row.client_id}`;
  const total = room.sql<{ count: number }>`SELECT COUNT(*) AS count FROM sync_clients`[0].count;
  if (total < TOTAL_CLIENT_CAP) return;
  const allRows = room.sql<ClientRowWithCreation>`SELECT client_id, connection_id, created_at FROM sync_clients`;
  for (const row of evictable(allRows, TOTAL_CLIENT_CAP))
    void room.sql`DELETE FROM sync_clients WHERE client_id = ${row.client_id}`;
}
export function rejectSyncProtocol(connection: Connection<PeerState>) {
  connection.send(encodeMessage({ type: 'protocol:error', reason: 'upgrade-required', protocol: ROOM_SYNC_VERSION }));
  connection.close(1008, 'Sync protocol v2 required. Refresh or upgrade.');
}
function error(room: RoomMessageContext, connection: Connection<PeerState>, reason: string, extra = {}) {
  room.recordSyncMetric?.({ event: 'error', reason });
  connection.send(encodeMessage({ type: 'sync:error', reason, ...extra }));
}
function snapshot(room: RoomMessageContext, connection: Connection<PeerState>, client?: ClientRow) {
  const state = getState(room);
  const encoded = encodeMessage({
    type: 'sync:snapshot',
    protocol: 2,
    epoch: state.epoch,
    commitVersion: state.seq,
    clientId: client?.client_id || null,
    lastProcessedSeq: client?.last_seq || 0,
    lastResult: client?.result_json ? JSON.parse(client.result_json) : null,
    layers: room._listLayers(),
    features: room._listAnnotationFeatures(),
  });
  room.recordSyncMetric?.({ event: 'snapshot', bytes: encoder.encode(encoded).byteLength });
  connection.send(encoded);
}
function validCommand(value: unknown): value is RoomCommand {
  if (!isRecord(value) || (value.kind !== 'layer' && value.kind !== 'feature')) return false;
  if (value.type === 'create') return Boolean(sanitizeEntityId(value.localId) && isRecord(value.data));
  if (!sanitizeEntityId(value.id)) return false;
  if (value.type === 'delete') return true;
  if (value.type === 'move')
    return (
      (value.beforeId === null || Boolean(sanitizeEntityId(value.beforeId))) &&
      Number.isSafeInteger(value.expectedVersion) &&
      Number(value.expectedVersion) >= 0
    );
  if (
    value.type !== 'patch' ||
    !isRecord(value.fields) ||
    !Object.keys(value.fields).length ||
    Object.keys(value.fields).length > 16
  )
    return false;
  return Object.entries(value.fields).every(
    ([field, edit]) =>
      /^[a-zA-Z]{1,24}$/.test(field) &&
      isRecord(edit) &&
      Object.hasOwn(edit, 'value') &&
      Number.isSafeInteger(edit.expectedVersion) &&
      Number(edit.expectedVersion) >= 0,
  );
}
export async function handleSyncMessage(
  room: RoomMessageContext,
  connection: Connection<PeerState>,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (typeof payload.type !== 'string' || !payload.type.startsWith('sync:')) return false;
  if (payload.protocol !== 2) {
    rejectSyncProtocol(connection);
    return true;
  }
  if (payload.type === 'sync:stats:request') {
    if (!room._canManage(connection)) error(room, connection, 'permission-denied');
    else connection.send(encodeMessage({ type: 'sync:stats', ...room.readSyncMetrics?.() }));
    return true;
  }
  const started = performance.now();
  const now = Date.now();
  const ownerId = owner(connection);
  if (payload.type === 'sync:open') {
    const state = getState(room);
    if (payload.clientId) {
      const client = getClient(room, String(payload.clientId));
      if (payload.epoch !== state.epoch || !client || client.expires_at <= now) {
        error(room, connection, 'client_expired');
        return true;
      }
      if (client.owner_id !== ownerId) {
        error(room, connection, 'client_forbidden');
        return true;
      }
      void room.sql`UPDATE sync_clients SET connection_id = ${connectionKey(connection)}, expires_at = ${now + CLIENT_LEASE_MS} WHERE client_id = ${client.client_id}`;
      snapshot(room, connection, { ...client, connection_id: connectionKey(connection) });
      return true;
    }
    if (!room._canEdit(connection)) {
      snapshot(room, connection);
      return true;
    }
    void room.sql`DELETE FROM sync_clients WHERE expires_at <= ${now}`;
    const recent = room.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM sync_clients WHERE owner_id = ${ownerId} AND created_at > ${now - 60_000}
    `[0].count;
    if (recent >= RECENT_REGISTRATION_LIMIT) {
      error(room, connection, 'client_limit', { limit: 'recent-registrations-per-minute' });
      return true;
    }
    evictSyncClients(room, ownerId);
    const id = crypto.randomUUID();
    void room.sql`INSERT INTO sync_clients (client_id, owner_id, connection_id, created_at, expires_at) VALUES (${id}, ${ownerId}, ${connectionKey(connection)}, ${now}, ${now + CLIENT_LEASE_MS})`;
    snapshot(room, connection, getClient(room, id));
    return true;
  }
  const state = getState(room);
  const clientId = sanitizeEntityId(payload.clientId);
  const client = getClient(room, clientId);
  if (payload.type === 'sync:request' && !clientId) {
    snapshot(room, connection);
    return true;
  }
  if (!client || client.expires_at <= now || payload.epoch !== state.epoch) {
    error(room, connection, 'client_expired');
    return true;
  }
  if (client.owner_id !== ownerId) {
    error(room, connection, 'client_forbidden');
    return true;
  }
  if (client.connection_id !== connectionKey(connection)) {
    error(room, connection, 'client_fenced');
    return true;
  }
  if (payload.type === 'sync:request') {
    snapshot(room, connection, client);
    return true;
  }
  if (payload.type !== 'sync:submit') {
    error(room, connection, 'invalid-message');
    return true;
  }
  const body = stableJson(payload);
  if (
    !Number.isSafeInteger(payload.seq) ||
    Number(payload.seq) < 1 ||
    !Array.isArray(payload.commands) ||
    !payload.commands.length ||
    payload.commands.length > MAX_BATCH_COMMANDS ||
    !payload.commands.every(validCommand) ||
    encoder.encode(body).byteLength > MAX_BATCH_BYTES
  ) {
    error(room, connection, 'invalid-batch');
    return true;
  }
  room.recordSyncMetric?.({
    event: 'submit',
    bytes: encoder.encode(body).byteLength,
    commands: payload.commands.length,
  });
  let replayed = false;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  const seq = Number(payload.seq);
  let delta: ReturnType<typeof executeCommands>['delta'] | undefined;
  let current: Record<string, unknown> | undefined;
  let transient: { reason: string; contentHash?: string } | undefined;
  const result = room.ctx.storage.transactionSync((): BatchResult | null => {
    // Hashing yielded: re-read authorization, lease and fencing inside the commit transaction.
    const live = getClient(room, clientId);
    if (!live || live.expires_at <= Date.now() || getState(room).epoch !== payload.epoch) {
      transient = { reason: 'client_expired' };
      return null;
    }
    if (live.connection_id !== connectionKey(connection)) {
      transient = { reason: 'client_fenced' };
      return null;
    }
    if (seq === live.last_seq) {
      if (live.request_hash !== hash) {
        transient = { reason: 'sequence-reused' };
        return null;
      }
      replayed = true;
      return JSON.parse(live.result_json!);
    }
    if (seq !== live.last_seq + 1) {
      transient = { reason: seq < live.last_seq ? 'already_processed' : 'sequence-gap' };
      return null;
    }
    const version = getState(room).seq;
    let result: BatchResult = { seq, status: 'rejected', commitVersion: version, ids: {}, versions: {} };
    if (!room._canEdit(connection)) result.reason = 'permission-denied';
    else {
      try {
        const batch = executeCommands(
          room,
          payload.commands as RoomCommand[],
          version + 1,
          connection.state?.user?.name || ownerId,
        );
        result = {
          seq,
          status: 'accepted',
          commitVersion: batch.changed ? version + 1 : version,
          ids: batch.ids,
          versions: batch.versions,
        };
        if (encoder.encode(JSON.stringify(result)).byteLength > MAX_RESULT_BYTES) {
          transient = { reason: 'batch-result-too-large' };
          return null;
        }
        batch.persist();
        if (batch.changed) {
          void room.sql`UPDATE sync_state SET seq = ${version + 1} WHERE singleton = 1`;
          delta = batch.delta;
        }
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        if (e.reason === 'content_needed') {
          transient = { reason: e.reason, contentHash: e.contentHash };
          return null;
        }
        result.reason = e.reason;
        result.commandIndex = e.index;
        current = e.current;
      }
    }
    void room.sql`UPDATE sync_clients SET last_seq = ${seq}, request_hash = ${hash}, result_json = ${JSON.stringify(result)}, expires_at = ${Date.now() + CLIENT_LEASE_MS} WHERE client_id = ${clientId}`;
    return result;
  });
  if (!result) {
    error(room, connection, transient?.reason || 'retry', {
      seq,
      ...(transient?.contentHash ? { contentHash: transient.contentHash } : {}),
    });
    return true;
  }
  room.recordSyncMetric?.({
    event: 'result',
    durationMs: performance.now() - started,
    reason: replayed ? 'replayed' : result.reason || result.status,
  });
  connection.send(
    encodeMessage({
      type: 'sync:result',
      epoch: state.epoch,
      clientId,
      result,
      ...(delta ? { delta } : {}),
      ...(current ? { current } : {}),
    }),
  );
  if (delta)
    room.broadcast(
      encodeMessage({ type: 'sync:commit', epoch: state.epoch, commitVersion: result.commitVersion, delta }),
      [connection.id],
    );
  return true;
}
