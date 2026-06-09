---
name: atlas-realm
description: Use the Atlas Realm CLI to join a live map collaboration room, inspect shared layers and annotations, upload GeoJSON/GPX layers, and create/update/delete travel-planning annotations for users.
---

# Atlas Realm

Use this skill when a user asks you to work inside an Atlas Realm collaboration room: add itinerary markers, draw route/path/polygon annotations, upload GeoJSON or GPX layers, rename or hide layers, delete stale map content, or inspect the current shared state.

## CLI

Run the packaged CLI:

```bash
atlas-realm --host <app-origin> --room <room> --client-id <id> <command> --json
```

If working from this repo before package publishing, use:

```bash
pnpm atlas:realm --host <app-origin> --room <room> --client-id <id> <command> --json
```

Always prefer `--json` for agent automation. Use `--pretty` only for human-readable inspection.

For room commands, `--client-id` is required by this skill. Use a stable, unique identifier for the agent/process/session (e.g. `agent-planner`, `layer-sync-v2`). It is used for connection-level presence and agent identity tracking, so stable ids make it clear which agent made a change. Account commands such as `login`, `whoami`, and `logout` do not need `--client-id`.

Host default order: `ATLAS_REALM_HOST` env var → `ROOM_HOST` env var → `http://localhost:5173`.

Production host: `https://map.mgt.moe`

### Authentication

For rooms with access controls enabled, sign in once with GitHub Device Flow:

```bash
atlas-realm login --host <host>
```

When running as an agent in a non-interactive terminal, avoid keeping the login process open while a human authorizes in the browser. Start the flow, show the user the returned `verificationUrl` and `userCode`, then resume with the returned `flowId` after authorization:

```bash
atlas-realm login --host <host> --start-only --json
atlas-realm login --host <host> --flow-id <flowId> --json
```

After login, normal commands automatically use the stored local token:

```bash
atlas-realm --host <host> --room <room> --client-id <id> <command> --json
```

Useful account commands:

```bash
atlas-realm whoami --host <host>
atlas-realm logout --host <host>
```

Manual PAT usage remains available for CI and debugging:

```bash
atlas-realm --host <host> --room <room> --client-id <id> --token orm_pat_... <command> --json
export ATLAS_REALM_TOKEN=orm_pat_...
atlas-realm --host <host> --room <room> --client-id <id> <command> --json
```

The token authenticates the agent as its owning GitHub user. Room access is computed by the server from link-access settings and explicit grants, same as for browser sessions.

By default, CLI calls identify as `--client-type agent` and refresh that agent's recent activity in the room. Use `--client-type query` for read-only checks that should not update agent activity.

## Room URL

The web client URL uses the `room` query parameter:

```
https://<host>/?room=<room-name>
```

Example: `https://map.mgt.moe/?room=niutoushan`

## Workflow

1. Start with `snapshot --json` unless the user explicitly gave the exact object id and desired mutation. Use `snapshot --content --json` when you need decoded layer contents for the whole room.
2. Make one focused mutation at a time.
3. Read back the object with `layers get <id> --json` or `annotations get <id> --json` after important writes.
4. Use stable ids when you create objects so later turns can update/delete them.
5. Report the ids you created or changed.

## Presence

Presence shows live human users from current WebSocket connections and recent agent users from server-maintained room state.

```bash
atlas-realm --host <host> --room <room> --client-id <id> presence --json
atlas-realm --host <host> --room <room> --client-id <id> --client-type query presence --json
```

Use `presence --json` before context-sensitive edits when you need to know whether users are currently in the room, where they are looking, or which agents were active recently. Do not infer a human user is still online from agent recent activity; humans and agents are separate lists.

## Room

Room metadata includes persistence. Ephemeral rooms expire after inactivity; persistent rooms do not expire on the normal room alarm.

