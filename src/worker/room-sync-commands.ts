import {
  createEntityId,
  sanitizeLayer,
  sanitizeAnnotationFeature,
  type Layer,
  type AnnotationFeature,
} from '../layer-model.js';
import {
  applyFields,
  readFields,
  fieldVersion,
  entityKey,
  equalValue,
  moveRows,
  sortedRows,
  type RoomCommand,
  type RoomDelta,
  type RecordValue,
  type BatchResult,
  type EntityKind,
} from '../room-sync-protocol.js';
import type { RoomMessageContext } from './room-message-types.js';

export class CommandError extends Error {
  constructor(
    public reason: string,
    public index: number,
    public current?: RecordValue,
    public contentHash?: string,
  ) {
    super(reason);
  }
}
export function executeCommands(room: RoomMessageContext, commands: RoomCommand[], version: number, author: string) {
  const layers = new Map<string, Layer | null>();
  const features = new Map<string, AnnotationFeature | null>();
  const deletedLayers = new Set<string>();
  const changedLayers = new Set<string>();
  const changedFeatures = new Set<string>();
  const ids: Record<string, string> = Object.create(null);
  const baseVersions = new Map<string, Record<string, number>>();
  const versions: BatchResult['versions'] = {};
  const now = Date.now();
  let index = 0;
  const fail = (reason: string, current?: RecordValue): never => {
    throw new CommandError(reason, index, current);
  };
  const resolve = (id: string) => ids[id] || id;
  const getLayer = (id: string): Layer | null => {
    if (!layers.has(id)) layers.set(id, room._getLayer(id));
    return layers.get(id) || null;
  };
  const getFeature = (id: string): AnnotationFeature | null => {
    if (!features.has(id)) features.set(id, room._getAnnotationFeature(id));
    const row = features.get(id);
    return row && !deletedLayers.has(row.layerId) ? row : null;
  };
  const get = (kind: EntityKind, id: string) => (kind === 'layer' ? getLayer(id) : getFeature(id));
  const set = (kind: EntityKind, id: string, row: RecordValue | null) => {
    if (kind === 'layer') {
      layers.set(id, row as Layer);
      changedLayers.add(id);
    } else {
      features.set(id, row as AnnotationFeature);
      changedFeatures.add(id);
    }
  };
  const materialize = (value: unknown): any => {
    if (value && typeof value === 'object' && '$content' in value) {
      const hash = String(value.$content);
      const bytes = room._getFileContent(hash);
      if (!bytes) throw new CommandError('content_needed', index, undefined, hash);
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return fail('invalid-content');
      }
    }
    return value;
  };
  const checkFile = (row: Layer) => {
    if (row.kind !== 'file') return;
    const hash = String((row.payload as RecordValue).contentHash);
    if (!room._getFileContent(hash)) throw new CommandError('content_needed', index, undefined, hash);
  };
  const checkParent = (row: AnnotationFeature) => {
    const parent = getLayer(row.layerId);
    if (!parent) fail('parent_missing');
    if (parent.kind !== 'annotation') fail('wrong-layer-kind');
  };
  const siblings = (kind: EntityKind, parent?: string): RecordValue[] => {
    const rows: Map<string, RecordValue> = new Map(
      (kind === 'layer' ? room._listLayers() : room._listAnnotationFeatures(parent)).map((row) => [row.id, row]),
    );
    for (const [id, row] of kind === 'layer' ? layers : features) {
      if (
        !row ||
        (kind === 'feature' &&
          (deletedLayers.has((row as AnnotationFeature).layerId) || (row as AnnotationFeature).layerId !== parent))
      )
        rows.delete(id);
      else rows.set(id, row);
    }
    return [...rows.values()];
  };
  for (index = 0; index < commands.length; index++) {
    const c = commands[index];
    if (c.type === 'create') {
      if (ids[c.localId]) fail('duplicate-local-reference');
      const id = createEntityId(c.kind === 'layer' ? 'layer' : 'feature');
      const data = structuredClone(c.data);
      if (c.kind === 'feature') {
        data.payload = materialize(data.payload);
        data.layerId = resolve(String(data.layerId));
      }
      const rows = siblings(c.kind, data.layerId);
      for (const [position, sibling] of sortedRows(rows).entries()) {
        const sortKey = String((position + 1) * 10).padStart(9, '0');
        if (sibling.sortKey !== sortKey) set(c.kind, sibling.id, { ...sibling, sortKey });
      }
      const sortKey = String((rows.length + 1) * 10).padStart(9, '0');
      const row =
        c.kind === 'layer'
          ? sanitizeLayer({ ...data, id, sortKey, revision: 1, createdAt: now, updatedAt: now, updatedBy: author })
          : sanitizeAnnotationFeature({
              ...data,
              id,
              sortKey,
              revision: 1,
              createdAt: now,
              updatedAt: now,
              updatedBy: author,
            });
      if (!row) fail('invalid-entity');
      if (c.kind === 'layer') checkFile(row as Layer);
      else checkParent(row as AnnotationFeature);
      row.fieldVersions = Object.fromEntries(
        [...Object.keys(readFields(c.kind, row)), 'position'].map((field) => [field, version]),
      );
      ids[c.localId] = id;
      baseVersions.set(entityKey(c.kind, id), {});
      versions[entityKey(c.kind, id)] = row.fieldVersions;
      set(c.kind, id, row);
      continue;
    }
    const id = resolve(c.id);
    const row = get(c.kind, id);
    const key = entityKey(c.kind, id);
    if (row && !baseVersions.has(key)) baseVersions.set(key, { ...row.fieldVersions });
    if (c.type === 'delete') {
      if (!row) continue;
      if (c.kind === 'layer') {
        deletedLayers.add(id);
        for (const [featureId, feature] of features) if (feature?.layerId === id) set('feature', featureId, null);
      }
      set(c.kind, id, null);
      continue;
    }
    if (!row) fail('target_missing');
    if (c.type === 'move') {
      if ((baseVersions.get(key)?.position ?? 0) !== c.expectedVersion)
        fail('revision-conflict', { kind: c.kind, entity: row });
      const beforeId = c.beforeId ? resolve(c.beforeId) : null;
      const rows = siblings(c.kind, c.kind === 'feature' ? (row as AnnotationFeature).layerId : undefined);
      if (beforeId && !rows.some((item) => item.id === beforeId)) fail('anchor_missing');
      const ordered = moveRows(rows, id, beforeId);
      const oldOrder = rows
        .slice()
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((row) => row.id);
      const moved = !equalValue(
        oldOrder,
        ordered.map((row) => row.id),
      );
      for (const item of ordered) {
        if (!moved) break;
        const next: RecordValue = { ...item, fieldVersions: { ...item.fieldVersions }, updatedAt: now };
        if (item.id === id) {
          next.fieldVersions.position = version;
          next.revision++;
        }
        set(c.kind, item.id, next);
      }
      versions[entityKey(c.kind, id)] = {
        ...versions[entityKey(c.kind, id)],
        position: moved ? version : fieldVersion(row, 'position'),
      };
      continue;
    }
    const currentFields = readFields(c.kind, row);
    const values: RecordValue = {};
    for (const [field, edit] of Object.entries(c.fields)) {
      if (!Object.hasOwn(currentFields, field)) fail('invalid-field');
      const value =
        field === 'geometry'
          ? materialize(edit.value)
          : field === 'membership'
            ? resolve(String(edit.value))
            : edit.value;
      if (
        (['name', 'label', 'note', 'color', 'lineStyle', 'membership'].includes(field) && typeof value !== 'string') ||
        (['visible', 'directed'].includes(field) && typeof value !== 'boolean') ||
        (['width', 'height', 'opacity', 'lineWidth', 'fillOpacity'].includes(field) &&
          (typeof value !== 'number' || !Number.isFinite(value))) ||
        (['geometry', 'content'].includes(field) && (!value || typeof value !== 'object' || Array.isArray(value)))
      )
        fail('invalid-field-value');
      if (!equalValue(value, currentFields[field]) && (baseVersions.get(key)?.[field] ?? 0) !== edit.expectedVersion)
        fail('revision-conflict', { kind: c.kind, entity: row });
      values[field] = value;
    }
    const candidate = applyFields(c.kind, row, values);
    const next =
      c.kind === 'layer' ? sanitizeLayer(candidate, now, row as Layer) : sanitizeAnnotationFeature(candidate, now);
    if (!next) fail('invalid-entity');
    if (c.kind === 'layer') checkFile(next as Layer);
    else checkParent(next as AnnotationFeature);
    const nextFields = readFields(c.kind, next);
    let changed = false;
    next.fieldVersions = { ...row.fieldVersions };
    const touched: Record<string, number> = {};
    for (const field of Object.keys(c.fields)) {
      if (!equalValue(currentFields[field], nextFields[field])) {
        changed = true;
        next.fieldVersions[field] = version;
      }
      touched[field] = fieldVersion(next, field);
    }
    versions[entityKey(c.kind, id)] = { ...versions[entityKey(c.kind, id)], ...touched };
    if (changed) {
      next.revision = row.revision + 1;
      next.updatedAt = now;
      next.updatedBy = author;
      if (c.kind === 'feature') {
        (next as AnnotationFeature).payload.updatedAt = now;
        (next as AnnotationFeature).payload.updatedBy = author;
      }
      set(c.kind, id, next);
    }
  }
  const delta: RoomDelta = { layers: [], features: [], deletedLayers: [...deletedLayers], deletedFeatures: [] };
  for (const id of changedLayers) {
    const row = layers.get(id);
    if (row) delta.layers.push(row);
  }
  for (const id of changedFeatures) {
    const row = features.get(id);
    if (row && !deletedLayers.has(row.layerId)) delta.features.push(row);
    else delta.deletedFeatures.push(id);
  }
  return {
    ids,
    versions,
    delta,
    changed: changedLayers.size > 0 || changedFeatures.size > 0,
    persist() {
      for (const id of deletedLayers) {
        void room.sql`DELETE FROM annotation_features WHERE layer_id = ${id}`;
        void room.sql`DELETE FROM layers WHERE layer_id = ${id}`;
      }
      for (const row of delta.layers) room._upsertLayerRow(row as Layer);
      for (const id of delta.deletedFeatures) void room.sql`DELETE FROM annotation_features WHERE feature_id = ${id}`;
      for (const row of delta.features) room._upsertAnnotationFeatureRow(row as AnnotationFeature);
    },
  };
}
