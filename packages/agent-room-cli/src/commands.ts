import { buildFeatureFromOptions } from './annotation-feature.js';
import { buildFileLayerAsset, materializeFileLayerContent, sha256Hex } from './file-layer-asset.js';
import { encodeFileContentMessage } from './protocol.js';
import {
  getAnnotationFeature,
  getLayer,
  nextSortKey,
  reorderUpdates,
  sortedAnnotationFeatures,
  sortedLayers,
} from './room-state.js';
import { annotationLayerListText, annotationListText, layerListText } from './format.js';
import { coerceBoolean, coerceNumber, normalizeId, normalizeName } from './validation.js';
import type {
  AnnotationFeature,
  AnnotationFeaturePayload,
  Command,
  CommandResponse,
  JsonRecord,
  Layer,
  FileLayerPayload,
  FileLayerManifest,
  RoomClientLike,
  RoomEvent,
} from './types.js';

const DEFAULT_ANNOTATION_LAYER_ID = 'annotation-default';
const FEATURE_TYPES = new Set(['point', 'text', 'path', 'polygon', 'route']);

export async function executeCommand(client: RoomClientLike, command: Command): Promise<CommandResponse> {
  if (command.subject === 'snapshot' || command.subject === 'status') {
    return {
      result: {
        ok: true,
        room: client.config.room,
        layers: client.layers,
        annotations: client.annotationFeatures,
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
  if (['layer', 'layers'].includes(command.subject)) {
    return handleLayerCommand(client, command.action, command);
  }
  if (['annotation', 'annotations'].includes(command.subject)) {
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
    return {
      result: { ok: true, room: client.config.room, layers: sortedLayers(client.layers) },
      human: layerListText,
    };
  }

  if (action === 'get' || action === 'content') {
    const layer = getLayer(client.layers, command.id);
    if (!layer) throw new Error(`Layer not found: ${command.id}`);
    return { result: await layerContentResult(client, layer) };
  }

  if (action === 'add' || action === 'upsert') {
    if (!command.file) throw new Error('layers add requires a file path');
    const asset = await buildFileLayerAsset(command.file, command);
    client.sendBinary(encodeFileContentMessage(asset.manifest.contentHash, asset.content));
    await client.waitFor(
      (event: RoomEvent) =>
        event.json?.type === 'file:content:stored' && event.json.contentHash === asset.manifest.contentHash,
      `file content store ${asset.manifest.contentHash}`,
    );
    const existing = getLayer(client.layers, asset.manifest.id);
    const layer = fileLayerFromManifest(asset.manifest, {
      sortKey: command.sortKey || existing?.sortKey || nextSortKey(client.layers.length),
      createdAt: existing?.createdAt,
      updatedBy: client.config.agentName,
    });
    client.sendJson({ type: 'layer:create', layer });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'layer:created' && event.json.layer?.id === layer.id,
      `layer create ${layer.id}`,
    );
    return {
      result: { ok: true, room: client.config.room, layer: ack.json.layer },
      human: (data: JsonRecord) => `Upserted layer ${data.layer.id}`,
    };
  }

  if (action === 'update' || action === 'patch') {
    const id = command.id;
    if (!id) throw new Error('layers update requires a layer id');
    const existing = getLayer(client.layers, id);
    if (!existing) throw new Error(`Layer not found: ${id}`);
    const patch = layerPatchFromCommand(command, existing);
    if (Object.keys(patch).length === 0) throw new Error('No layer patch options were provided');
    client.sendJson({ type: 'layer:update', layerId: id, patch });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'layer:updated' && event.json.layer?.id === id,
      `layer update ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, layer: ack.json.layer },
      human: (data: JsonRecord) => `Updated layer ${data.layer.id}`,
    };
  }

  if (action === 'delete' || action === 'remove' || action === 'rm') {
    const id = command.id;
    if (!id) throw new Error('layers delete requires a layer id');
    client.sendJson({ type: 'layer:delete', layerId: id });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'layer:deleted' && event.json.layerId === id,
      `layer delete ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, layerId: ack.json.layerId },
      human: (data: JsonRecord) => `Deleted layer ${data.layerId}`,
    };
  }

  if (action === 'reorder') {
    const orderedIds = command.ids || [];
    if (orderedIds.length === 0) throw new Error('layers reorder requires one or more ids');
    const updates = reorderUpdates(client.layers, orderedIds, 'layerId');
    client.sendJson({ type: 'layer:reorder', updates });
    const ack = await client.waitFor((event: RoomEvent) => event.json?.type === 'layer:reordered', 'layer reorder');
    const layers = Array.isArray(ack.json.layers) ? ack.json.layers : client.layers;
    return {
      result: { ok: true, room: client.config.room, layers, orderedIds: layers.map((layer: Layer) => layer.id) },
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
      result: {
        ok: true,
        room: client.config.room,
        annotations: sortedAnnotationFeatures(client.annotationFeatures, command.layerId),
      },
      human: annotationListText,
    };
  }

  if (action === 'get' || action === 'content') {
    const feature = getAnnotationFeature(client.annotationFeatures, command.id);
    if (!feature) throw new Error(`Annotation not found: ${command.id}`);
    return { result: { ok: true, room: client.config.room, annotation: feature } };
  }

  if (action === 'add' || action === 'upsert') {
    const payload = await buildFeatureFromOptions(command, client.config, command.featureType);
    const feature = annotationFeatureFromPayload(client, payload);
    client.sendJson({ type: 'annotation-feature:upsert', feature });
    const ack = await waitForFeatureMutation(client, feature.id, 'upsert');
    return {
      result: { ok: true, room: client.config.room, annotation: ack.json.feature },
      human: (data: JsonRecord) => `Upserted annotation ${data.annotation.id}`,
    };
  }

  if (action === 'update' || action === 'patch') {
    if (!command.id) throw new Error('annotations update requires an annotation id');
    const existing = getAnnotationFeature(client.annotationFeatures, command.id);
    if (!existing) throw new Error(`Annotation not found: ${command.id}`);
    const payload = await buildFeatureFromOptions(
      command,
      client.config,
      command.featureType || existing.featureType,
      existing.payload,
    );
    const feature = annotationFeatureFromPayload(client, payload, existing);
    client.sendJson({ type: 'annotation-feature:upsert', feature });
    const ack = await waitForFeatureMutation(client, feature.id, 'update');
    return {
      result: { ok: true, room: client.config.room, annotation: ack.json.feature },
      human: (data: JsonRecord) => `Updated annotation ${data.annotation.id}`,
    };
  }

  if (action === 'delete' || action === 'remove' || action === 'rm') {
    if (!command.id) throw new Error('annotations delete requires an annotation id');
    client.sendJson({ type: 'annotation-feature:delete', featureId: command.id });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'annotation-feature:deleted' && event.json.featureId === command.id,
      `annotation feature delete ${command.id}`,
    );
    return {
      result: { ok: true, room: client.config.room, annotationId: ack.json.featureId },
      human: (data: JsonRecord) => `Deleted annotation ${data.annotationId}`,
    };
  }

  if (action === 'reorder') {
    const orderedIds = command.ids || [];
    if (orderedIds.length === 0) throw new Error('annotations reorder requires one or more ids');
    const targetLayerId = command.layerId || getAnnotationFeature(client.annotationFeatures, orderedIds[0])?.layerId;
    const rows = sortedAnnotationFeatures(client.annotationFeatures, targetLayerId);
    const updates = reorderUpdates(rows, orderedIds, 'featureId');
    client.sendJson({ type: 'annotation-feature:reorder', updates });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'annotation-feature:reordered',
      'annotation feature reorder',
    );
    const features = Array.isArray(ack.json.features) ? ack.json.features : rows;
    return {
      result: {
        ok: true,
        room: client.config.room,
        annotations: features,
        orderedIds: features.map((feature: AnnotationFeature) => feature.id),
      },
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
  const annotationLayers = () => sortedLayers(client.layers).filter((layer) => layer.kind === 'annotation');

  if (action === 'list' || !action) {
    return {
      result: { ok: true, room: client.config.room, layers: annotationLayers() },
      human: annotationLayerListText,
    };
  }

  if (action === 'get' || action === 'content') {
    const layer = getLayer(client.layers, command.id);
    if (!layer || layer.kind !== 'annotation') throw new Error(`Annotation layer not found: ${command.id}`);
    return { result: await layerContentResult(client, layer) };
  }

  if (action === 'add' || action === 'create' || action === 'upsert' || action === 'update') {
    const id = normalizeId(command.id, DEFAULT_ANNOTATION_LAYER_ID);
    const existing = getLayer(client.layers, id);
    const now = Date.now();
    if (existing) {
      const patch = annotationLayerPatchFromCommand(command, existing);
      client.sendJson({ type: 'layer:update', layerId: id, patch });
      const ack = await client.waitFor(
        (event: RoomEvent) => event.json?.type === 'layer:updated' && event.json.layer?.id === id,
        `annotation layer update ${id}`,
      );
      return {
        result: { ok: true, room: client.config.room, layer: ack.json.layer },
        human: (data: JsonRecord) => `Upserted annotation layer ${data.layer.id}`,
      };
    }
    const layer: Layer = {
      id,
      kind: 'annotation',
      name: normalizeName(command.name, 'Annotations', 80),
      visible: coerceBoolean(command.visible, true) !== false,
      sortKey: typeof command.sortKey === 'string' ? command.sortKey : nextSortKey(client.layers.length),
      payload: { version: 1 },
      revision: 0,
      createdAt: now,
      updatedAt: now,
      updatedBy: command.updatedBy || client.config.agentName,
    };
    client.sendJson({ type: 'layer:create', layer });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'layer:created' && event.json.layer?.id === id,
      `annotation layer create ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, layer: ack.json.layer },
      human: (data: JsonRecord) => `Upserted annotation layer ${data.layer.id}`,
    };
  }

  if (action === 'delete' || action === 'remove' || action === 'rm') {
    const id = command.id;
    if (!id) throw new Error('annotation layers delete requires a layer id');
    client.sendJson({ type: 'layer:delete', layerId: id });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'layer:deleted' && event.json.layerId === id,
      `annotation layer delete ${id}`,
    );
    return {
      result: { ok: true, room: client.config.room, layerId: ack.json.layerId },
      human: (data: JsonRecord) => `Deleted annotation layer ${data.layerId}`,
    };
  }

  if (action === 'reorder') {
    const orderedIds = command.ids || [];
    if (orderedIds.length === 0) throw new Error('annotation layers reorder requires one or more ids');
    const updates = reorderUpdates(annotationLayers(), orderedIds, 'layerId');
    client.sendJson({ type: 'layer:reorder', updates });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'layer:reordered',
      'annotation layer reorder',
    );
    const layers = (Array.isArray(ack.json.layers) ? ack.json.layers : client.layers).filter(
      (layer: Layer) => layer.kind === 'annotation',
    );
    return {
      result: { ok: true, room: client.config.room, layers, orderedIds: layers.map((layer: Layer) => layer.id) },
      human: (data: JsonRecord) => `Reordered annotation layers: ${data.orderedIds.join(', ')}`,
    };
  }

  throw new Error(`Unknown annotation layer command: ${action}`);
}

function fileLayerFromManifest(
  manifest: FileLayerManifest,
  options: { sortKey: string; createdAt?: number; updatedBy?: string },
): Layer {
  const now = Date.now();
  return {
    id: manifest.id,
    kind: 'file',
    name: manifest.name,
    visible: manifest.visible !== false,
    sortKey: options.sortKey,
    payload: {
      version: 1,
      fileType: manifest.type,
      contentHash: manifest.contentHash,
      contentType: manifest.contentType,
      contentEncoding: manifest.contentEncoding === 'gzip' ? 'gzip' : 'identity',
      contentByteLength: manifest.contentByteLength,
      rawByteLength: manifest.rawByteLength,
      bounds: manifest.bounds,
      style: {
        color: manifest.color,
        opacity: manifest.opacity,
        lineWidth: manifest.lineWidth,
      },
    },
    revision: 0,
    createdAt: options.createdAt || manifest.createdAt || now,
    updatedAt: now,
    updatedBy: options.updatedBy,
  };
}

function annotationFeatureFromPayload(
  client: RoomClientLike,
  payload: AnnotationFeaturePayload,
  existing = getAnnotationFeature(client.annotationFeatures, payload.id) || undefined,
): AnnotationFeature {
  if (!FEATURE_TYPES.has(payload.type)) throw new Error(`Unsupported annotation type: ${payload.type}`);
  const layerFeatures = sortedAnnotationFeatures(client.annotationFeatures, payload.layerId);
  const now = Date.now();
  return {
    id: payload.id,
    layerId: payload.layerId,
    featureType: payload.type,
    payload,
    sortKey: existing && existing.layerId === payload.layerId ? existing.sortKey : nextSortKey(layerFeatures.length),
    revision: existing?.revision || 0,
    createdAt: existing?.createdAt || payload.createdAt || now,
    updatedAt: now,
    updatedBy: payload.updatedBy || client.config.agentName,
  };
}

async function waitForFeatureMutation(client: RoomClientLike, featureId: string, label: string): Promise<RoomEvent> {
  const ack = await client.waitFor(
    (event: RoomEvent) =>
      (event.json?.type === 'annotation-feature:upserted' && event.json.feature?.id === featureId) ||
      (event.json?.type === 'annotation-feature:rejected' && event.json.featureId === featureId),
    `annotation feature ${label} ${featureId}`,
  );
  if (ack.json.type === 'annotation-feature:rejected') {
    throw new Error(`Annotation feature rejected: ${ack.json.reason || 'unknown'}`);
  }
  return ack;
}

async function layerContentResult(client: RoomClientLike, layer: Layer): Promise<JsonRecord> {
  if (layer.kind === 'annotation') {
    return {
      ok: true,
      room: client.config.room,
      layer,
      annotations: sortedAnnotationFeatures(client.annotationFeatures, layer.id),
    };
  }

  return {
    ok: true,
    room: client.config.room,
    layer,
    content: await fetchFileLayerContent(client, layer),
  };
}

async function fetchFileLayerContent(client: RoomClientLike, layer: Layer): Promise<string | JsonRecord> {
  const payload = layer.payload as FileLayerPayload;
  if (!payload?.contentHash) throw new Error(`File layer is missing content hash: ${layer.id}`);
  client.sendJson({ type: 'file:content:request', contentHash: payload.contentHash });
  const event = await client.waitFor(
    (roomEvent: RoomEvent) => roomEvent.binary?.contentHash === payload.contentHash,
    `file content ${payload.contentHash}`,
  );
  const content = event.binary?.content;
  if (!content) throw new Error(`File content not found: ${payload.contentHash}`);
  const actualHash = sha256Hex(content);
  if (actualHash !== payload.contentHash) {
    throw new Error(`File content hash mismatch: expected ${payload.contentHash}, got ${actualHash}`);
  }
  return materializeFileLayerContent(payload.fileType, content, payload.contentEncoding);
}

function layerPatchFromCommand(command: Command, existing: Layer): JsonRecord {
  const patch: JsonRecord = {};
  if (command.name !== undefined) patch.name = command.name;
  if (command.visible !== undefined) patch.visible = coerceBoolean(command.visible, true);
  if (typeof command.sortKey === 'string') patch.sortKey = command.sortKey;
  if (command.color !== undefined || command.opacity !== undefined || command.lineWidth !== undefined) {
    const style: JsonRecord = {};
    if (command.color !== undefined) style.color = command.color;
    if (command.opacity !== undefined) style.opacity = coerceNumber(command.opacity);
    if (command.lineWidth !== undefined) style.lineWidth = coerceNumber(command.lineWidth);
    if (existing.kind === 'file') patch.payload = { style };
  }
  return patch;
}

function annotationLayerPatchFromCommand(command: Command, existing: Layer): JsonRecord {
  const patch: JsonRecord = {
    payload: { version: 1 },
    updatedBy: command.updatedBy,
  };
  if (command.name !== undefined) patch.name = normalizeName(command.name, existing.name, 80);
  if (command.visible !== undefined) patch.visible = coerceBoolean(command.visible, existing.visible) !== false;
  if (typeof command.sortKey === 'string') patch.sortKey = command.sortKey;
  return patch;
}
