// Shared by the browser, CLI and room worker. No platform-specific dependencies.
export type RecordValue = Record<string, any>;
export type EntityKind = 'layer' | 'feature';
export const ROOM_SYNC_VERSION = 2;
export const MAX_BATCH_COMMANDS = 64;
export const MAX_BATCH_BYTES = 256 * 1024;
export const MAX_RESULT_BYTES = 16 * 1024;
export const CLIENT_LEASE_MS = 7 * 24 * 60 * 60 * 1000;
export type FieldEdit = { expectedVersion: number; value: unknown };
export type RoomCommand =
  | { type: 'create'; kind: EntityKind; localId: string; data: RecordValue }
  | { type: 'patch'; kind: EntityKind; id: string; fields: Record<string, FieldEdit> }
  | { type: 'delete'; kind: EntityKind; id: string }
  | { type: 'move'; kind: EntityKind; id: string; beforeId: string | null; expectedVersion: number };
export type RoomOperation = {
  type: 'sync:submit';
  protocol: 2;
  epoch: string;
  clientId: string;
  seq: number;
  commands: RoomCommand[];
};
export type RoomDelta = {
  layers: RecordValue[];
  features: RecordValue[];
  deletedLayers: string[];
  deletedFeatures: string[];
};
export type BatchResult = {
  seq: number;
  status: 'accepted' | 'rejected';
  commitVersion: number;
  reason?: string;
  commandIndex?: number;
  ids: Record<string, string>;
  versions: Record<string, Record<string, number>>;
};
export type RoomSnapshot = {
  type: 'sync:snapshot';
  protocol: 2;
  epoch: string;
  commitVersion: number;
  clientId: string | null;
  lastProcessedSeq: number;
  lastResult: BatchResult | null;
  layers: RecordValue[];
  features: RecordValue[];
};
export type RoomCommit = { type: 'sync:commit'; epoch: string; commitVersion: number; delta: RoomDelta };
export type OperationResult = {
  type: 'sync:result';
  epoch: string;
  clientId: string;
  result: BatchResult;
  delta?: RoomDelta;
  current?: RecordValue;
};
export type SyncError = { type: 'sync:error'; reason: string; seq?: number; contentHash?: string };
export type ServerMessage = RoomSnapshot | RoomCommit | OperationResult | SyncError;
export const entityKey = (kind: EntityKind, id: string) => `${kind}:${id}`;
export const fieldVersion = (row: RecordValue | null | undefined, field: string): number =>
  row?.fieldVersions?.[field] ?? 0;
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${stableJson(value)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const equalValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const geometryKeys = [
  'coordinate',
  'points',
  'waypoints',
  'geometry',
  'profile',
  'distance',
  'duration',
  'distanceText',
  'durationText',
];
const featureStyles = ['color', 'width', 'height', 'directed', 'lineStyle', 'opacity', 'fillOpacity'];
const contentKeys = [
  'version',
  'fileType',
  'contentHash',
  'contentType',
  'contentEncoding',
  'contentByteLength',
  'rawByteLength',
  'bounds',
];
function pick(row: RecordValue, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
}
export function readFields(kind: EntityKind, row: RecordValue): RecordValue {
  if (kind === 'layer')
    return {
      name: row.name,
      visible: row.visible,
      ...(row.kind === 'file'
        ? {
            content: pick(row.payload, contentKeys),
            color: row.payload.style.color,
            opacity: row.payload.style.opacity,
            lineWidth: row.payload.style.lineWidth,
          }
        : {}),
    };
  return {
    membership: row.layerId,
    label: row.payload.label ?? '',
    note: row.payload.note ?? '',
    geometry: pick(row.payload, geometryKeys),
    ...pick(row.payload, featureStyles),
  };
}
export function applyFields(kind: EntityKind, input: RecordValue, fields: RecordValue): RecordValue {
  const row = structuredClone(input);
  if (kind === 'layer') {
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'name' || key === 'visible') row[key] = value;
      else if (key === 'content') row.payload = { ...(value as object), style: row.payload.style };
      else row.payload.style[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'membership') {
        row.layerId = value;
        row.payload.layerId = value;
      } else if (key === 'geometry') {
        for (const key of geometryKeys) delete row.payload[key];
        for (const key of geometryKeys)
          if (value && typeof value === 'object' && Object.hasOwn(value, key))
            row.payload[key] = (value as RecordValue)[key];
      } else row.payload[key] = value;
    }
  }
  return row;
}
export function remapCommand(command: RoomCommand, ids: Record<string, string>): RoomCommand {
  const c = structuredClone(command);
  if (c.type === 'create') {
    if (c.kind === 'feature') {
      c.data.layerId = ids[c.data.layerId] || c.data.layerId;
      if (c.data.payload) c.data.payload.layerId = c.data.layerId;
    }
  } else {
    c.id = ids[c.id] || c.id;
    if (c.type === 'move' && c.beforeId) c.beforeId = ids[c.beforeId] || c.beforeId;
    if (c.type === 'patch' && c.fields.membership)
      c.fields.membership.value = ids[String(c.fields.membership.value)] || c.fields.membership.value;
  }
  return c;
}
export function commandKeys(c: RoomCommand): string[] {
  const key = entityKey(c.kind, c.type === 'create' ? c.localId : c.id);
  return c.type === 'patch'
    ? Object.keys(c.fields).map((field) => `${key}:${field}`)
    : [c.type === 'move' ? `${key}:position` : key];
}
export function commandReferences(c: RoomCommand): string[] {
  const ids: string[] = c.type === 'create' ? [] : [c.id];
  if (c.type === 'create' && c.kind === 'feature') ids.push(c.data.layerId);
  if (c.type === 'patch' && c.fields.membership) ids.push(String(c.fields.membership.value));
  if (c.type === 'move' && c.beforeId) ids.push(c.beforeId);
  return ids;
}
export function commandFileHash(c: RoomCommand): string | null {
  if (c.kind === 'layer') {
    if (c.type === 'create' && c.data.kind === 'file') return c.data.payload.contentHash;
    if (c.type === 'patch' && c.fields.content) return (c.fields.content.value as RecordValue).contentHash;
  }
  return null;
}
export const sortedRows = (rows: RecordValue[]) =>
  rows
    .slice()
    .sort(
      (a, b) =>
        String(a.sortKey).localeCompare(String(b.sortKey)) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
export function moveRows(rows: RecordValue[], id: string, beforeId: string | null): RecordValue[] {
  const sorted = sortedRows(rows);
  const row = sorted.find((row) => row.id === id);
  if (!row || beforeId === id || (beforeId && !sorted.some((row) => row.id === beforeId))) return sorted;
  const rest = sorted.filter((row) => row.id !== id);
  rest.splice(beforeId ? rest.findIndex((row) => row.id === beforeId) : rest.length, 0, row);
  return rest.map((row, index) => ({ ...row, sortKey: String((index + 1) * 10).padStart(9, '0') }));
}