```bash
atlas-realm --host <host> --room <room> --client-id <id> room status --json
atlas-realm --host <host> --room <room> --client-id <id> room update --persistence persistent --json
atlas-realm --host <host> --room <room> --client-id <id> room update --persistence ephemeral --json
```

## Layers

Layers are uploaded map files, usually GeoJSON or GPX.

```bash
atlas-realm --host <host> --room <room> --client-id <id> layers list --json
atlas-realm --host <host> --room <room> --client-id <id> layers get trip-route --json
atlas-realm --host <host> --room <room> --client-id <id> layers metadata trip-route --json
atlas-realm --host <host> --room <room> --client-id <id> layers content trip-route --json
atlas-realm --host <host> --room <room> --client-id <id> layers export trip-route --out ./route.geojson --json
atlas-realm --host <host> --room <room> --client-id <id> layers add ./route.geojson --id trip-route --name "Trip route" --json
atlas-realm --host <host> --room <room> --client-id <id> layers add ./route.geojson --id trip-route --persistence persistent --json
atlas-realm --host <host> --room <room> --client-id <id> layers update trip-route --name "Morning route" --visible false --json
atlas-realm --host <host> --room <room> --client-id <id> layers hide trip-route --json
atlas-realm --host <host> --room <room> --client-id <id> layers show trip-route --json
atlas-realm --host <host> --room <room> --client-id <id> layers delete trip-route --json
atlas-realm --host <host> --room <room> --client-id <id> layers reorder layer-a layer-b --json
```

`layers get` and `layers content` return the layer row plus its contents: annotation layers include `annotations`, file layers include decoded `content` (GeoJSON object or GPX text).
Use `layers metadata` for only the layer row. Use `layers export` to write decoded file content or annotation-layer contents to disk.

Layer style options:

- `--color "#3b82f6"`
- `--opacity 0.8`
- `--line-width 5`
- `--visible true|false`

## Pitfalls

1. **`layers add --opacity` may not take effect on initial upload**: After adding a layer, verify with `snapshot` and apply `layers update <id> --opacity <value>` if needed.

2. **Route feature file `geometry` format**: When using `--feature-file` for route annotations, `geometry` must be a flat `[[lng,lat], ...]` array, NOT a GeoJSON Geometry object (`{"type":"LineString","coordinates":[...]}`). Passing a GeoJSON object causes the CLI to fall back to waypoints-only (straight line).

3. **Route annotation styles on `add`**: Use the correct flag names: `--width` (not `--line-width`), `--color`, `--opacity`, `--line-style`. Wrong flag names are silently ignored by `annotations add route`, leaving routes at default styles.

4. **GCJ-02 vs WGS-84 coordinate systems**: AMAP (高德) returns coordinates in GCJ-02 (国测局偏移坐标系). The map tiles use WGS-84 (international standard). GCJ-02 coordinates are offset by ~300-500m in China. ALL AMAP-sourced coordinates MUST be converted from GCJ-02 to WGS-84 before adding to the map. Sample offset at 31°N/119°E: ~460m east, ~255m south. If annotations appear offset from roads, coordinate system mismatch is the likely cause.

5. **`execute_code` / subprocess shell escaping**: When delegating CLI calls through Python `subprocess.run` with `shell=True` + f-strings, CLI arguments can be silently dropped (especially those with quotes, colors, or special chars). Prefer direct terminal CLI calls for mutation commands. Verify with `annotations get <id> --json` after critical writes.

6. **Snapshot JSON is large**: Route geometry arrays can make snapshot output >1MB. Redirect to file (`> /tmp/snap.json`) instead of parsing from terminal tool output, which truncates at ~20K chars.

7. **Server does not perform routing**: Atlas Realm stores route annotations as-is — it does not call OSRM, AMAP, or any routing API. Agents must fetch road geometry from an external routing service and pass the result via `--geometry`. Using `--waypoints` alone produces straight lines, not real roads.

## Annotations

Annotations are editable planning objects in the shared annotation model.

