# Sync Architecture

## Overview

The system uses a **client-server** architecture over WebSocket, with a Cloudflare Durable Object (`MapCollaboration`) as the server of truth. Three independent sync domains share the same WebSocket connection:

| Domain                           | Data                                                 | Conflict Resolution                                       |
| -------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| **Drawing** (annotations)        | Layers, features (points/paths/polygons/routes/text) | Last-write-wins, server assigns monotonic revision        |
| **Overlays** (GPX/GeoJSON files) | Manifest metadata + content-addressed blobs          | Server maintains canonical order, content by SHA-256 hash |
| **Presence**                     | Cursor, viewport, GPS location, following state      | Ephemeral, no persistence, latest update wins             |

```
┌──────────────────────────────────────────────────────────────┐
│  Browser Client                                              │
│                                                              │
│  OverlayManager ─overlay-sync:local-*─> collaboration.ts     │
│       ^                                        │             │
│       │ overlay-sync:remote-*                  │ WebSocket   │
│       │                                        │             │
│  DrawingStore ─subscribe()─> collaboration.ts ─┘             │
│       ^                                     │                │
│       │ applyServerMessage()                │                │
│       └─────────────────────────────────────┘                │
└─────────────────────────────────┬────────────────────────────┘
                                  │ WebSocket (JSON + binary)
                                  │
┌─────────────────────────────────┴────────────────────────────┐
│  Cloudflare Durable Object (MapCollaboration)                │
│                                                              │
│  SQL: room_meta, overlays, overlay_contents, drawing_state,  │
│       agent_participants                                     │
│                                                              │
│  Routes: overlay:* → overlay logic                           │
│          drawing:* → drawing-sync reducer                    │
│          client:update → presence broadcast                  │
└──────────────────────────────────────────────────────────────┘
```

---

## Data Models

### DrawingDoc

```ts
type DrawingDoc = {
  version: 1;
  layers: Record<string, DrawingLayer>; // layer metadata by ID
  layerOrder: string[]; // display order (bottom to top)
  features: Record<string, DrawingFeature>; // feature data by ID
  featureOrder: string[]; // display order (bottom to top)
  revision: number; // monotonic counter, starts at 0
  updatedAt: number; // timestamp of last mutation
};
```

**Feature types** (discriminated union on `type`): `point`, `text`, `path`, `polygon`, `route`.

**Default layer:** Every doc has a built-in layer with id `drawing-default`.

### Overlay Manifest

Overlays are stored server-side in the `overlays` SQL table. Each row has:

- `overlay_id` (PK)
- `manifest_json` (JSON blob with id, type, name, color, opacity, lineWidth, bounds, contentHash, etc.)
- `content_hash` (FK to `overlay_contents`)
- `order_index` (integer for sorting)
- `updated_at` (timestamp)

Content blobs are stored separately in `overlay_contents` keyed by SHA-256 hash. Multiple overlays can reference the same content.

### Presence

Ephemeral per-connection state (not persisted):

- `profile`: `{ name, color }`
- `viewport`: `{ lng, lat, zoom, bearing, pitch }` (throttled snapshot)
- `cursor`: `{ visible, lngLat }`
- `location`: GPS coordinates (if available)
- `following`: ID of peer being followed (auto-follow mode)

---

## Drawing Sync Protocol

### Message Types

**Client → Server:**

| Type                       | Fields       | Description                  |
| -------------------------- | ------------ | ---------------------------- |
| `drawing:snapshot:request` | —            | Request full doc from server |
| `drawing:layer:upsert`     | `layer`      | Create/update a layer        |
| `drawing:layer:reorder`    | `orderedIds` | Reorder layers               |
| `drawing:feature:upsert`   | `feature`    | Create/update a feature      |
| `drawing:feature:delete`   | `featureId`  | Delete a feature             |
| `drawing:feature:reorder`  | `orderedIds` | Reorder features             |

**Server → Client** (broadcast to all, including sender):

| Type                        | Fields                   | Description                             |
| --------------------------- | ------------------------ | --------------------------------------- |
| `drawing:snapshot`          | `revision`, `doc`        | Full doc (response to snapshot:request) |
| `drawing:layer:upserted`    | `revision`, `layer`      | Layer was created/updated               |
| `drawing:layer:reordered`   | `revision`, `orderedIds` | Layers were reordered                   |
| `drawing:feature:upserted`  | `revision`, `feature`    | Feature was created/updated             |
| `drawing:feature:deleted`   | `revision`, `featureId`  | Feature was deleted                     |
| `drawing:feature:reordered` | `revision`, `orderedIds` | Features were reordered                 |

