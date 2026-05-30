# Unified Layer And Annotation Storage Design

This document describes the clean-break design for layer management, annotation storage, and synchronization.

The key change from the current implementation is:

> Layers are first-class database rows, and annotation features are first-class database rows.

Do not store all drawings as one large JSON document. Do not store layer ordering in separate drawing/overlay models. Use one unified `layers` table for all map layers, and one `annotation_features` table for individual editable annotation features.

## Goals

- One layer list in the product: annotation layers, imported GPX/GeoJSON layers, and future layer types all live together.
- One canonical ordering model: layer order is stored on layer rows with `sort_key`.
- Each annotation feature is independently stored and independently synced.
- Concurrent users drawing different features in the same annotation layer should not overwrite each other.
- Layer-level operations are separate from feature-level operations.
- File content remains content-addressed and deduplicated by hash.

## Non-Goals

- Do not serialize editable annotations as file overlays.
- Do not store an annotation layer's feature IDs as an array on the layer row.
- Do not store all annotation features in one room-level JSON document.
- Do not keep separate visual order fields such as `DrawingLayer.stackOrder`, `overlays.order_index`, and `LayerStackDoc.itemOrder`.

## Core Model

There is one layer entity:

```ts
type LayerKind = 'annotation' | 'file';

type Layer = {
  id: string;
  kind: LayerKind;
  name: string;
  visible: boolean;
  sortKey: string;
  payload: AnnotationLayerPayload | FileLayerPayload;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
};

type AnnotationLayerPayload = {
  version: 1;
};

type FileLayerPayload = {
  version: 1;
  fileType: 'gpx' | 'geojson';
  contentHash: string;
  contentType: string;
  contentEncoding: 'gzip' | 'identity';
  contentByteLength: number;
  rawByteLength: number;
  bounds: [[number, number], [number, number]] | null;
  style: {
    color: string;
    opacity: number;
    lineWidth: number;
  };
};
```

Annotation features are separate entities:

```ts
type AnnotationFeature = {
  id: string;
  layerId: string;
  featureType: 'point' | 'text' | 'path' | 'route' | 'polygon';
  payload: AnnotationFeaturePayload;
  sortKey: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};
```

The relationship is:

```text
layers(kind = 'annotation') 1 ---- N annotation_features
```

Each feature points to its parent annotation layer via `annotation_features.layer_id`. The layer does not maintain a `featureIds` array.

## Why Features Are Rows

The current drawing model stores the whole drawing state as one JSON document. That is simple, but it creates a large shared write target.

With row-level features:

```text
User A draws point_a -> INSERT annotation_features(point_a)
User B draws point_b -> INSERT annotation_features(point_b)
```

Both writes can coexist naturally because they touch different rows.

If both users edit the same feature, conflict resolution is scoped to that feature row instead of the entire annotation document.

This makes the future path clearer for:

- per-feature revisions
- incremental sync
- conflict detection with `baseRevision`
- partial reloads by layer
- operation logs or history

## SQL Schema

Recommended schema:

```sql
CREATE TABLE layers (
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
);

CREATE INDEX layers_sort_idx ON layers(sort_key, created_at, layer_id);
CREATE INDEX layers_kind_idx ON layers(kind);

CREATE TABLE annotation_features (
  feature_id TEXT PRIMARY KEY,
  layer_id TEXT NOT NULL,
  feature_type TEXT NOT NULL,
  feature_json TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX annotation_features_layer_idx ON annotation_features(layer_id, sort_key, created_at, feature_id);
CREATE INDEX annotation_features_updated_idx ON annotation_features(updated_at);

CREATE TABLE file_contents (
  content_hash TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

Optional room metadata can stay separate:

```sql
CREATE TABLE room_meta (
  room_id TEXT PRIMARY KEY,
  persistence TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER
);
```

## Layer Payload Examples

Annotation layer:

```json
{
  "version": 1
}
```

File layer:

```json
{
  "version": 1,
  "fileType": "geojson",
  "contentHash": "6c31...",
  "contentType": "application/geo+json",
  "contentEncoding": "gzip",
  "contentByteLength": 9182,
  "rawByteLength": 48221,
  "bounds": [
    [139.1, 35.1],
    [139.9, 35.9]
  ],
  "style": {
    "color": "#3b82f6",
    "opacity": 0.95,
    "lineWidth": 5
  }
}
```

Annotation feature:

```json
{
  "type": "path",
  "label": "Walk",
  "note": "Morning route",
  "color": "#dc2626",
  "points": [
    [139.7, 35.6],
    [139.71, 35.61]
  ],
  "directed": true,
  "width": 4,
  "lineStyle": "dashed",
  "opacity": 0.8
}
```

Line-like annotation features (`path` and `route`) support `lineStyle` values `solid`, `dashed`, or `dotted`, plus `opacity` from `0.05` to `1`. Polygon annotations use the same outline fields and also keep `fillOpacity` for the area fill.

The canonical fields `feature_id`, `layer_id`, `feature_type`, `sort_key`, `revision`, `created_at`, `updated_at`, and `updated_by` stay as SQL columns so they can be queried and synced without parsing every JSON payload.

`feature_type` is canonical. The payload may also include `type` for frontend convenience, but the server must overwrite or validate `feature_json.type` so it always equals the `feature_type` column before storing or broadcasting a feature.

## Ordering

Layer order is stored directly on each layer row:

```sql
SELECT * FROM layers ORDER BY sort_key ASC, created_at ASC, layer_id ASC;
```

Annotation feature order within a layer is also row-based:

```sql
SELECT *
FROM annotation_features
WHERE layer_id = ?
ORDER BY sort_key ASC, created_at ASC, feature_id ASC;
```

Use `sort_key` instead of an array of IDs. This avoids shared-array write conflicts.

Initial implementation can use integer-like string keys, for example `000010`, `000020`, `000030`. Reorder can rewrite the affected range. If reorder concurrency becomes important, switch to fractional indexing or LexoRank-style keys.

Duplicate `sort_key` values are allowed but must be deterministic. Every query and every client-side sort must use the same tie-breaker order:

```text
layers:              sort_key ASC, created_at ASC, layer_id ASC
annotation_features: sort_key ASC, created_at ASC, feature_id ASC
```

This protects clients from unstable ordering if concurrent reorder operations or bugs produce duplicate keys.

## Layer Operations

Layer operations are unified for annotation and file layers.

| User Action             | Database Effect                                                   |
| ----------------------- | ----------------------------------------------------------------- |
| Create annotation layer | `INSERT layers(kind='annotation')`                                |
| Import GPX/GeoJSON      | store bytes in `file_contents`, then `INSERT layers(kind='file')` |
| Rename layer            | `UPDATE layers SET name = ?`                                      |
| Show/hide layer         | `UPDATE layers SET visible = ?`                                   |
| Reorder layer           | `UPDATE layers SET sort_key = ?`                                  |
| Delete annotation layer | `DELETE layers`, `DELETE annotation_features WHERE layer_id = ?`  |
| Delete file layer       | `DELETE layers`, prune unreferenced `file_contents`               |

This means there is no `DrawingLayer.stackOrder`, no `overlays.order_index`, and no separate `LayerStackDoc.itemOrder` array.

Layer rows have their own `revision`. Initial conflict handling is server-side last-write-wins per layer row, but every accepted layer mutation increments that row's revision. This keeps the door open for future `baseRevision` checks without changing the storage shape.

Deleting a layer and deleting dependent rows must be atomic. Prefer a SQL transaction or foreign-key cascade if available. If the runtime does not enforce foreign keys, the server reducer must execute the layer delete and dependent cleanup as one logical operation before broadcasting success.

## Annotation Feature Operations

Feature operations affect individual rows.

| User Action                              | Database Effect                                   |
| ---------------------------------------- | ------------------------------------------------- |
| Draw point/path/polygon/route/text       | `INSERT annotation_features`                      |
| Edit one feature                         | `UPDATE annotation_features WHERE feature_id = ?` |
| Delete one feature                       | `DELETE annotation_features WHERE feature_id = ?` |
| Move feature to another annotation layer | `UPDATE annotation_features SET layer_id = ?`     |
| Reorder feature within a layer           | `UPDATE annotation_features SET sort_key = ?`     |

The service should reject feature upserts whose `layer_id` does not reference an existing annotation layer.

Rejected feature mutations must produce an explicit response so optimistic clients can roll back or surface the conflict:

```json
{
  "type": "annotation-feature:rejected",
  "featureId": "feature_path_1",
  "reason": "missing-layer"
}
```

A generic error envelope is also acceptable, but silent rejection is not.

## Protocol

Use entity-level messages. Names can be adjusted, but the boundaries should remain the same.

### Layer Protocol

Client to server:

| Message              | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `layer:list:request` | Request all layers                                   |
| `layer:create`       | Create annotation or file layer                      |
| `layer:update`       | Update name, visibility, payload fields, or sort key |
| `layer:delete`       | Delete annotation or file layer                      |
| `layer:reorder`      | Update one or more layer sort keys                   |

Server to client:

| Message           | Purpose                                           |
| ----------------- | ------------------------------------------------- |
| `layer:list`      | Full canonical layer list                         |
| `layer:created`   | Canonical created layer                           |
| `layer:updated`   | Canonical updated layer                           |
| `layer:deleted`   | Deleted layer ID                                  |
| `layer:reordered` | Canonical affected layer order or full layer list |

`layer:update` can update common layer fields (`name`, `visible`, `sortKey`) and mutable payload fields. For file layers, mutable payload fields are initially limited to `style` and derived metadata such as `bounds` if the server recomputes or trusts it.

File identity fields are immutable after creation unless the product explicitly supports replacing a file in-place:

- `fileType`
- `contentHash`
- `contentType`
- `contentEncoding`
- `contentByteLength`
- `rawByteLength`

If file replacement is supported later, the flow should be explicit: upload new content bytes, then perform a file-replace layer update that atomically points the file layer payload at the new content hash.

Example reorder:

```json
{
  "type": "layer:reorder",
  "updates": [
    { "layerId": "layer_annotation_day_1", "sortKey": "000020" },
    { "layerId": "layer_file_route", "sortKey": "000030" }
  ]
}
```

### Annotation Feature Protocol

Client to server:

| Message                           | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `annotation-feature:list:request` | Request features, optionally by layer or since timestamp/revision |
| `annotation-feature:upsert`       | Create/update one feature row                                     |
| `annotation-feature:delete`       | Delete one feature row                                            |
| `annotation-feature:reorder`      | Update feature sort keys                                          |

Server to client:

| Message                        | Purpose                          |
| ------------------------------ | -------------------------------- |
| `annotation-feature:list`      | Full or filtered feature list    |
| `annotation-feature:upserted`  | Canonical feature row            |
| `annotation-feature:deleted`   | Deleted feature ID               |
| `annotation-feature:reordered` | Canonical affected feature order |

Feature upsert example:

```json
{
  "type": "annotation-feature:upsert",
  "feature": {
    "id": "feature_path_1",
    "layerId": "layer_annotation_day_1",
    "featureType": "path",
    "sortKey": "000010",
    "payload": {
      "type": "path",
      "label": "Walk",
      "note": "",
      "color": "#dc2626",
      "points": [
        [139.7, 35.6],
        [139.71, 35.61]
      ],
      "directed": true,
      "width": 4,
      "lineStyle": "dashed",
      "opacity": 0.8
    },
    "updatedBy": "user_a"
  }
}
```

### File Content Protocol

File bytes stay separate from layer metadata.

JSON messages:

| Message                | Purpose                              |
| ---------------------- | ------------------------------------ |
| `file:content:request` | Request bytes by content hash        |
| `file:content:stored`  | Ack binary content upload            |
| `file:content:needed`  | Ask uploader to resend missing bytes |

Binary content can keep the existing frame format:

```text
[version: 1 byte][hashLength: 1 byte][contentHash bytes][content bytes]
```

File layer creation is a layer operation after bytes are stored:

```text
upload binary content -> file:content:stored -> layer:create(kind='file')
```

### Room Metadata Protocol

Room metadata is small room-level state, separate from layer rows.

Client to server:

| Message               | Purpose                             |
| --------------------- | ----------------------------------- |
| `room:status:request` | Request room metadata               |
| `room:update`         | Update mutable room metadata fields |

Server to client:

| Message        | Payload                              |
| -------------- | ------------------------------------ |
| `room:status`  | Current room metadata                |
| `room:updated` | Canonical room metadata after update |

Initial mutable metadata is limited to `persistence: 'ephemeral' | 'persistent'`. Persistent rooms keep `expires_at = null` and are not cleared by the normal inactivity alarm.

## Connection And Reconnection

On connect, the server sends or the client requests:

```text
room:status
layer:list
annotation-feature:list
```

The preferred initial order is `layer:list` first, then `annotation-feature:list`. A client should still tolerate out-of-order delivery by temporarily caching features whose parent layer has not arrived yet, but the server should make the common path deterministic.

For file layers, the client checks each file layer payload's `contentHash`. Missing bytes are fetched with `file:content:request`.

Reconstruction is straightforward:

1. Render layer manager rows from `layers ORDER BY sort_key`.
2. For annotation layers, query/render features where `annotation_features.layer_id = layer.layer_id`.
3. For file layers, materialize bytes by `contentHash` and render the file.
4. Apply visibility from `layers.visible`.
5. Move MapLibre layers according to `layers.sort_key`.

There is no need to merge `overlay:list` with `drawing:layer:upserted`, and no need to infer where drawing pseudo-overlays belong.

## Incremental Sync

The initial implementation should prefer full list/snapshot sync for correctness:

```text
layer:list
annotation-feature:list
```

Incremental sync by `updated_at` or revision is a future optimization. It cannot be implemented correctly with live rows alone, because deletes remove rows and a client would not learn that an entity disappeared.

Before adding incremental sync, add one of these mechanisms:

- `deleted_entities` tombstone table
- append-only operation log
- soft-delete columns on entity tables, with later compaction

Example tombstone table:

```sql
CREATE TABLE deleted_entities (
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  deleted_by TEXT,
  PRIMARY KEY (entity_kind, entity_id)
);
```

Until tombstones or an operation log exist, `since` parameters should be documented as future work, not part of the correctness path.

## Offline And Concurrent Editing

This model makes offline queues easier because each mutation targets one entity type.

Examples:

```text
User A offline draws feature_a:
  queue annotation-feature:upsert(feature_a)