Point:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add point --id hotel --lng 121.5 --lat 31.2 --label "Hotel" --json
```

Text:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add text --id plan-note --coordinate "121.5,31.2" --label "Day 1" --note "Meet at 09:00" --json
atlas-realm --host <host> --room <room> --client-id <id> annotations add text --id plan-note --coordinate "121.5,31.2" --label "Day 1" --note-file ./plan-note.txt --json
```

Path:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add path --id walk-a --points "121.5,31.2;121.51,31.21" --label "Walk" --line-style dashed --opacity 0.8 --json
```

Polygon:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add polygon --id area-a --points "121.5,31.2;121.51,31.2;121.51,31.21" --label "Search area" --line-style dotted --opacity 0.9 --fill-opacity 0.25 --json
```

Route:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add route --id day1-drive --waypoints "121.5,31.2;121.8,31.5" --geometry "121.5,31.2;121.51,31.22;121.6,31.35;121.7,31.42;121.8,31.5" --profile driving --label "Day 1 Drive" --color "#0f766e" --width 5 --opacity 0.95 --json
```

**Architecture: server does not perform routing.** Route annotations require `--waypoints` (start/end/via points) and `--geometry` (the actual road path). The agent must obtain road geometry from an external routing service (OSRM, AMAP/高德, etc.) and pass it directly to Atlas Realm. The server stores and renders route data as-is — it does not call any routing API. When `--geometry` is omitted, the route renders as a straight line between waypoints.

Route options:

- `--waypoints "lng,lat;lng,lat"` — at least two waypoints (required)
- `--geometry "lng,lat;lng,lat"` — road path from a routing engine (recommended)
- `--profile driving|walking|cycling` — route profile (default: driving)
- `--directed true|false` — direction arrow (default: true)
- `--width <number>` — line width (default: 5)
- `--distance <meters>` — route distance in meters
- `--duration <seconds>` — route duration in seconds
- `--distance-text "..."` — human-readable distance label
- `--duration-text "..."` — human-readable duration label

Line, route, and polygon outline style options:

- `--line-style solid|dashed|dotted`
- `--opacity 0.05-1`
- `--fill-opacity 0.05-1` for polygon fill

Update/delete:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations update hotel --label "Updated hotel" --json
atlas-realm --host <host> --room <room> --client-id <id> annotations delete hotel --json
atlas-realm --host <host> --room <room> --client-id <id> annotations clear --layer-id annotation-default --json
atlas-realm --host <host> --room <room> --client-id <id> annotations clear --layer-id annotation-default --hide-layer --json
```

For multiline labels or notes, prefer UTF-8 files with `--label-file` / `--note-file` so shell quoting does not alter line breaks. For complex features, pass full JSON with `--feature-file` / `--feature-json`; for partial updates, pass `--patch-file` / `--patch-json`.

Annotation layers:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations layers list --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers add notes --name "Notes" --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers hide notes --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers clear notes --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers delete notes --json
```

## Travel Planning Conventions

- Use points for POIs, hotels, stations, restaurants, meeting spots, and warnings.
- Use routes (via `annotations add route`) for road trip daily segments. **The agent must fetch real road geometry from an external routing service** (OSRM, AMAP/高德, etc.) and pass it via `--geometry`. The server stores and renders the geometry as-is — it does not perform routing. Never hand-draw straight lines between waypoints.
- Split long driving days (>5h) into shorter segments with activity stops in between.
- Use warm+cool color palettes by geographic region (not all one hue). Example: green for valleys, violet for mountains, orange for desert cities, cyan for plateau.
- Use `--line-style dashed` / `--line-style dotted` with low opacity (0.35–0.55) for backup/detour routes to visually distinguish them from main routes.
- Annotation layers should have descriptive names reflecting their content (e.g. "🏔️ 伊犁+独库+帕米尔 10天" not "Annotations").
- Group related routes, activities, and risk markers in the same annotation layer.
- Keep labels short; put details in `--note`.