Each client message has a 1:1 corresponding server message (client type + `ed` suffix).

### State Machine: `reduceDrawingClientMessage`

This is the **server-side reducer**. It is a pure function:

```ts
reduceDrawingClientMessage(doc, message, now)
  → { doc: DrawingDoc, outbound: DrawingServerMessage }
```

**Steps:**

1. Normalize the input doc (or create empty if null).
2. Compute `revision = current.revision + 1`.
3. Apply the mutation via the corresponding `apply*` function.
4. Return the new doc and the outbound server message.

**Key property:** The outbound message contains the **server-canonical** (sanitized) data, not the raw client input. This ensures convergence — all clients see the same result.

### Applying Server Messages on Clients: `applyDrawingServerMessage`

Clients apply server broadcast messages using the **same `apply*` functions** as the server. Because these functions are pure and deterministic, and the server message carries already-sanitized data, all clients converge to identical state.

```ts
applyDrawingClientMessage(doc, message) → DrawingDoc
```

### Sanitization: `parseDrawingClientMessage`

All incoming client messages pass through sanitization before processing:

- **IDs**: Must match `/^[0-9a-zA-Z_-]{1,96}$/`
- **Feature coordinates**: Clamped to `[-180,180] × [-85,85]`, 6 decimal places
- **Colors**: Must be valid `#rrggbb` hex, fallback to `#2563eb`
- **Text fields**: Trimmed, length-capped (label: 200, note: 2000)
- **Point counts**: path ≥ 2, polygon ≥ 3, max 512
- **Ordered ID arrays**: Sanitized per-entry, capped at 128 (layers) or 512 (features)
- **Layer `stackOrder`**: Clamped to `[0, 4096]`

Invalid messages return `null` and are silently discarded.

### Revisions

- Start at `0` for a new empty doc.
- Increment by exactly `1` per mutation.
- Carried in every server message (except `drawing:snapshot` which carries the current revision).
- Clients can detect gaps and request a full snapshot to re-sync.
- `nextRevision()` uses `Math.max(doc.revision, options.revision)` for idempotency.

### Full Message Lifecycle

```
Client A                          Server                         Client B
────────                          ──────                         ────────
  │  1. User action (e.g. draw)
  │  2. Build raw message
  │  3. parseDrawingClientMessage()
  │     → sanitized message | null
  │  4. Send via WebSocket ──────────►  5. Server receives
  │                                     6. parseDrawingClientMessage()
  │                                     7. reduceDrawingClientMessage(doc, msg)
  │                                        → { newDoc, outbound }
  │                                     8. Save newDoc to SQL
  │                                     9. broadcast(outbound) ──────►  10. Client A & B:
  │                                                                       applyDrawingServerMessage(localDoc, msg)
  │                                                                       → converged state
```

**Properties:**

- **Double sanitization**: Client-side (optional, for optimistic UI) and server-side (mandatory).
- **Deterministic convergence**: Same inputs → same outputs for all clients.
- **Optimistic local update**: Sending client can apply the mutation locally before the server responds.
- **Last-write-wins**: No OT or CRDT. If two clients edit the same feature, the server processes whichever arrives first, then the second. Both clients converge to the second write.
- **No ownership**: Any client can modify/delete any feature.

---

## Overlay Sync Protocol

### Content Transport

Binary content uses a custom frame format:

```
[version:1byte][hashLength:1byte][contentHash:hashLength bytes][rawContent:remaining bytes]
```

- Content is gzip-compressed when possible.
- Max content size: 2 MiB.
- Content is identified by its SHA-256 hex hash.

### Message Types

**Client → Server:**

| Type                      | Fields               | Description                                        |
| ------------------------- | -------------------- | -------------------------------------------------- |
| `overlay:upsert`          | `manifest`           | Create/replace an overlay manifest                 |
| `overlay:content:request` | `contentHash`        | Request binary content by hash                     |
| `overlay:patch`           | `overlayId`, `patch` | Update mutable fields (name, visible, color, etc.) |
| `overlay:reorder`         | `orderedIds`         | Reorder overlays by ID                             |
| `overlay:stack:reorder`   | `stackItems`         | Reorder combined overlay + drawing layer stack     |
| `overlay:delete`          | `overlayId`          | Delete an overlay                                  |