User B online draws feature_b in same layer:
  server inserts feature_b

User A reconnects:
  server inserts feature_a
```

Both features survive because they are separate rows.

Conflict scope:

- different features: no conflict
- same feature: conflict is one row, initially last-write-wins by feature revision
- same layer metadata: conflict is one layer row
- layer reorder: conflict is only sort keys
- deleted layer + stale feature upsert: reject feature upsert because parent layer no longer exists

For stronger same-feature conflict handling, include `baseRevision` in `annotation-feature:upsert` later:

```json
{
  "type": "annotation-feature:upsert",
  "baseRevision": 4,
  "feature": { "id": "feature_a" }
}
```

The server can reject, merge, or mark conflict if the stored row revision is newer than `baseRevision`.

## Rendering

Each layer row materializes to one or more MapLibre layer IDs.

```ts
type RenderableLayer = {
  layerId: string;
  kind: 'annotation' | 'file';
  sortKey: string;
  visible: boolean;
  mapLayerIds: string[];
};
```

Render order:

```ts
const ordered = renderables.sort(
  (a, b) => a.sortKey.localeCompare(b.sortKey) || a.createdAt - b.createdAt || a.layerId.localeCompare(b.layerId),
);
for (const layer of ordered) {
  for (const mapLayerId of layer.mapLayerIds) {
    map.moveLayer(mapLayerId);
  }
}
```

Because `moveLayer(layerId)` without `beforeId` moves a layer to the top, iterating bottom-to-top leaves later rows visually above earlier rows.

### Text Annotation Caveat

DOM markers do not obey MapLibre layer ordering. If text annotations must respect layer order, render them as MapLibre symbol/layer content rather than DOM markers, or explicitly accept that DOM text markers always float above canvas layers.

We just accept DOM text marks.

## Product Layer Types

Storage has two top-level layer kinds:

```ts
type LayerKind = 'annotation' | 'file';
```

The UI can still present three product types:

```ts
function productLayerType(layer: Layer) {
  return layer.kind === 'annotation' ? 'annotation' : layer.payload.fileType;
}
```

So the product can show `annotation`, `gpx`, and `geojson` without splitting the storage model into three unrelated layer concepts.

## Naming

Prefer these names for the clean break:

| Old Concept                | New Concept                   |
| -------------------------- | ----------------------------- |
| `OverlayManager`           | `LayerManager`                |
| `overlay` as generic layer | `layer`                       |
| `drawing`                  | `annotation`                  |
| `DrawingDoc`               | removed                       |
| `DrawingLayer`             | `layers(kind='annotation')`   |
| `DrawingFeature`           | `AnnotationFeature`           |
| `OverlayManifest`          | `layers(kind='file').payload` |
| `overlay_contents`         | `file_contents`               |

## Implementation Plan

1. Add `layers` SQL table and layer protocol/reducer.
2. Add `annotation_features` SQL table and feature protocol/reducer.
3. Add or rename `file_contents` for content-addressed file bytes.
4. Replace `OverlayManager` with `LayerManager` backed by `layers ORDER BY sort_key`.
5. Replace `DrawingDoc.layers`, `layerOrder`, and `stackOrder` with annotation layer rows in `layers`.
6. Replace `DrawingDoc.features` JSON storage with one row per feature in `annotation_features`.
7. Change annotation tools to create features with `layerId = current annotation layer row id`.
8. Change file import to upload bytes, then create a `kind='file'` layer row with payload metadata.
9. Make rename, visibility, delete, and reorder use layer messages only.
10. Make annotation feature create/update/delete use feature messages only.
11. Rebuild rendering from layer rows and feature rows.
12. Add tests for concurrent inserts, same-feature last-write-wins, layer delete cascading feature delete, stale feature upsert rejection, mixed layer reorder, reconnect snapshots, and file content re-request.

## Summary

The final architecture is:

```text
layers
  owns: all map layers, type, name, visibility, order, file payload

