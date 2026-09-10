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

1. Start with `snapshot --json` unless the user explicitly gave the exact object id and desired mutation. Use `snapshot --content --json` when you need decoded layer contents for the whole room. Snapshot output is often larger than 1 MB because route geometry dominates it, so redirect it to a file (`> /tmp/snap.json`) and read that — terminal output is truncated around 20 KB. Add `--client-type query` to keep a read-only pass out of the room's agent activity.
2. Make one focused mutation at a time.
3. Capture the id the server assigned to each object you create, and reuse it for later `get` / `update` / `delete` / `reorder` (see [Entity ids and ordering](#entity-ids-and-ordering-server-authoritative)).
4. Read back the object with `layers get <id> --json` or `annotations get <id> --json` after important writes.
5. Report the ids you created or changed.

## Entity ids and ordering (server-authoritative)

Identity and order live on the server (`docs/room-sync-v2.md` §9–§10). Two consequences for agents:

**Creating never reuses the id you pass.** `create` means "make a new object": the server assigns `layer-<uuid>` for layers (annotation and file alike) and `feature-<uuid>` for annotations (point / text / path / polygon / route). An `--id` on `add` is only a batch-local reference for linking commands inside one batch — it is not stored. Read the real id from the command result and use it afterwards:

```bash
atlas-realm ... annotations add point --lng 121.5 --lat 31.2 --label "Hotel" --json
# => {"annotation":{"id":"feature-9f3c…"}}   ← address this id from now on
atlas-realm ... annotations get feature-9f3c… --json
atlas-realm ... annotations update feature-9f3c… --label "Hotel (checked in)" --json
```

Objects that already exist keep their ids, so pre-v2 rooms can still hold readable ids (`day3-routes`, `poi-hotel`) that `get` / `update` / `delete` / `reorder` accept. For new objects, express meaning through `--name` / `--label` instead of trying to choose the id.

**Order is a server field, not a client attribute.** `--sort-key` is ignored on create and on layer update: the server renumbers every sibling's `sortKey` to `(position + 1) * 10` (9-digit: `000000010`, `000000020`, …) whenever an object is created or deleted. New objects therefore land at the end of their layer, and sort keys of untouched siblings can change between snapshots — diff by id, never by sortKey. To set an order, send an explicit reorder, which the client translates into anchored `moveBefore` commands:

```bash
# layer order: pass every layer id, in the order you want
atlas-realm ... annotations layers reorder annotation-default day-1-routes day-2-routes --json
# annotation order inside one layer
atlas-realm ... annotations reorder seg-d1-01 seg-d1-02 seg-d1-03 --layer-id day-1-routes --json
```

A partial list moves the listed ids to the front in that order and keeps the rest behind them, so pass the complete list when you want a full custom order. An `annotations update <id> --layer-id <other-layer>` moves an annotation to a different annotation layer.

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

Layers are uploaded map files (usually GeoJSON or GPX) or annotation layers that hold editable annotations.

```bash
atlas-realm --host <host> --room <room> --client-id <id> layers list --json
atlas-realm --host <host> --room <room> --client-id <id> layers add ./route.geojson --name "Trip route" --json   # => layer-<uuid>
atlas-realm --host <host> --room <room> --client-id <id> layers add ./route.geojson --persistence persistent --json
atlas-realm --host <host> --room <room> --client-id <id> layers get <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> layers metadata <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> layers content <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> layers export <layer-id> --out ./route.geojson --json
atlas-realm --host <host> --room <room> --client-id <id> layers update <layer-id> --name "Morning route" --visible false --json
atlas-realm --host <host> --room <room> --client-id <id> layers hide <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> layers show <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> layers delete <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> layers reorder <layer-id-1> <layer-id-2> --json
```

`layers get` and `layers content` return the layer row plus its contents: annotation layers include `annotations`, file layers include decoded `content` (GeoJSON object or GPX text).
Use `layers metadata` for only the layer row. Use `layers export` to write decoded file content or annotation-layer contents to disk.

`<layer-id>` is always an id the server handed back earlier (from `layers add`, `layers list`, or `snapshot`) — you cannot choose it at create time, and re-uploading to the same id goes through `layers replace <layer-id>`, not a second `layers add`.

Layer style options:

- `--color "#3b82f6"`
- `--opacity 0.8`
- `--line-width 5`
- `--visible true|false`

`layers add --opacity` may not take effect on the initial upload. Verify with `snapshot` and re-apply with `layers update <layer-id> --opacity <value>` if the layer renders at the wrong opacity.

## Annotations

Annotations are editable planning objects in the shared annotation model: point, text, path, polygon, route, weather. Every `annotations add` returns the object with its server-assigned id — that return value, not the `--id` you typed, is what later commands address.

### Points

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add point --lng 121.5 --lat 31.2 --label "Hotel" --json
```

### Text and notes

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add text --coordinate "121.5,31.2" --label "Day 1" --note "Meet at 09:00" --json
atlas-realm --host <host> --room <room> --client-id <id> annotations add text --coordinate "121.5,31.2" --label "Day 1" --note-file ./plan-note.md --json
```

`--note` supports **Markdown** formatting. Rendered inline on text-note bodies and annotation popups (bold, italic, links, lists, code blocks, blockquotes, headings, images).

Note markdown examples:

````bash
# Bold + link
atlas-realm ... annotations add text --coordinate "121.5,31.2" --label "Sichuan branch" \
  --note "Station **Chengdu** ([OSM](https://www.openstreetmap.org/node/244076593))" --json

# Unordered list
atlas-realm ... annotations add text --coordinate "121.5,31.2" --label "Packing list" \
  --note "- Passport\n- Sunglasses\n- Sunscreen SPF 50\n- Hiking boots" --json

# Blockquote for warnings
atlas-realm ... annotations add text --coordinate "121.5,31.2" --label "Altitude warning" \
  --note "> Altitude sickness risk above 4000m\n\nAcclimatize for 24h before attempting the pass." --json

# Code block for technical notes
atlas-realm ... annotations add text --coordinate "121.5,31.2" --label "Radio freqs" \
  --note '```\nRX 439.500 MHz\nTX 434.500 MHz\nCTCSS 88.5 Hz\n```' --json
````

Use `--note-file` with a `.md` file for longer markdown content to avoid shell escaping issues.

### Paths and polygons

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add path --points "121.5,31.2;121.51,31.21" --label "Walk" --line-style dashed --opacity 0.8 --json
atlas-realm --host <host> --room <room> --client-id <id> annotations add polygon --points "121.5,31.2;121.51,31.2;121.51,31.21" --label "Search area" --line-style dotted --opacity 0.9 --fill-opacity 0.25 --json
```

### Routes

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations add route --waypoints "121.5,31.2;121.8,31.5" --geometry "121.5,31.2;121.51,31.22;121.6,31.35;121.7,31.42;121.8,31.5" --profile driving --label "Day 1 Drive" --color "#0f766e" --width 5 --opacity 0.95 --json
atlas-realm --host <host> --room <room> --client-id <id> annotations add route --layer-id day-1-routes --ensure-layer --name "Day 1 Routes" --waypoints "121.5,31.2;121.8,31.5" --geometry "121.5,31.2;121.51,31.22;121.6,31.35;121.7,31.42;121.8,31.5" --json
```

**The server does not perform routing.** A route annotation stores what you send: `--waypoints` (start/end/via points) plus `--geometry` (the actual road path). Fetch the geometry yourself from an external routing service (OSRM, AMAP/高德, …) and pass it in. Omit `--geometry` and the route renders as a straight line between waypoints — never do that for a real itinerary.

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

Route style flags are `--width` (not `--line-width`), `--color`, `--opacity`, `--line-style`. `annotations add route` silently ignores unknown flag names, so a typo leaves the route at default styling instead of failing — check the rendered result, not just `ok: true`.

Line, route, and polygon outline style options:

- `--line-style solid|dashed|dotted`
- `--opacity 0.05-1`
- `--fill-opacity 0.05-1` for polygon fill

### Weather cards

A weather annotation pins a forecast card at a coordinate. The coordinate is the place being forecast, and `--date`/`--days` pick which days:

```bash
# Today's forecast for a place
atlas-realm --host <host> --room <room> --client-id <id> annotations add weather --coordinate "121.5,31.2" --label "Shanghai" --json

# A three-day window starting 2026-06-01
atlas-realm --host <host> --room <room> --client-id <id> annotations add weather --coordinate "121.5,31.2" --label "Shanghai" --date 2026-06-01 --days 3 --json

# An explicit single day
atlas-realm --host <host> --room <room> --client-id <id> annotations add weather --lng 121.5 --lat 31.2 --date 2026-06-01 --json
```

Weather options:

- `--coordinate "lng,lat"` or `--lng/--lat` — the place to forecast (required)
- `--date YYYY-MM-DD` — first forecast day (default: today)
- `--days <1-30>` — number of consecutive days (default: 1). Ask for one day,
  or the length of a short stay: weather a fortnight out is a guess, and 30 is
  only the input limit, not a supported horizon. The daily numbers come from
  Open-Meteo — the deterministic forecast covers roughly the first 15 days, and
  anything past that falls back to `gfs05` ensemble member averages (out to
  ~35 days), which are probabilistic rather than a forecast of record.
- `--label "..."` — place name shown on the card and in the forecast
- `--note "..."` — Markdown note shown in the card tooltip / editor
- `--color <hex>` — card accent color

On the map a weather annotation is collapsed by default: a dot plus one line of text (condition icon, high/low, humidity, precipitation in mm — a range shows its first day only). One click expands it straight into the full card: place and date range in the header, one row for a single day or one cell per day for a range (each day's humidity and rain total in its tooltip), and the embedded weather.mgt.moe dashboard. Below zoom 7 only a bare dot is drawn. Create one weather card per place; a multi-city trip is several cards.

#### Coordinate system: send WGS-84

Map tiles are WGS-84. AMAP/高德 (and anything else built on GCJ-02) returns coordinates offset by roughly 300–500 m inside China, so convert every AMAP-sourced coordinate from GCJ-02 to WGS-84 before writing it into a `--lng/--lat`, `--coordinate`, `--points`, `--waypoints`, or `--geometry` value. Sample offset at 31°N/119°E: ~460 m east, ~255 m south. If annotations sit consistently beside the roads they should follow, a coordinate-system mismatch is the first thing to check.

#### Passing geometry in bulk

When a feature is too big for the command line, pass full JSON with `--feature-file` / `--feature-json`, and keep `geometry` a flat `[[lng,lat], …]` array:

```json
{
  "type": "route",
  "waypoints": [
    [121.5, 31.2],
    [121.8, 31.5]
  ],
  "geometry": [
    [121.5, 31.2],
    [121.51, 31.22],
    [121.8, 31.5]
  ]
}
```

A GeoJSON Geometry object (`{"type":"LineString","coordinates":[…]}`) is not accepted here: the CLI falls back to waypoints-only, and the route collapses to a straight line.

### Updating, deleting, and layer targeting

`annotations update` / `annotations delete` address an object that already exists, by its server-assigned id:

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations update feature-9f3c… --label "Updated hotel" --json
atlas-realm --host <host> --room <room> --client-id <id> annotations delete feature-9f3c… --json
atlas-realm --host <host> --room <room> --client-id <id> annotations clear --layer-id <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> annotations clear --layer-id <layer-id> --hide-layer --json
```

For multiline labels or notes, prefer UTF-8 files with `--label-file` / `--note-file` so shell quoting does not alter line breaks. For complex features, pass full JSON with `--feature-file` / `--feature-json`; for partial updates, pass `--patch-file` / `--patch-json`.

Layer targeting:

- `--layer-id <id>` writes the annotation into an existing annotation layer.
- By default, the CLI fails before writing if the target layer does not exist or is a file layer. The JSON error includes `code`, `layerId`, `existingAnnotationLayerIds`, and a suggested create command.
- Use `--ensure-layer` with `--layer-id` when a batch script should create the annotation layer if it is missing. Optional `--name` and `--visible` apply to the new layer only; `--sort-key` is not honored (the server owns order — see [Entity ids and ordering](#entity-ids-and-ordering-server-authoritative)).

### Annotation layers

```bash
atlas-realm --host <host> --room <room> --client-id <id> annotations layers list --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers add --name "Notes" --json   # => layer-<uuid>
atlas-realm --host <host> --room <room> --client-id <id> annotations layers hide <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers clear <layer-id> --json
atlas-realm --host <host> --room <room> --client-id <id> annotations layers delete <layer-id> --json
```

Annotation-layer ids are server-assigned like every other id; `annotations layers add` is where a new one comes into existence, and everything afterwards addresses the returned `layer-<uuid>`.

## Scripting many mutations

Agents usually batch this work in a script. Two habits keep the batches honest:

- Write each payload to a JSON file and pass `--feature-file` / `--patch-file`, instead of building long command lines or `shell=True` + f-string pipelines. Those pipelines can silently drop arguments containing quotes, `#` colors, or other special characters, and the command then looks successful while writing the wrong value.
- Read the object back with `annotations get <id> --json` (or `snapshot`) after critical writes. A successful response only means the command was accepted; it does not prove the field landed the way you intended.

## Travel Planning Conventions

- Use points for POIs, hotels, stations, restaurants, meeting spots, and warnings.
- Use routes (via `annotations add route`) for road trip daily segments, always with geometry fetched from a routing service as described above.
- Split long driving days (>5h) into shorter segments with activity stops in between.
- Use warm+cool color palettes by geographic region (not all one hue). Example: green for valleys, violet for mountains, orange for desert cities, cyan for plateau.
- Use `--line-style dashed` / `--line-style dotted` with low opacity (0.35–0.55) for backup/detour routes to visually distinguish them from main routes.
- Annotation layers should have descriptive names reflecting their content (e.g. "🏔️ 伊犁+独库+帕米尔 10天" not "Annotations").
- Group related routes, activities, and risk markers in the same annotation layer.