**Server → Sender:**

| Type                     | Fields                      | Description                                     |
| ------------------------ | --------------------------- | ----------------------------------------------- |
| `overlay:upserted`       | `manifest`                  | Ack of successful upsert                        |
| `overlay:content:stored` | `contentHash`               | Ack that binary content was stored              |
| `overlay:patched`        | `manifest`                  | Ack of successful patch                         |
| `overlay:reordered`      | `orderedIds`, `stackItems?` | Ack of successful reorder                       |
| `overlay:deleted`        | `overlayId`                 | Ack of successful delete                        |
| `overlay:content:needed` | `contentHash`               | Content hash not found, client should re-upload |

**Server → All Other Clients** (broadcast, excluding sender):

| Type             | Fields                      | Description                                          |
| ---------------- | --------------------------- | ---------------------------------------------------- |
| `overlay:list`   | `persistence`, `overlays[]` | Canonical overlay manifest list (after any mutation) |
| `overlay:delete` | `overlayId`                 | Imperative delete (note: `delete` not `deleted`)     |

**Server → Client on Connect:**

| Type               | Fields                      | Description            |
| ------------------ | --------------------------- | ---------------------- |
| `overlay:init`     | `persistence`, `overlays[]` | Initial overlay state  |
| `drawing:snapshot` | `revision`, `doc`           | Initial drawing state  |
| `presence:init`    | `peers[]`, `agents[]`       | Initial presence state |

### Overlay Lifecycle

```
1. Client uploads binary content → Server stores in overlay_contents → ack with contentHash
2. Client sends overlay:upsert with manifest (referencing contentHash)
3. Server validates manifest, checks content exists, upserts into SQL
4. Server sends overlay:upserted to sender
5. Server broadcasts overlay:list to all other clients
6. Other clients request missing content via overlay:content:request
```

### `overlay:stack:reorder`

This is the most complex operation. It handles the **combined visual stack** that includes both file overlays and drawing annotation layers.

**Input:**

```json
{
  "type": "overlay:stack:reorder",
  "stackItems": [
    { "kind": "overlay", "id": "overlay-b" },
    { "kind": "drawing", "layerId": "drawing-default" },
    { "kind": "overlay", "id": "overlay-a" }
  ]
}
```

**Server processing:**

1. Overlay items → update `order_index` in SQL (0, 1, 2, ...).
2. Drawing items → update `stackOrder` on the corresponding layer in the drawing doc, increment `revision`.
3. Save drawing doc if changed.
4. Send `overlay:reordered` to sender with canonical `orderedIds` and `stackItems`.
5. Broadcast `overlay:list` to other clients.
6. Broadcast `drawing:layer:upserted` for each changed drawing layer.

### Remote Overlay Order Management

When a client rejoins, overlay content may arrive out of order. The system handles this with two helper functions:

- `applyRemoteOverlayManifestOrder(overlays, orderedIds)`: Sorts overlays to match the server's manifest order. Non-manifest overlays (like the drawing overlay) are placed at the end in their original relative order.
- `applyDrawingOverlayStackOrder(overlays, drawingOverlayId, stackOrder)`: Positions the drawing overlay at the specified index within the combined stack.

---

## Presence Protocol

### Message Type

**Client → Server:**

```json
{
  "type": "client:update",
  "profile": { "name": "Alice", "color": "#3b82f6" },
  "cursor": { "visible": true, "lngLat": [139.7, 35.6] },
  "viewport": { "lng": 139.7, "lat": 35.6, "zoom": 12, "bearing": 0, "pitch": 0 },
  "location": { "lng": 139.7, "lat": 35.6 },
  "following": null,
  "view": { "terrain": true, "satellite": false }
}
```

Sent throttled at ~90ms intervals. Only sent when the client is connected to a room.

**Server → All Clients:**

```json
{
  "type": "presence:update",
  "connectionId": "abc123",
  "profile": { "name": "Alice", "color": "#3b82f6" },
  "cursor": { ... },
  "viewport": { ... },
  "location": { ... },
  "following": null,
  "view": { ... },
  "connectedAt": 1234567890
}
```

The server also broadcasts `presence:join` and `presence:leave` when clients connect/disconnect.

### Ephemeral Nature

Presence state is NOT persisted. When a client disconnects, its presence is removed. On reconnect, the client re-announces itself.

---

## Event Flow: What Triggers What

### Local User Action → Remote Sync

