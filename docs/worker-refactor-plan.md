# Worker Refactor Plan

## Purpose

`src/worker.ts` is currently the Cloudflare Worker entrypoint, the `MapCollaboration` Durable Object implementation, the PMTiles/R2 tile proxy, the room protocol handler, and the room-local SQLite repository. The file is still coherent at runtime, but the source boundary is too broad for safe future changes.

The refactor should split the file by runtime responsibility while keeping external behavior stable:

- `wrangler.jsonc` still points at `src/worker.ts`.
- The Durable Object binding still exports class name `MapCollaboration`.
- PartyServer routes, account APIs, tile URLs, static asset fallback, WebSocket protocol messages, and binary file frame format stay unchanged.
- Existing worker tests should continue to pass during each migration phase.

This is a structural refactor, not a protocol redesign.

## Current Responsibilities

### Worker Entrypoint

`src/worker.ts` exports the default `fetch` handler. Request flow is:

1. `preparePartyWebSocketRequest(request, env)` signs trusted room auth headers for WebSocket upgrades.
2. `routePartykitRequest(...)` routes PartyServer/Durable Object traffic.
3. Plain PartyServer routing is attempted again for non-prepared routes.
4. `OPTIONS` gets a simple CORS response.
5. `handleAccountApiRequest(request, env)` handles `/api/*`.
6. `/tiles/*` is served from PMTiles archives in R2.
7. Everything else goes to `env.ASSETS`, with SPA fallback to `/`.

The entrypoint depends on:

- `partyserver`
- `room-ws-auth.ts`
- `account-api.ts`
- PMTiles/R2 tile handling
- Cloudflare static assets

### PMTiles Tile Proxy

The tile code is independent of room collaboration:

- URL parsing with `TILE_RE` and `TILEJSON_RE`
- `nativeDecompress`
- `R2Source`
- PMTiles cache and `handleTileRequest`
- content type mapping by `TileType`

This is the safest first extraction because it only depends on `pmtiles`, `env.ORM_BUCKET`, `caches.default`, and `ExecutionContext.waitUntil`.

### Room Auth And Control Auth

The DO trusts headers only after HMAC verification:

- `_verifyAuthHeaders(request)`
- `_verifyControlRequest(request, body)`
- `timingSafeEqualHex`
- `hex`
- auth/control sanitizers

The signing side is split today:

- `room-ws-auth.ts` signs WebSocket auth headers.
- `account-api.ts` signs internal DO control requests for access refresh and room persistence.
- `MapCollaboration` verifies both.

This signature contract is described in `docs/account-room-permissions-design.md` and must not change during the refactor.

### Presence And Agent State

Presence is per live connection, not per account user:

- `PeerState`
- `publicPeer`
- `client:update`
- viewport, cursor, location, following, terrain/satellite state
- recent agent participant storage in `agent_participants`

Important distinction:

- `userId` in auth is the permission/audit subject.
- `connection.id` and signed `clientId` are live collaboration subjects.
- agent participants use agent/client ids so one account can run multiple sessions.

### Room Metadata And Lifecycle

Room-local SQLite stores:

- `room_meta`
- `layers`
- `annotation_features`
- `file_contents`
- `agent_participants`

Lifecycle behavior:

- `_touchRoom()` creates or refreshes room metadata.
- `ephemeral` rooms set `expires_at = last activity + 24h`.
- `persistent` rooms set `expires_at = null`.
- `onAlarm()` prunes expired ephemeral rooms and skips persistent rooms.

### Layer, Annotation, And File Content Storage

The storage model follows `docs/layer-stack-design.md`:

- `layers` stores annotation and file layers.
- `annotation_features` stores individual annotation rows.
- `file_contents` stores content-addressed binary bytes by SHA-256 hash.

Server behavior that must remain stable:

- default annotation layer is inserted on schema setup.
- feature upsert is rejected if the parent layer is missing or is not an annotation layer.
- file layer creation requires existing `file_contents` bytes, otherwise server sends `file:content:needed`.
- deleting a file layer prunes unreferenced file content.
- layer and feature lists are sorted canonically.

### WebSocket Message Handling

`onMessage` currently handles all room protocol domains:

- binary file uploads
- `room:status:request`
- `room:update`
- layer list/create/update/delete/reorder
- annotation feature list/upsert/delete/reorder
- `file:content:request`
- old `overlay:*` and `drawing:*` protocol errors
- `client:update` presence and agent heartbeat

This is the highest-risk section to split because it encodes permission checks, storage mutation, acknowledgements, broadcasts, and optimistic-client rollback behavior.

## External Protocol Invariants

These must not change during the split.

### Connect Snapshot

On connect the room sends:

- `presence:init`
- `room:status`
- `layer:list`
- `annotation-feature:list`

The browser client and `packages/atlas-realm-cli` both wait for the initial room/presence/layer/feature snapshot.

### Permission Messages

Access refresh sends:

- `access:updated`
- `access:revoked`

Rejected mutations send:

- `permission:denied` with the original action name.

### Layer And Annotation Messages

The layer and annotation message names are defined by `src/layer-sync.ts` and documented in `docs/layer-stack-design.md`. They should remain byte-for-byte stable in this refactor.

### File Content Binary Frame

The binary frame is shared by the browser, CLI, tests, and server:

```text
[version: 1 byte][hashLength: 1 byte][contentHash UTF-8 bytes][content bytes]
```

Server-side validation is stricter than some clients: it validates the content hash shape and enforces `MAX_FILE_CONTENT_BYTES`. Keep that behavior.

### Internal DO Control Routes

These are internal Worker-to-DO routes:

- `/_control/access-refresh`
- `/_control/room-persistence`

They are reached through `env.MapCollaboration.get(id).fetch(...)` from `account-api.ts` and verified with `INTERNAL_AUTH_SECRET`. They are not public API endpoints.

## Target Source Layout

Keep `src/worker.ts` as the stable Cloudflare entrypoint and Durable Object export facade.

```text
src/worker.ts
src/worker/
  entry.ts
  tiles.ts
  room-server.ts
  room-types.ts
  room-constants.ts
  room-auth.ts
  room-control.ts
  room-presence.ts
  room-storage.ts
  room-layer-messages.ts
  room-annotation-messages.ts
  room-file-content.ts
  room-client-update.ts
  json-utils.ts
```

### `src/worker.ts`

Final shape:

```ts
export { MapCollaboration } from './worker/room-server.js';
export { default } from './worker/entry.js';
```

This preserves:

- `wrangler.jsonc` `main = "src/worker.ts"`
- Durable Object `class_name = "MapCollaboration"`
- tests importing `type { MapCollaboration } from './worker.js'`

### `entry.ts`

Owns the exported Worker `fetch` handler and high-level routing:

- prepared WebSocket auth route
- PartyServer route
- CORS preflight
- account API route
- tile route
- static assets fallback

It should not import room storage/message internals.

### `tiles.ts`

Owns:

- `parseTilePath`
- `nativeDecompress`
- `R2Source`
- PMTiles cache
- `handleTileRequest`

Suggested exports:

```ts
export async function handleTileRequest(request, env, ctx): Promise<Response | null>;
```

### `room-types.ts`

Owns DO-local types:

- `JsonRecord`
- `LngLatTuple`
- `RoomPersistence`
- `UserProfile`
- `AuthContext`
- `AccessRefreshUpdate`
- `AccessRefreshMode`
- `ClientType`
- `AgentParticipant`
- `CursorState`
- `LocationState`
- `ViewState`
- `ViewportState`
- `PeerState`

Keep these separate from `layer-model.ts` and CLI package types for now. Cross-package protocol sharing can be a later project.

### `room-constants.ts`

Owns:

- `PROFILE_COLORS`
- `HEX_COLOR_RE`
- `FILE_CONTENT_BINARY_VERSION`
- `MAX_FILE_CONTENT_BYTES`
- `EPHEMERAL_ROOM_TTL_MS`
- `UNREFERENCED_FILE_CONTENT_TTL_MS`
- `AGENT_RECENT_TTL_MS`
- `AGENT_TOUCH_THROTTLE_MS`
- `AUTH_HEADER_MAX_AGE_MS`
- `SQL_READY_KEY`

### `json-utils.ts`

Owns low-level helpers that have no room dependency:

- `isRecord`
- `clampNumber`
- `sanitizeText`
- `encodeMessage`
- `parseJsonRecord`

Be careful not to create a large generic dumping ground. If a helper only makes sense for presence or auth, keep it in that domain file.

### `room-auth.ts`

Owns signature verification and auth/control sanitization:

- `verifyAuthHeaders(request, roomName, secret)`
- `verifyControlRequest(request, roomName, secret, body)`
- `sanitizePeerId`
- `sanitizeRoomRole`
- `sanitizeAuthKind`
- `sanitizeAccessRefreshMode`
- `sanitizeAccessRefreshUpdate`
- `timingSafeEqualHex`
- `hex`

`MapCollaboration` should keep `_verifyAuthHeaders` and `_verifyControlRequest` as thin delegating methods at first, because tests and future debugging already know those method names.

### `room-storage.ts`

Owns room-local SQLite operations:

- schema setup and default annotation layer
- room metadata touch/status/persistence
- layer row upsert/list/get/delete/reorder
- annotation feature row upsert/list/delete/reorder
- file content get/put/prune
- alarm cleanup helpers

Recommended first implementation style:

```ts
export function listLayers(room: MapCollaborationLike): Layer[];
```

Use a narrow `MapCollaborationLike` interface with `name`, `sql`, and `ctx.storage`. Avoid importing the concrete `MapCollaboration` class into storage helpers, or circular dependencies will become hard to manage.

Do not introduce a class-based repository in the first pass. A repository can be useful later, but function extraction is easier to verify.

### `room-presence.ts`

Owns presence and agent state:

- `emptyLocation`
- `sanitizeColor`
- `sanitizeUser`
- `sanitizeClientType`
- `sanitizeAction`
- `sanitizeLngLat`
- `sanitizeViewport`
- `sanitizeCursor`
- `sanitizeLocation`
- `sanitizeViewState`
- `publicPeer`
- agent participant list/touch/prune helpers

Agent participant helpers will need SQL access. Keep their SQL helpers near presence, not in generic storage, because the behavior is presence-specific.

### `room-file-content.ts`

Owns binary protocol and file content message helpers:

- `sanitizeContentHash`
- `normalizeBinaryMessage`
- `decodeFileContentFrame`
- `encodeFileContentFrame`
- `toArrayBuffer`
- optional `handleBinaryFileContentUpload`
- optional `handleFileContentRequest`

Do not deduplicate this with `src/file-layer-sync.ts` or `packages/atlas-realm-cli/src/protocol.ts` in this refactor. They run in different packages/environments, and extracting a shared protocol package would broaden the change.

### `room-layer-messages.ts`

Owns layer protocol mutation handlers:

- `handleLayerMessage`
- create/update/delete/reorder/list request
- edit permission checks
- file layer content existence check
- acknowledgement and broadcast messages

This file depends on:

- `layer-sync.ts`
- `layer-model.ts`
- room storage helpers
- file content helpers
- room permission helpers

### `room-annotation-messages.ts`

Owns annotation feature protocol mutation handlers:

- `handleAnnotationFeatureMessage`
- parent annotation layer validation
- last-write-wins revision increment
- rejected feature messages
- reorder

This file depends on:

- `layer-sync.ts`
- `layer-model.ts`
- room storage helpers

### `room-client-update.ts`

Owns `client:update`:

- agent heartbeat path
- human presence update path
- state sanitization
- `presence:update` broadcast

