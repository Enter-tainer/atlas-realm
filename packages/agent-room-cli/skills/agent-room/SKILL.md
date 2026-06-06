---
name: agent-room
description: Use the ORM agent room CLI to join a live map collaboration room, inspect shared layers and annotations, upload GeoJSON/GPX layers, and create/update/delete travel-planning annotations for users.
---

# Agent Room

Use this skill when a user asks you to work inside an ORM map collaboration room: add itinerary markers, draw route/path/polygon annotations, upload GeoJSON or GPX layers, rename or hide layers, delete stale map content, or inspect the current shared state.

## CLI

Run the packaged CLI:

```bash
orm-agent-room --host <app-origin> --room <room> --client-id <id> <command> --json
```

If working from this repo before package publishing, use:

```bash
pnpm agent:room --host <app-origin> --room <room> --client-id <id> <command> --json
```

Always prefer `--json` for agent automation. Use `--pretty` only for human-readable inspection.

For room commands, `--client-id` is required by this skill. Use a stable, unique identifier for the agent/process/session (e.g. `agent-planner`, `layer-sync-v2`). It is used for connection-level presence and agent identity tracking, so stable ids make it clear which agent made a change. Account commands such as `login`, `whoami`, and `logout` do not need `--client-id`.

Host default order: `ORM_ROOM_HOST` env var → `ROOM_HOST` env var → `http://localhost:5173`.

Production host: `https://map.mgt.moe`

### Authentication

For rooms with access controls enabled, sign in once with GitHub Device Flow:

```bash
orm-agent-room login --host <host>
```

When running as an agent in a non-interactive terminal, avoid keeping the login process open while a human authorizes in the browser. Start the flow, show the user the returned `verificationUrl` and `userCode`, then resume with the returned `flowId` after authorization:

```bash
orm-agent-room login --host <host> --start-only --json
orm-agent-room login --host <host> --flow-id <flowId> --json
```

After login, normal commands automatically use the stored local token:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> <command> --json
```

Useful account commands:

```bash
orm-agent-room whoami --host <host>
orm-agent-room logout --host <host>
```

Manual PAT usage remains available for CI and debugging:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> --token orm_pat_... <command> --json
export ORM_ROOM_TOKEN=orm_pat_...
orm-agent-room --host <host> --room <room> --client-id <id> <command> --json
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
orm-agent-room --host <host> --room <room> --client-id <id> presence --json
orm-agent-room --host <host> --room <room> --client-id <id> --client-type query presence --json
```

Use `presence --json` before context-sensitive edits when you need to know whether users are currently in the room, where they are looking, or which agents were active recently. Do not infer a human user is still online from agent recent activity; humans and agents are separate lists.

## Room

Room metadata includes persistence. Ephemeral rooms expire after inactivity; persistent rooms do not expire on the normal room alarm.

```bash
orm-agent-room --host <host> --room <room> --client-id <id> room status --json
orm-agent-room --host <host> --room <room> --client-id <id> room update --persistence persistent --json
orm-agent-room --host <host> --room <room> --client-id <id> room update --persistence ephemeral --json
```

## Layers

Layers are uploaded map files, usually GeoJSON or GPX.

```bash
orm-agent-room --host <host> --room <room> --client-id <id> layers list --json
orm-agent-room --host <host> --room <room> --client-id <id> layers get trip-route --json
orm-agent-room --host <host> --room <room> --client-id <id> layers metadata trip-route --json
orm-agent-room --host <host> --room <room> --client-id <id> layers content trip-route --json
orm-agent-room --host <host> --room <room> --client-id <id> layers export trip-route --out ./route.geojson --json
orm-agent-room --host <host> --room <room> --client-id <id> layers add ./route.geojson --id trip-route --name "Trip route" --json
orm-agent-room --host <host> --room <room> --client-id <id> layers add ./route.geojson --id trip-route --persistence persistent --json
orm-agent-room --host <host> --room <room> --client-id <id> layers update trip-route --name "Morning route" --visible false --json
orm-agent-room --host <host> --room <room> --client-id <id> layers hide trip-route --json
orm-agent-room --host <host> --room <room> --client-id <id> layers show trip-route --json
orm-agent-room --host <host> --room <room> --client-id <id> layers delete trip-route --json
orm-agent-room --host <host> --room <room> --client-id <id> layers reorder layer-a layer-b --json
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

## Annotations

Annotations are editable planning objects in the shared annotation model.

Point:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> annotations add point --id hotel --lng 121.5 --lat 31.2 --label "Hotel" --json
```

Text:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> annotations add text --id plan-note --coordinate "121.5,31.2" --label "Day 1" --note "Meet at 09:00" --json
```

Path:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> annotations add path --id walk-a --points "121.5,31.2;121.51,31.21" --label "Walk" --line-style dashed --opacity 0.8 --json
```

Polygon:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> annotations add polygon --id area-a --points "121.5,31.2;121.51,31.2;121.51,31.21" --label "Search area" --line-style dotted --opacity 0.9 --fill-opacity 0.25 --json
```

Line, route, and polygon outline style options:

- `--line-style solid|dashed|dotted`
- `--opacity 0.05-1`
- `--fill-opacity 0.05-1` for polygon fill

Update/delete:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> annotations update hotel --label "Updated hotel" --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations delete hotel --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations clear --layer-id annotation-default --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations clear --layer-id annotation-default --hide-layer --json
```

For complex features, pass full JSON with `--feature-file` / `--feature-json`; for partial updates, pass `--patch-file` / `--patch-json`.

Annotation layers:

```bash
orm-agent-room --host <host> --room <room> --client-id <id> annotations layers list --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations layers add notes --name "Notes" --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations layers hide notes --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations layers clear notes --json
orm-agent-room --host <host> --room <room> --client-id <id> annotations layers delete notes --json
```

## Travel Planning Conventions

- Use points for POIs, hotels, stations, restaurants, meeting spots, and warnings.
- Use routes (via `annotations add route`) for road trip daily segments. Use AMAP (高德) or OSRM for real road geometry — never hand-draw straight lines.
- Split long driving days (>5h) into shorter segments with activity stops in between.
- Use warm+cool color palettes by geographic region (not all one hue). Example: green for valleys, violet for mountains, orange for desert cities, cyan for plateau.
- Use `--line-style dashed` / `--line-style dotted` with low opacity (0.35–0.55) for backup/detour routes to visually distinguish them from main routes.
- Annotation layers should have descriptive names reflecting their content (e.g. "🏔️ 伊犁+独库+帕米尔 10天" not "Annotations").
- Group related routes, activities, and risk markers in the same annotation layer.
- Keep labels short; put details in `--note`.