annotation_features
  owns: each editable annotation feature as an independent row

file_contents
  owns: imported file bytes by content hash
```

This matches the product model: one layer list, mixed layer types, independent annotation features, and simpler sync boundaries.

## Compatibility

This design is a clean break. It does not preserve compatibility with the current storage schema or protocol.

Explicitly unsupported:

- reading old `drawing_state.doc_json` as live annotation data
- reading old `overlays` rows as live file layers
- reading old `overlay_contents` rows as live file contents
- preserving `DrawingLayer.stackOrder`
- preserving `overlays.order_index`
- supporting old `drawing:*` and `overlay:*` clients after the cutover

There is no migration path for old room data. On cutover, old synchronized room state should be cleared and old tables should be dropped.

Old tables to remove:

```sql
DROP TABLE IF EXISTS overlays;
DROP TABLE IF EXISTS overlay_contents;
DROP TABLE IF EXISTS drawing_state;
```

If old agent/presence metadata is no longer compatible with the new room protocol, remove it too:

```sql
DROP TABLE IF EXISTS agent_participants;
DROP TABLE IF EXISTS room_meta;
```

After cleanup, recreate only the new schema used by this design:

```text
layers
annotation_features
file_contents
room_meta, if still needed for room lifetime/persistence
```

Clients using the old protocol should receive a version/protocol error and be required to refresh or upgrade. The server should not dual-write old and new schemas.
