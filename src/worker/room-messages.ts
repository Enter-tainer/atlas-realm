import type { Connection, WSMessage } from 'partyserver';
import { encodeMessage, isRecord } from './json-utils.js';
import { handleAnnotationFeatureMessage } from './room-annotation-messages.js';
import { handleClientUpdateMessage } from './room-client-update.js';
import {
  decodeFileContentFrame,
  encodeFileContentFrame,
  sanitizeContentHash,
  toArrayBuffer,
} from './room-file-content.js';
import { handleLayerMessage } from './room-layer-messages.js';
import type { RoomMessageContext } from './room-message-types.js';
import type { PeerState } from './room-types.js';

export type { RoomMessageContext } from './room-message-types.js';

export async function handleRoomSocketMessage(
  room: RoomMessageContext,
  connection: Connection<PeerState>,
  message: WSMessage,
): Promise<void> {
  if (typeof message !== 'string') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'file:content:upload' }));
      return;
    }
    const frame = decodeFileContentFrame(message);
    if (!frame) return;
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

  if ((await handleLayerMessage(room, connection, payload)) === 'handled') return;
  if ((await handleAnnotationFeatureMessage(room, connection, payload)) === 'handled') return;

  if (payload.type === 'file:content:request') {
    const contentHash = sanitizeContentHash(payload.contentHash);
    if (!contentHash) return;
    const content = room._getFileContent(contentHash);
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

  handleClientUpdateMessage(room, connection, payload);
}
