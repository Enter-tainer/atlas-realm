import { buildFeatureFromOptions } from './drawing-feature.js';
import { buildOverlayAsset } from './overlay-asset.js';
import { encodeOverlayBinaryMessage } from './protocol.js';
import { drawingFeatures, drawingLayers, getDrawingFeature, getDrawingLayer } from './room-state.js';
import { annotationLayerListText, annotationListText, overlayListText } from './format.js';
import { coerceBoolean, coerceNumber, normalizeName } from './validation.js';
import type { Command, CommandResponse, JsonRecord, RoomClientLike, RoomEvent } from './types.js';

export async function executeCommand(client: RoomClientLike, command: Command): Promise<CommandResponse> {
  if (command.subject === 'snapshot' || command.subject === 'status') {
    return {
      result: {
        ok: true,
        room: client.config.room,
        overlays: client.overlays,
        drawing: client.drawingDoc,
        presence: {
          peers: client.peers,
          agents: client.agents,
        },
      },
    };
  }
  if (['presence', 'users', 'participants'].includes(command.subject)) {
    return {
      result: {
        ok: true,
        room: client.config.room,
        peers: client.peers,
        agents: client.agents,
      },
    };
  }
  if (['layer', 'layers', 'overlay', 'overlays'].includes(command.subject)) {
    return handleLayerCommand(client, command.action, command);
  }
  if (['annotation', 'annotations', 'drawing', 'drawings'].includes(command.subject)) {
    return handleAnnotationCommand(client, command.action, command);
  }
  throw new Error(`Unknown command: ${command.subject}`);
}

export async function handleLayerCommand(
  client: RoomClientLike,
  action: string | undefined,
  command: Command,
): Promise<CommandResponse> {
  if (action === 'list' || !action) {
    return { result: { ok: true, room: client.config.room, overlays: client.overlays }, human: overlayListText };
  }

  if (action === 'get') {
    const id = command.id;
    const overlay = client.overlays.find((item) => item.id === id);
    if (!overlay) throw new Error(`Layer not found: ${id}`);
    return { result: { ok: true, room: client.config.room, overlay } };
  }

  if (action === 'add' || action === 'upsert') {
    if (!command.file) throw new Error('layers add requires a file path');
    const asset = await buildOverlayAsset(command.file, command);
    client.sendBinary(encodeOverlayBinaryMessage(asset.manifest.contentHash, asset.content));
    await client.waitFor(
      (event: RoomEvent) =>
        event.json?.type === 'overlay:content:stored' && event.json.contentHash === asset.manifest.contentHash,
      `overlay content store ${asset.manifest.contentHash}`,
    );
    client.sendJson({ type: 'overlay:upsert', manifest: asset.manifest });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'overlay:upserted' && event.json.manifest?.id === asset.manifest.id,
      `overlay upsert ${asset.manifest.id}`,
    );
    return {
      result: { ok: true, room: client.config.room, overlay: ack.json.manifest },
      human: (data: JsonRecord) => `Upserted layer ${data.overlay.id}`,
    };
  }

  if (action === 'update' || action === 'patch') {
    const id = command.id;
    if (!id) throw new Error('layers update requires a layer id');
    if (!client.overlays.some((overlay) => overlay.id === id)) throw new Error(`Layer not found: ${id}`);
    const patch = layerPatchFromCommand(command);
    if (Object.keys(patch).length === 0) throw new Error('No layer patch options were provided');
    client.sendJson({ type: 'overlay:patch', overlayId: id, patch });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'overlay:patched' && event.json.manifest?.id === id,
      `overlay patch ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, overlay: ack.json.manifest },
      human: (data: JsonRecord) => `Updated layer ${data.overlay.id}`,
    };
  }

  if (action === 'delete' || action === 'remove' || action === 'rm') {
    const id = command.id;
    if (!id) throw new Error('layers delete requires a layer id');
    client.sendJson({ type: 'overlay:delete', overlayId: id });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'overlay:deleted' && event.json.overlayId === id,
      `overlay delete ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, overlayId: ack.json.overlayId },
      human: (data: JsonRecord) => `Deleted layer ${data.overlayId}`,
    };
  }

  if (action === 'reorder') {
    const orderedIds = command.ids || [];
    if (orderedIds.length === 0) throw new Error('layers reorder requires one or more ids');
    client.sendJson({ type: 'overlay:reorder', orderedIds });
    const ack = await client.waitFor((event: RoomEvent) => event.json?.type === 'overlay:reordered', 'overlay reorder');
    return {
      result: { ok: true, room: client.config.room, orderedIds: ack.json.orderedIds || orderedIds },
      human: (data: JsonRecord) => `Reordered layers: ${data.orderedIds.join(', ')}`,
    };
  }

  throw new Error(`Unknown layer command: ${action}`);
}

