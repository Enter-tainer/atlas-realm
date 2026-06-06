import type { Connection } from 'partyserver';
import { sanitizeLayer, type FileLayer, type FileLayerPayload } from '../layer-model.js';
import { parseLayerClientMessage } from '../layer-sync.js';
import { encodeMessage, isRecord } from './json-utils.js';
import type { RoomMessageContext, MessageHandlerResult } from './room-message-types.js';
import type { PeerState } from './room-types.js';

export async function handleLayerMessage(
  room: RoomMessageContext,
  connection: Connection<PeerState>,
  payload: Record<string, unknown>,
): Promise<MessageHandlerResult> {
  const layerMessage = parseLayerClientMessage(payload);
  if (!layerMessage) return 'unhandled';
  if (layerMessage.type === 'layer:list:request') {
    connection.send(encodeMessage({ type: 'layer:list', layers: room._listLayers() }));
    return 'handled';
  }
  if (layerMessage.type === 'layer:create') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'layer:create' }));
      return 'handled';
    }
    const existing = room._getLayer(layerMessage.layer.id);
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
    if (!layer) return 'handled';
    if (layer.kind === 'file') {
      const fileLayer = layer as FileLayer;
      const hasContent =
        room.sql<{ content_hash: string }>`
          SELECT content_hash FROM file_contents WHERE content_hash = ${fileLayer.payload.contentHash} LIMIT 1
        `.length > 0;
      if (!hasContent) {
        connection.send(encodeMessage({ type: 'file:content:needed', contentHash: fileLayer.payload.contentHash }));
        return 'handled';
      }
    }
    room._upsertLayerRow(layer);
    if (existing?.kind === 'file') room._pruneUnreferencedFileContent({ immediate: true });
    connection.send(encodeMessage({ type: 'layer:created', layer }));
    room.broadcast(encodeMessage({ type: 'layer:created', layer }), [connection.id]);
    return 'handled';
  }
  if (layerMessage.type === 'layer:update') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'layer:update' }));
      return 'handled';
    }
    const existing = room._getLayer(layerMessage.layerId);
    if (!existing) return 'handled';
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
    if (!next) return 'handled';
    room._upsertLayerRow(next);
    connection.send(encodeMessage({ type: 'layer:updated', layer: next }));
    room.broadcast(encodeMessage({ type: 'layer:updated', layer: next }), [connection.id]);
    return 'handled';
  }
  if (layerMessage.type === 'layer:delete') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'layer:delete' }));
      return 'handled';
    }
    const existing = room._getLayer(layerMessage.layerId);
    if (!existing) return 'handled';
    void room.sql`DELETE FROM annotation_features WHERE layer_id = ${layerMessage.layerId}`;
    void room.sql`DELETE FROM layers WHERE layer_id = ${layerMessage.layerId}`;
    if (existing.kind === 'file') room._pruneUnreferencedFileContent({ immediate: true });
    connection.send(encodeMessage({ type: 'layer:deleted', layerId: layerMessage.layerId }));
    room.broadcast(encodeMessage({ type: 'layer:deleted', layerId: layerMessage.layerId }), [connection.id]);
    return 'handled';
  }
  if (layerMessage.type === 'layer:reorder') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'layer:reorder' }));
      return 'handled';
    }
    for (const update of layerMessage.updates) {
      const existing = room._getLayer(update.layerId);
      if (!existing) continue;
      void room.sql`
        UPDATE layers
        SET sort_key = ${update.sortKey}, revision = ${existing.revision + 1}, updated_at = ${Date.now()}
        WHERE layer_id = ${update.layerId}
      `;
    }
    const layers = room._listLayers();
    connection.send(encodeMessage({ type: 'layer:reordered', layers }));
    room.broadcast(encodeMessage({ type: 'layer:reordered', layers }), [connection.id]);
    return 'handled';
  }
  return 'handled';
}