| User Action               | Local Event                                | WebSocket Message                            | Server Broadcast            |
| ------------------------- | ------------------------------------------ | -------------------------------------------- | --------------------------- |
| Draw a point/path/polygon | `DrawingStore.upsertFeature()`             | `drawing:feature:upsert`                     | `drawing:feature:upserted`  |
| Delete a feature          | `DrawingStore.deleteFeature()`             | `drawing:feature:delete`                     | `drawing:feature:deleted`   |
| Reorder features          | `DrawingStore.reorderFeatures()`           | `drawing:feature:reorder`                    | `drawing:feature:reordered` |
| Add/rename a layer        | `DrawingStore.upsertLayer()`               | `drawing:layer:upsert`                       | `drawing:layer:upserted`    |
| Reorder layers            | `DrawingStore.reorderLayers()`             | `drawing:layer:reorder`                      | `drawing:layer:reordered`   |
| Import GPX/GeoJSON        | `OverlayManager._registerOverlay()`        | `overlay:upsert`                             | `overlay:list`              |
| Toggle overlay visibility | `OverlayManager._applyOverlayVisibility()` | `overlay:patch`                              | `overlay:list`              |
| Reorder overlays          | `OverlayManager._moveOverlayToIndex()`     | `overlay:reorder` or `overlay:stack:reorder` | `overlay:list`              |
| Delete overlay            | `OverlayManager._removeOverlay()`          | `overlay:delete`                             | `overlay:delete`            |
| Move mouse                | map `mousemove` event                      | `client:update` (throttled)                  | `presence:update`           |
| Pan/zoom map              | map `move`/`moveend` events                | `client:update` (throttled)                  | `presence:update`           |

### Remote Message → Local State Update

| Server Message              | DrawingStore Action              | OverlayManager Action       | UI Update                |
| --------------------------- | -------------------------------- | --------------------------- | ------------------------ |
| `drawing:snapshot`          | `setSnapshot()`                  | —                           | Full redraw              |
| `drawing:layer:upserted`    | `upsertLayer({remote:true})`     | —                           | Layer list update        |
| `drawing:layer:reordered`   | `reorderLayers({remote:true})`   | —                           | Layer list update        |
| `drawing:feature:upserted`  | `upsertFeature({remote:true})`   | —                           | Feature rendered on map  |
| `drawing:feature:deleted`   | `deleteFeature({remote:true})`   | —                           | Feature removed from map |
| `drawing:feature:reordered` | `reorderFeatures({remote:true})` | —                           | Z-order update           |
| `overlay:list`              | —                                | `_applyRemoteOverlayList()` | Overlay list update      |
| `overlay:delete`            | —                                | `_deleteRemoteOverlay()`    | Overlay removed          |
| `presence:update`           | —                                | —                           | Cursor/viewport rendered |

### The `remote` Flag

`DrawingStore` events carry a `remote: boolean` flag. The collaboration layer's subscribe callback checks this:

```ts
if (event.remote) return; // Don't echo server-originated changes back
```

This prevents infinite echo loops: only local mutations are forwarded to the server.

---

## Reconnection Flow

When the WebSocket reconnects (`open` event):

1. **Overlay sync:** `syncKnownLocalOverlays()` re-uploads any local overlays not yet confirmed by the server.
2. **Drawing sync:**
   a. Send `drawing:snapshot:request` to get the full server state.
   b. Send `drawing:layer:upsert` for all local layers.
   c. Send `drawing:layer:reorder` with current local layer order.
   d. Send `drawing:feature:upsert` for all local features.
   e. Send `drawing:feature:reorder` with current local feature order.
3. **Server responds** with `drawing:snapshot` containing the canonical document.
4. **Client replaces** local state with the server snapshot via `DrawingStore.applyServerMessage()`.
5. **Overlay content reconciliation:** The server sends `overlay:init` with current manifests. The client requests any missing content blobs.

---

## Key Files

| File                     | Role                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `src/drawing-model.ts`   | DrawingDoc data model, pure mutation functions, sanitization       |
| `src/drawing-sync.ts`    | Drawing protocol: message types, parser, reducer, applier          |
| `src/drawing-store.ts`   | Client-side drawing state manager (EventTarget)                    |
| `src/overlay-manager.ts` | Overlay UI + sync logic, stack order management                    |
| `src/collaboration.ts`   | Bridge between local UI and WebSocket server                       |
| `src/worker.ts`          | Cloudflare Durable Object server (message router, SQL persistence) |