export async function handleAnnotationCommand(
  client: RoomClientLike,
  action: string | undefined,
  command: Command,
): Promise<CommandResponse> {
  if (action === 'layers') {
    return handleAnnotationLayerCommand(client, command.layerAction, command);
  }

  if (action === 'list' || !action) {
    return {
      result: { ok: true, room: client.config.room, annotations: drawingFeatures(client.drawingDoc) },
      human: annotationListText,
    };
  }

  if (action === 'get') {
    const feature = getDrawingFeature(client.drawingDoc, command.id);
    if (!feature) throw new Error(`Annotation not found: ${command.id}`);
    return { result: { ok: true, room: client.config.room, annotation: feature } };
  }

  if (action === 'add' || action === 'upsert') {
    const feature = await buildFeatureFromOptions(command, client.config, command.featureType);
    client.sendJson({ type: 'drawing:feature:upsert', feature });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'drawing:feature:upserted' && event.json.feature?.id === feature.id,
      `drawing feature upsert ${feature.id}`,
    );
    return {
      result: { ok: true, room: client.config.room, annotation: ack.json.feature, revision: ack.json.revision },
      human: (data: JsonRecord) => `Upserted annotation ${data.annotation.id}`,
    };
  }

  if (action === 'update' || action === 'patch') {
    if (!command.id) throw new Error('annotations update requires an annotation id');
    const existing = getDrawingFeature(client.drawingDoc, command.id);
    if (!existing) throw new Error(`Annotation not found: ${command.id}`);
    const feature = await buildFeatureFromOptions(
      command,
      client.config,
      command.featureType || existing.type,
      existing,
    );
    client.sendJson({ type: 'drawing:feature:upsert', feature });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'drawing:feature:upserted' && event.json.feature?.id === command.id,
      `drawing feature update ${command.id}`,
    );
    return {
      result: { ok: true, room: client.config.room, annotation: ack.json.feature, revision: ack.json.revision },
      human: (data: JsonRecord) => `Updated annotation ${data.annotation.id}`,
    };
  }

  if (action === 'delete' || action === 'remove' || action === 'rm') {
    if (!command.id) throw new Error('annotations delete requires an annotation id');
    client.sendJson({ type: 'drawing:feature:delete', featureId: command.id });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'drawing:feature:deleted' && event.json.featureId === command.id,
      `drawing feature delete ${command.id}`,
    );
    return {
      result: { ok: true, room: client.config.room, annotationId: ack.json.featureId, revision: ack.json.revision },
      human: (data: JsonRecord) => `Deleted annotation ${data.annotationId}`,
    };
  }

  if (action === 'reorder') {
    const orderedIds = command.ids || [];
    if (orderedIds.length === 0) throw new Error('annotations reorder requires one or more ids');
    client.sendJson({ type: 'drawing:feature:reorder', orderedIds });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'drawing:feature:reordered',
      'drawing reorder',
    );
    return {
      result: { ok: true, room: client.config.room, orderedIds: ack.json.orderedIds, revision: ack.json.revision },
      human: (data: JsonRecord) => `Reordered annotations: ${data.orderedIds.join(', ')}`,
    };
  }

  throw new Error(`Unknown annotation command: ${action}`);
}

export async function handleAnnotationLayerCommand(
  client: RoomClientLike,
  action: string | undefined,
  command: Command,
): Promise<CommandResponse> {
  if (action === 'list' || !action) {
    return {
      result: { ok: true, room: client.config.room, layers: drawingLayers(client.drawingDoc) },
      human: annotationLayerListText,
    };
  }

  if (action === 'upsert' || action === 'update') {
    const id = command.id || 'drawing-default';
    const existing = (getDrawingLayer(client.drawingDoc, id) || {}) as JsonRecord;
    const now = Date.now();
    const layer: JsonRecord = {
      ...existing,
      id,
      name: normalizeName(command.name, existing.name || 'Annotations', 80),
      visible: coerceBoolean(command.visible, existing.visible !== false) !== false,
      createdAt: Number.isFinite(Number(existing.createdAt)) ? Number(existing.createdAt) : now,
      updatedAt: now,
    };
    if (command.stackOrder !== undefined) layer.stackOrder = coerceNumber(command.stackOrder);
    client.sendJson({ type: 'drawing:layer:upsert', layer });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'drawing:layer:upserted' && event.json.layer?.id === id,
      `drawing layer upsert ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, layer: ack.json.layer, revision: ack.json.revision },
      human: (data: JsonRecord) => `Upserted annotation layer ${data.layer.id}`,
    };
  }

  throw new Error(`Unknown annotation layer command: ${action}`);
}

function layerPatchFromCommand(command: Command): JsonRecord {
  const patch: JsonRecord = {};
  if (command.name !== undefined) patch.name = command.name;
  if (command.visible !== undefined) patch.visible = coerceBoolean(command.visible, true);
  if (command.color !== undefined) patch.color = command.color;
  if (command.opacity !== undefined) patch.opacity = coerceNumber(command.opacity);
  if (command.lineWidth !== undefined) patch.lineWidth = coerceNumber(command.lineWidth);
  return patch;
}
