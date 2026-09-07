import type { Connection, WSMessage } from 'partyserver';
import { encodeMessage, isRecord } from './json-utils.js';
import { handleClientUpdateMessage } from './room-client-update.js';
import {
  decodeFileContentFrame,
  encodeFileContentFrame,
  sanitizeContentHash,
  toArrayBuffer,
} from './room-file-content.js';
import { handleSyncMessage, rejectSyncProtocol } from './room-sync.js';
import type { RoomMessageContext } from './room-message-types.js';
import type { PeerState } from './room-types.js';

export type { RoomMessageContext } from './room-message-types.js';

export async function handleRoomSocketMessage(
  room: RoomMessageContext,
  connection: Connection<PeerState>,
  message: WSMessage,
): Promise<void> {
  if (connection.state?.syncProtocol !== 2) {
    rejectSyncProtocol(connection);
    return;
  }
  if (typeof message !== 'string') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'file:content:upload' }));
      return;
    }
    const frame = decodeFileContentFrame(message);
    if (!frame) return;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(frame.content)))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== frame.contentHash) {
      connection.send(encodeMessage({ type: 'sync:error', reason: 'content-hash-mismatch' }));
      return;
    }
    if (!room._canEdit(connection)) return;
    room._pruneUnreferencedFileContent();
    const existing = room.sql<{ content_hash: string }>`
      SELECT content_hash FROM file_contents WHERE content_hash = ${frame.contentHash} LIMIT 1
    `[0];
    if (existing) {
      connection.send(encodeMessage({ type: 'file:content:stored', contentHash: frame.contentHash }));
      return;
    }
    const contentBuffer = toArrayBuffer(frame.content);
    room.ctx.storage.sql.exec(
      `
      INSERT OR REPLACE INTO file_contents (content_hash, bytes, byte_length, created_at)
      VALUES (?, ?, ?, ?)
    `,
      frame.contentHash,
      contentBuffer,
      frame.content.byteLength,
      Date.now(),
    );
    connection.send(encodeMessage({ type: 'file:content:stored', contentHash: frame.contentHash }));
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return;
  }
  if (!isRecord(payload)) return;

  if (payload.type === 'room:status:request') {
    connection.send(encodeMessage({ type: 'room:status', ...room._roomStatus() }));
    return;
  }

  if (payload.type === 'room:update') {
    if (!room._canManage(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'room:update' }));
      return;
    }
    const persistence =
      payload.persistence === 'persistent' ? 'persistent' : payload.persistence === 'ephemeral' ? 'ephemeral' : null;
    if (!persistence) return;
    const status = await room._setRoomPersistence(persistence);
    const response = { type: 'room:updated', ...status };
    connection.send(encodeMessage(response));
    room.broadcast(encodeMessage(response), [connection.id]);
    return;
  }

  if (await handleSyncMessage(room, connection, payload)) return;
  if (typeof payload.type === 'string' && /^(layer|annotation-feature|overlay|drawing):/.test(payload.type)) {
    rejectSyncProtocol(connection);
    return;
  }

  if (payload.type === 'file:content:request') {
    const contentHash = sanitizeContentHash(payload.contentHash);
    if (!contentHash) return;
    const content = room._getFileContent(contentHash);
    if (!content) return;
    connection.send(encodeFileContentFrame(contentHash, content));
    return;
  }

  handleClientUpdateMessage(room, connection, payload);
}
