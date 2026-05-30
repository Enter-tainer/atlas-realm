---
name: agent-room
description: Use the ORM agent room CLI to join a live map collaboration room, inspect shared layers and annotations, upload GeoJSON/GPX layers, and create/update/delete travel-planning annotations for users.
---

# Agent Room

Use this skill when a user asks you to work inside an ORM map collaboration room: add itinerary markers, draw route/path/polygon annotations, upload GeoJSON or GPX layers, rename or hide layers, delete stale map content, or inspect the current shared state.

## CLI

Run the packaged CLI:

```bash
orm-agent-room --host <app-origin> --room <room> <command> --json
```

If working from this repo before package publishing, use:

```bash
pnpm agent:room --host <app-origin> --room <room> <command> --json
```

Always prefer `--json` for agent automation. Use `--pretty` only for human-readable inspection.

By default, CLI calls identify as `--client-type agent` and refresh that agent's recent activity in the room. Use `--client-type query` for read-only checks that should not update agent activity.

## Workflow

1. Start with `snapshot --json` unless the user explicitly gave the exact object id and desired mutation. Use `snapshot --content --json` when you need decoded layer contents for the whole room.
2. Make one focused mutation at a time.
3. Read back the object with `layers get <id> --json` or `annotations get <id> --json` after important writes.
4. Use stable ids when you create objects so later turns can update/delete them.
5. Report the ids you created or changed.

## Presence

Presence shows live human users from current WebSocket connections and recent agent users from server-maintained room state.

```bash
orm-agent-room --host <host> --room <room> presence --json
orm-agent-room --host <host> --room <room> --client-type query presence --json
```

Use `presence --json` before context-sensitive edits when you need to know whether users are currently in the room, where they are looking, or which agents were active recently. Do not infer a human user is still online from agent recent activity; humans and agents are separate lists.

## Room

Room metadata includes persistence. Ephemeral rooms expire after inactivity; persistent rooms do not expire on the normal room alarm.

```bash
orm-agent-room --host <host> --room <room> room status --json
orm-agent-room --host <host> --room <room> room update --persistence persistent --json
orm-agent-room --host <host> --room <room> room update --persistence ephemeral --json
```

## Layers

Layers are uploaded map files, usually GeoJSON or GPX.

```bash
orm-agent-room --host <host> --room <room> layers list --json
orm-agent-room --host <host> --room <room> layers get trip-route --json
orm-agent-room --host <host> --room <room> layers metadata trip-route --json
orm-agent-room --host <host> --room <room> layers content trip-route --json
orm-agent-room --host <host> --room <room> layers export trip-route --out ./route.geojson --json
orm-agent-room --host <host> --room <room> layers add ./route.geojson --id trip-route --name "Trip route" --json
orm-agent-room --host <host> --room <room> layers add ./route.geojson --id trip-route --persistence persistent --json
orm-agent-room --host <host> --room <room> layers update trip-route --name "Morning route" --visible false --json
orm-agent-room --host <host> --room <room> layers hide trip-route --json
orm-agent-room --host <host> --room <room> layers show trip-route --json
orm-agent-room --host <host> --room <room> layers delete trip-route --json
orm-agent-room --host <host> --room <room> layers reorder layer-a layer-b --json
```

`layers get` and `layers content` return the layer row plus its contents: annotation layers include `annotations`, file layers include decoded `content` (GeoJSON object or GPX text).
Use `layers metadata` for only the layer row. Use `layers export` to write decoded file content or annotation-layer contents to disk.

Layer style options:

- `--color "#3b82f6"`
- `--opacity 0.8`
- `--line-width 5`
- `--visible true|false`

## Annotations

Annotations are editable planning objects in the shared annotation model.

Point:

```bash
orm-agent-room --host <host> --room <room> annotations add point --id hotel --lng 121.5 --lat 31.2 --label "Hotel" --json
```

Text:

```bash
orm-agent-room --host <host> --room <room> annotations add text --id plan-note --coordinate "121.5,31.2" --label "Day 1" --note "Meet at 09:00" --json
```

Path:

```bash
orm-agent-room --host <host> --room <room> annotations add path --id walk-a --points "121.5,31.2;121.51,31.21" --label "Walk" --json
```

Polygon:

```bash
orm-agent-room --host <host> --room <room> annotations add polygon --id area-a --points "121.5,31.2;121.51,31.2;121.51,31.21" --label "Search area" --json
```

Update/delete:

```bash
orm-agent-room --host <host> --room <room> annotations update hotel --label "Updated hotel" --json
orm-agent-room --host <host> --room <room> annotations delete hotel --json
orm-agent-room --host <host> --room <room> annotations clear --layer-id annotation-default --json
orm-agent-room --host <host> --room <room> annotations clear --layer-id annotation-default --hide-layer --json
```

For complex features, pass full JSON with `--feature-file` / `--feature-json`; for partial updates, pass `--patch-file` / `--patch-json`.

Annotation layers:

```bash
orm-agent-room --host <host> --room <room> annotations layers list --json
orm-agent-room --host <host> --room <room> annotations layers add notes --name "Notes" --json
orm-agent-room --host <host> --room <room> annotations layers hide notes --json
orm-agent-room --host <host> --room <room> annotations layers clear notes --json
orm-agent-room --host <host> --room <room> annotations layers delete notes --json
```

## Travel Planning Conventions

- Use points for POIs, hotels, stations, restaurants, meeting spots, and warnings.
- Use paths for suggested walking/transit segments when exact route geometry is simple.
- Use polygons for candidate neighborhoods, avoid zones, or search areas.
- Use text annotations for concise instructions tied to a coordinate.
- Keep labels short; put details in `--note`.