Keep this separate from layer/annotation handling. It is transient state, not persisted layer state.

### `room-control.ts`

Owns `onRequest` internals:

- access refresh control route
- room persistence control route
- ready text fallback

`MapCollaboration.onRequest` can become:

```ts
return handleRoomControlRequest(this, request);
```

## Migration Plan

### Phase 0: Baseline

Before touching code:

```bash
pnpm typecheck
pnpm test -- src/file-layer-sync.test.ts src/room-ws-auth.test.ts src/worker-api.test.ts
pnpm test:worker
```

Record any existing failures. The refactor should not hide unrelated failures.

### Phase 1: Extract Independent Code

Extract files that do not depend on `MapCollaboration` internals:

1. `worker/tiles.ts`
2. `worker/room-types.ts`
3. `worker/room-constants.ts`
4. `worker/json-utils.ts`
5. `worker/room-file-content.ts`

Keep `src/worker.ts` as the entrypoint during this phase. Replace local definitions with imports.

Expected test focus:

```bash
pnpm typecheck
pnpm test -- src/file-layer-sync.test.ts src/room-ws-auth.test.ts
pnpm test:worker
```

### Phase 2: Extract Auth While Keeping Class Methods

Move auth verification into `room-auth.ts`, but keep the current class methods:

```ts
async _verifyAuthHeaders(request) {
  return verifyAuthHeaders(request, this.name, this.env.INTERNAL_AUTH_SECRET);
}
```

Do the same for control verification.

Why keep the methods:

- `worker.worker.test.ts` exercises the DO through current class behavior.
- Stack traces and debugging remain familiar.
- It avoids mixing auth extraction with message handler extraction.

Expected test focus:

```bash
pnpm test -- src/room-ws-auth.test.ts src/worker-api.test.ts
pnpm test:worker
```

### Phase 3: Extract Storage Helpers Behind Delegating Methods

Move SQL operations to `room-storage.ts`, but keep the current `_` methods on `MapCollaboration` as delegators:

- `_ensureLayerStorage`
- `_touchRoom`
- `_roomStatus`
- `_setRoomPersistence`
- `_ensureDefaultAnnotationLayer`
- `_upsertLayerRow`
- `_layerFromRow`
- `_listLayers`
- `_getLayer`
- `_annotationFeatureFromRow`
- `_listAnnotationFeatures`
- `_upsertAnnotationFeatureRow`
- `_getFileContent`
- `_pruneUnreferencedFileContent`

This keeps current tests compiling while letting production code use smaller modules.

Expected test focus:

```bash
pnpm test:worker
```

### Phase 4: Extract Presence And Agent Helpers

Move presence sanitizers and `publicPeer` to `room-presence.ts`.

Move agent participant SQL helpers either to `room-presence.ts` or to a presence-specific sub-section of `room-storage.ts`. Prefer `room-presence.ts` because these rows model transient participants, not durable content.

Keep `_agentParticipants`, `_touchAgentParticipant`, and `_pruneAgentParticipants` as delegators first.

Expected test focus:

```bash
pnpm test:worker
```

### Phase 5: Split Message Handlers

Only after the low-level pieces are extracted, split `onMessage`:

1. Binary file upload handler.
2. Room status/update handler.
3. Layer message handler.
4. Annotation feature message handler.
5. File content request handler.
6. Legacy protocol error handler.
7. Client presence update handler.

Suggested shape:

```ts
async onMessage(connection, message) {
  await this._touchRoom();
  return handleRoomSocketMessage(this, connection, message);
}
```

`handleRoomSocketMessage` can orchestrate the domain handlers in the same order as today. Preserve order because some messages are intentionally matched before generic client update handling.

Expected test focus:

```bash
pnpm test:worker
pnpm test -- packages/atlas-realm-cli/test/commands.test.ts src/file-layer-sync.test.ts
```

### Phase 6: Extract Control Request Handler

