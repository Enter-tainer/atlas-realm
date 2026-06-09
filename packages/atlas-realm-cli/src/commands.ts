import { writeFile } from 'node:fs/promises';
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
import { CliCommandError } from './errors.js';
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
  RoomPersistence,
  RoomClientLike,
  RoomEvent,
} from './types.js';

const DEFAULT_ANNOTATION_LAYER_ID = 'annotation-default';
const FEATURE_TYPES = new Set(['point', 'text', 'path', 'polygon', 'route']);

export async function executeCommand(client: RoomClientLike, command: Command): Promise<CommandResponse> {
  if (command.subject === 'snapshot' || command.subject === 'status') {
    return { result: await snapshotResult(client, command.content === true) };
  }
  if (['room', 'rooms'].includes(command.subject)) return handleRoomCommand(client, command.action, command);
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

export async function handleRoomCommand(
  client: RoomClientLike,
  action: string | undefined,
  command: Command,
): Promise<CommandResponse> {
  if (action === 'status' || action === 'get' || action === 'list' || !action) {
    const roomStatus = await requestRoomStatus(client);
    return {
      result: { ok: true, room: client.config.room, roomStatus },
      human: (data: JsonRecord) =>
        `${data.roomStatus.room}\t${data.roomStatus.persistence}\t${data.roomStatus.expiresAt || ''}`,
    };
  }

  if (action === 'update' || action === 'set' || action === 'persistence') {
    const roomStatus = await applyRoomPersistence(client, command.persistence);
    return {
      result: { ok: true, room: client.config.room, roomStatus },
      human: (data: JsonRecord) => `Updated room ${data.roomStatus.room} persistence to ${data.roomStatus.persistence}`,
    };
  }

  throw new Error(`Unknown room command: ${action}`);
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

  if (action === 'metadata' || action === 'info') {
    const layer = getLayer(client.layers, command.id);
    if (!layer) throw new Error(`Layer not found: ${command.id}`);
    return { result: { ok: true, room: client.config.room, layer } };
  }

  if (action === 'get' || action === 'content') {
    const layer = getLayer(client.layers, command.id);
    if (!layer) throw new Error(`Layer not found: ${command.id}`);
    return { result: await layerContentResult(client, layer) };
  }

  if (action === 'export') {
    const layer = getLayer(client.layers, command.id);
    if (!layer) throw new Error(`Layer not found: ${command.id}`);
    return exportLayerContent(client, layer, command.out);
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
    const roomStatus = await applyRoomPersistence(client, command.persistence, { optional: true });
    return {
      result: { ok: true, room: client.config.room, layer: ack.json.layer, roomStatus },
      human: (data: JsonRecord) => `Upserted layer ${data.layer.id}`,
    };
  }

  if (action === 'show' || action === 'hide') command.visible = action === 'show';
  if (action === 'update' || action === 'patch' || action === 'show' || action === 'hide') {
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

  if (action === 'clear') {
    return {
      result: await clearAnnotationLayer(client, command.layerId || command.id || DEFAULT_ANNOTATION_LAYER_ID, command),
      human: (data: JsonRecord) => `Deleted ${data.deletedIds.length} annotations from ${data.layerId}`,
    };
  }

  if (action === 'add' || action === 'upsert') {
    const payload = await buildFeatureFromOptions(command, client.config, command.featureType);
    await ensureAnnotationLayer(client, payload.layerId, command);
    const feature = annotationFeatureFromPayload(client, payload);
    client.sendJson({ type: 'annotation-feature:upsert', feature });
    const ack = await waitForFeatureMutation(client, feature, 'upsert');
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
    await ensureAnnotationLayer(client, payload.layerId, command);
    const feature = annotationFeatureFromPayload(client, payload, existing);
    client.sendJson({ type: 'annotation-feature:upsert', feature });
    const ack = await waitForFeatureMutation(client, feature, 'update');
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

  if (action === 'clear') {
    const id = command.id || command.layerId || DEFAULT_ANNOTATION_LAYER_ID;
    return {
      result: await clearAnnotationLayer(client, id, command),
      human: (data: JsonRecord) => `Deleted ${data.deletedIds.length} annotations from ${data.layerId}`,
    };
  }

  if (action === 'show' || action === 'hide') {
    const id = command.id;
    if (!id) throw new Error('annotation layers show/hide requires a layer id');
    const existing = getLayer(client.layers, id);
    if (!existing || existing.kind !== 'annotation') throw new Error(`Annotation layer not found: ${id}`);
    const layer = await patchLayerVisibility(client, id, action === 'show', 'annotation layer');
    return {
      result: { ok: true, room: client.config.room, layer },
      human: (data: JsonRecord) => `Updated annotation layer ${data.layer.id}`,
    };
  }

  if (action === 'add' || action === 'create' || action === 'upsert' || action === 'update') {
    const id = normalizeId(command.id, DEFAULT_ANNOTATION_LAYER_ID);
    const existing = getLayer(client.layers, id);
    const now = Date.now();
    if (existing) {
      if (existing.kind !== 'annotation') throw annotationLayerWrongKindError(client, id, existing.kind);
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

async function ensureAnnotationLayer(client: RoomClientLike, layerId: string, command: Command): Promise<Layer> {
  const existing = getLayer(client.layers, layerId);
  if (existing?.kind === 'annotation') return existing;
  if (existing) throw annotationLayerWrongKindError(client, layerId, existing.kind);
  if (!command.ensureLayer) throw annotationLayerNotFoundError(client, layerId, command);

  const now = Date.now();
  const layer: Layer = {
    id: layerId,
    kind: 'annotation',
    name: normalizeName(command.name, layerId === DEFAULT_ANNOTATION_LAYER_ID ? 'Annotations' : layerId, 80),
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
    (event: RoomEvent) => event.json?.type === 'layer:created' && event.json.layer?.id === layerId,
    `annotation layer create ${layerId}`,
  );
  return ack.json.layer;
}

async function waitForFeatureMutation(
  client: RoomClientLike,
  feature: AnnotationFeature,
  label: string,
): Promise<RoomEvent> {
  const ack = await client.waitFor(
    (event: RoomEvent) =>
      (event.json?.type === 'annotation-feature:upserted' && event.json.feature?.id === feature.id) ||
      (event.json?.type === 'annotation-feature:rejected' && event.json.featureId === feature.id),
    `annotation feature ${label} ${feature.id}`,
  );
  if (ack.json.type === 'annotation-feature:rejected') {
    const layerId = String(ack.json.layerId || feature.layerId);
    if (ack.json.reason === 'missing-layer') throw annotationLayerNotFoundError(client, layerId);
    if (ack.json.reason === 'wrong-layer-kind') {
      throw annotationLayerWrongKindError(client, layerId, ack.json.layerKind);
    }
    throw new CliCommandError(
      'annotation_feature_rejected',
      `Annotation feature rejected: ${ack.json.reason || 'unknown'}`,
      {
        featureId: feature.id,
        layerId,
        reason: ack.json.reason || 'unknown',
      },
    );
  }
  return ack;
}

function annotationLayerNotFoundError(client: RoomClientLike, layerId: string, command: Command = {}): CliCommandError {
  const existingAnnotationLayerIds = sortedLayers(client.layers)
    .filter((layer) => layer.kind === 'annotation')
    .map((layer) => layer.id);
  const suggestedCommand = annotationLayerCreateCommand(layerId, command.name);
  const existing = existingAnnotationLayerIds.length ? existingAnnotationLayerIds.join(', ') : 'none';
  return new CliCommandError(
    'annotation_layer_not_found',
    [
      `Annotation layer not found: ${layerId}.`,
      'Create it first:',
      `  ${suggestedCommand}`,
      'Or retry the annotation command with --ensure-layer.',
      `Existing annotation layers: ${existing}`,
    ].join('\n'),
    {
      layerId,
      existingAnnotationLayerIds,
      suggestedCommand,
      ensureFlag: '--ensure-layer',
    },
  );
}

function annotationLayerWrongKindError(
  client: RoomClientLike,
  layerId: string,
  layerKind = 'unknown',
): CliCommandError {
  const existingAnnotationLayerIds = sortedLayers(client.layers)
    .filter((layer) => layer.kind === 'annotation')
    .map((layer) => layer.id);
  const existing = existingAnnotationLayerIds.length ? existingAnnotationLayerIds.join(', ') : 'none';
  return new CliCommandError(
    'annotation_layer_wrong_kind',
    [
      `Layer ${layerId} is a ${layerKind} layer, not an annotation layer.`,
      'Choose an annotation layer id, or create a new annotation layer with a different id.',
      `Existing annotation layers: ${existing}`,
    ].join('\n'),
    {
      layerId,
      layerKind,
      existingAnnotationLayerIds,
    },
  );
}

function annotationLayerCreateCommand(layerId: string, name: unknown): string {
  const parts = ['atlas-realm', 'annotations', 'layers', 'create', shellQuote(layerId)];
  if (name !== undefined) parts.push('--name', shellQuote(normalizeName(name, String(name), 80)));
  return parts.join(' ');
}

function shellQuote(value: unknown): string {
  const text = String(value);
  return /^[0-9A-Za-z_./:=@-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

async function snapshotResult(client: RoomClientLike, includeContent: boolean): Promise<JsonRecord> {
  const layers = sortedLayers(client.layers);
  const result: JsonRecord = {
    ok: true,
    room: client.config.room,
    roomStatus: client.roomStatus || null,
    layers,
    annotations: sortedAnnotationFeatures(client.annotationFeatures),
    presence: {
      peers: client.peers,
      agents: client.agents,
    },
  };
  if (includeContent)
    result.layerContents = await Promise.all(layers.map((layer) => layerContentResult(client, layer)));
  return result;
}

async function requestRoomStatus(client: RoomClientLike): Promise<JsonRecord> {
  client.sendJson({ type: 'room:status:request' });
  const ack = await client.waitFor((event: RoomEvent) => event.json?.type === 'room:status', 'room status');
  return ack.json;
}

async function applyRoomPersistence(
  client: RoomClientLike,
  persistence: RoomPersistence | undefined,
  { optional = false }: { optional?: boolean } = {},
): Promise<JsonRecord | null> {
  if (!persistence && optional) return null;
  if (persistence !== 'ephemeral' && persistence !== 'persistent') {
    throw new Error('room persistence must be "ephemeral" or "persistent"');
  }
  client.sendJson({ type: 'room:update', persistence });
  const ack = await client.waitFor(
    (event: RoomEvent) => event.json?.type === 'room:updated' && event.json.persistence === persistence,
    `room persistence ${persistence}`,
  );
  return ack.json;
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

async function exportLayerContent(
  client: RoomClientLike,
  layer: Layer,
  out: string | undefined,
): Promise<CommandResponse> {
  const result = await layerContentResult(client, layer);
  if (!out) return { result };
  const exportValue = layer.kind === 'file' ? result.content : result.annotations;
  const text = typeof exportValue === 'string' ? exportValue : `${JSON.stringify(exportValue, null, 2)}\n`;
  await writeFile(out, text, 'utf8');
  return {
    result: {
      ok: true,
      room: client.config.room,
      layer,
      out,
      bytes: Buffer.byteLength(text, 'utf8'),
    },
    human: (data: JsonRecord) => `Exported layer ${data.layer.id} to ${data.out}`,
  };
}

async function clearAnnotationLayer(client: RoomClientLike, layerId: string, command: Command): Promise<JsonRecord> {
  const layer = getLayer(client.layers, layerId);
  if (!layer || layer.kind !== 'annotation') throw new Error(`Annotation layer not found: ${layerId}`);
  const features = sortedAnnotationFeatures(client.annotationFeatures, layerId);
  const deletedIds: string[] = [];
  for (const feature of features) {
    client.sendJson({ type: 'annotation-feature:delete', featureId: feature.id });
    const ack = await client.waitFor(
      (event: RoomEvent) => event.json?.type === 'annotation-feature:deleted' && event.json.featureId === feature.id,
      `annotation feature delete ${feature.id}`,
    );
    deletedIds.push(ack.json.featureId);
  }
  const updatedLayer = command.hideLayer
    ? await patchLayerVisibility(client, layerId, false, 'annotation layer')
    : layer;
  return {
    ok: true,
    room: client.config.room,
    layerId,
    deletedIds,
    layer: updatedLayer,
  };
}

async function patchLayerVisibility(
  client: RoomClientLike,
  layerId: string,
  visible: boolean,
  label = 'layer',
): Promise<Layer> {
  client.sendJson({ type: 'layer:update', layerId, patch: { visible } });
  const ack = await client.waitFor(
    (event: RoomEvent) => event.json?.type === 'layer:updated' && event.json.layer?.id === layerId,
    `${label} visibility ${layerId}`,
  );
  return ack.json.layer;
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