Move `onRequest` route handling to `room-control.ts`.

Keep `MapCollaboration.onRequest` as a one-line delegate. This separates internal HTTP control routes from WebSocket message handling.

Expected test focus:

```bash
pnpm test -- src/worker-api.test.ts
pnpm test:worker
```

### Phase 7: Move `MapCollaboration` And Entrypoint

Move the class body to `worker/room-server.ts` and default handler to `worker/entry.ts`.

Make `src/worker.ts` a facade:

```ts
export { MapCollaboration } from './worker/room-server.js';
export { default } from './worker/entry.js';
```

This should be the final phase, not the first one. Keeping the original file as the edit target during early extraction reduces Cloudflare binding risk.

Expected test focus:

```bash
pnpm typecheck
pnpm test
pnpm test:worker
pnpm build
```

## Test Strategy

The refactor should be guarded by the existing integration-heavy tests first. Add focused unit tests only after a helper is extracted and its behavior is easier to call directly.

### Baseline Suite

Run this before the first extraction and after the final facade move:

```bash
pnpm typecheck
pnpm test
pnpm test:worker
pnpm build
```

This covers:

- browser/client-side protocol helpers and stores through the normal Vitest config.
- account API, room access, WebSocket auth gate, file layer sync, and agent CLI command protocol.
- Durable Object behavior through the Cloudflare worker test pool.
- production bundling with the Cloudflare/Vite plugin.

### Phase-Specific Suites

Use narrower suites while moving code in small steps:

| Refactor Area                 | Primary Checks                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| PMTiles / `tiles.ts`          | `pnpm typecheck`, `pnpm build`; add tile tests later if changing behavior          |
| file content frame extraction | `pnpm test -- src/file-layer-sync.test.ts`, `pnpm test:worker`                     |
| auth extraction               | `pnpm test -- src/room-ws-auth.test.ts src/worker-api.test.ts`, `pnpm test:worker` |
| storage extraction            | `pnpm test:worker`                                                                 |
| presence extraction           | `pnpm test:worker`                                                                 |
| message handler split         | `pnpm test:worker`, plus CLI/file-content protocol tests from Phase 5              |
| control route split           | `pnpm test -- src/worker-api.test.ts`, `pnpm test:worker`                          |
| final facade move             | full baseline suite                                                                |

### Protocol Regression Coverage

Do not consider a phase complete unless these existing behaviors are still covered:

- connect sends `presence:init`, `room:status`, `layer:list`, and `annotation-feature:list`.
- signed WebSocket auth accepts valid headers and rejects stale or tampered headers.
- viewer/editor/manage permission boundaries still emit the same `permission:denied`, `access:updated`, and `access:revoked` messages.
- layer create/update/delete/reorder still persists rows and broadcasts canonical server messages.
- annotation feature upsert/delete/reorder still validates parent layers and increments revisions.
- file layer flow still does `file:content:needed`, binary upload, `file:content:stored`, `layer:create`, `file:content:request`, and binary download.
- old `overlay:*` and `drawing:*` messages still return `protocol:error`.
- ephemeral room alarm still clears room-local tables.

Most of this is already exercised by `src/worker.worker.test.ts`; the point of the refactor is to keep those tests green while moving code.

### New Unit Tests To Add When Useful

Do not front-load these. Add them when the corresponding module exists:

- `worker/room-auth.test.ts`: HMAC payload verification, stale timestamp rejection, timing-safe mismatch behavior, control request verification.
- `worker/room-file-content.test.ts`: malformed binary frames, hash validation, max-size rejection, ArrayBuffer/TypedArray normalization.
- `worker/room-presence.test.ts`: viewport/cursor/location sanitization and `publicPeer` hiding headless/query/agent clients.
- `worker/tiles.test.ts`: tile path parsing and TileJSON/tile response behavior if R2/PMTiles can be mocked cleanly.

These tests should supplement the DO integration tests, not replace them.

### Manual Smoke Test

After the final phase, run the app once against the local dev server and verify:

```bash
pnpm dev
```

Manual checks:

- open a room in two browser tabs and confirm presence, cursors, and following still work.
- create/edit/delete an annotation and verify it appears in the other tab.
- import a small GPX or GeoJSON file layer and verify the other tab downloads and renders it.
- change room sharing/access in the UI and confirm active connections update or revoke correctly.
- load `/tiles/...` through the map and confirm the map still renders base tiles.

## Dependency Direction

Keep dependencies flowing inward like this:

```text
worker.ts
  -> worker/entry.ts
      -> account-api.ts
      -> room-ws-auth.ts
      -> worker/tiles.ts
      -> partyserver routePartykitRequest

worker/room-server.ts
  -> worker/room-control.ts
  -> worker/room-*-messages.ts
  -> worker/room-storage.ts
  -> worker/room-presence.ts
  -> worker/room-auth.ts

worker/room-*-messages.ts
  -> layer-sync.ts
  -> layer-model.ts
  -> room-permissions.ts
  -> worker/room-storage.ts
  -> worker/room-file-content.ts
```

Avoid dependencies in the other direction:

- `account-api.ts` should not import DO internals.
- `room-ws-auth.ts` should not import DO internals.
- `layer-model.ts` and `layer-sync.ts` should not import worker modules.
- `tiles.ts` should not import room modules.

## Risks And Mitigations

### Circular Imports

The biggest risk is `room-storage.ts` importing `MapCollaboration` while `room-server.ts` imports `room-storage.ts`.

Mitigation: define small structural interfaces in helper modules:

```ts
type RoomSqlContext = {
  name: string;
  sql<T>(strings: TemplateStringsArray, ...values: unknown[]): T[];
  ctx: { storage: DurableObjectStorage };
};
```

### Test Coupling To Private Methods

`worker.worker.test.ts` currently calls or types several `_` methods. Do not remove those methods during the refactor. Convert them to delegates first, then decide later whether to update tests to target public behavior or lower-level helpers.

### Message Ordering Drift

Clients depend on the connect snapshot and mutation acknowledgements. Keep `onConnect` send order stable. In `onMessage`, preserve the current matching order:

1. binary upload
2. room metadata
3. layer messages
4. annotation messages
5. file content request
6. legacy protocol error
7. `client:update`

### Permission Check Drift

Every mutating handler must continue to check permissions before storage mutation:

- file content upload: edit
- `room:update`: manage
- layer create/update/delete/reorder: edit
- annotation feature upsert/delete/reorder: edit

Read/list requests stay allowed for connected viewers.

### Auth Header Trust Boundary

Do not let extracted code read unsigned query parameters for permission decisions. Permission checks must use `connection.state.auth.role` when internal auth is configured, with the existing no-secret development fallback preserved.

### Control Route Exposure

`/_control/*` routes must keep HMAC verification and timestamp checks. They should not become normal `/api/*` routes and should not be reachable through the public account API handler.

### Binary Frame Compatibility

The server frame parser validates SHA-256 hex hashes. Keep this stricter validation. Do not switch to JSON/base64 for file content in this refactor.

### Alarm Cleanup Semantics

`onAlarm` clears room tables for expired ephemeral rooms. Splitting storage should not accidentally recreate the default annotation layer during cleanup verification. Be careful with calling `_ensureLayerStorage()` before and after cleanup.

## Suggested Follow-Up After The Split

After the structural split is stable, consider separate follow-up changes:

- add focused tests for extracted pure helpers, especially auth and binary frame parsing.
- decide whether to make `room-storage.ts` a `RoomRepository` class.
- reduce duplicate file-content frame implementations across browser, CLI, and server by creating a shared protocol module or package.
- move tests away from private `_` methods once public behavior has enough coverage.
- document the full room WebSocket protocol in one generated or source-owned place.

These should not be part of the first refactor unless there is a specific bug forcing them.
