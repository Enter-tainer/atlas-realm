import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { executeCommand } from './commands.js';
import { createConfig } from './config.js';
import { formatOutput } from './format.js';
import { RoomClient } from './room-client.js';
import type { Command, JsonRecord } from './types.js';

const FEATURE_TYPES = ['point', 'text', 'path', 'polygon', 'route'];

export function buildParser(argv: readonly string[] = []) {
  return yargs(argv)
    .scriptName('orm-agent-room')
    .usage('$0 <command> [options]')
    .option('host', {
      type: 'string',
      describe: 'App origin or WebSocket host',
      default: process.env.ORM_ROOM_HOST || process.env.ROOM_HOST || 'http://localhost:5173',
    })
    .option('room', {
      type: 'string',
      describe: 'Collaboration room',
      default: 'main',
    })
    .option('party', {
      type: 'string',
      describe: 'PartyServer durable object route name',
      default: 'map-collaboration',
    })
    .option('client-id', {
      type: 'string',
      describe: 'WebSocket client id',
    })
    .option('agent-name', {
      type: 'string',
      describe: 'Presence name and default annotation updatedBy',
      default: 'Agent',
    })
    .option('agent-color', {
      type: 'string',
      describe: 'Presence color',
      default: '#4f46e5',
    })
    .option('client-type', {
      choices: ['agent', 'query'],
      describe: 'Room client identity for this connection',
      default: 'agent',
    })
    .option('timeout', {
      type: 'number',
      describe: 'WebSocket wait timeout in milliseconds',
      default: 10_000,
    })
    .option('json', {
      type: 'boolean',
      describe: 'Print compact JSON',
    })
    .option('pretty', {
      type: 'boolean',
      describe: 'Pretty-print JSON',
    })
    .command(['snapshot', 'status'], 'Print room layers and drawing state', () => {}, runSnapshot)
    .command(['presence', 'users', 'participants'], 'Print live users and recent agents', () => {}, runPresence)
    .command(
      [
        'layers <action> [items..]',
        'layer <action> [items..]',
        'overlays <action> [items..]',
        'overlay <action> [items..]',
      ],
      'Manage shared GeoJSON/GPX layers',
      layerBuilder,
      runLayer,
    )
    .command(
      ['annotations <action> [items..]', 'annotation <action> [items..]', 'drawing <action> [items..]'],
      'Manage shared annotations',
      annotationBuilder,
      runAnnotation,
    )
    .demandCommand(1)
    .strictCommands()
    .help()
    .alias('h', 'help')
    .parserConfiguration({
      'boolean-negation': false,
      'camel-case-expansion': true,
      'duplicate-arguments-array': false,
    });
}

async function runPresence(args: JsonRecord): Promise<void> {
  await runRoomCommand(
    {
      subject: 'presence',
      action: 'list',
    },
    args,
  );
}

export async function runCli(argv: string[] = hideBin(process.argv), io: Console = console): Promise<void> {
  const parser = buildParser();
  await parser.parseAsync(argv, { io });
}

function layerBuilder(y: any): any {
  return y
    .positional('action', {
      describe: 'list|get|add|upsert|update|patch|delete|remove|rm|reorder',
      type: 'string',
    })
    .positional('items', {
      describe: 'Command arguments such as file path or ids',
      type: 'string',
      array: true,
    })
    .option('id', { type: 'string', describe: 'Layer id' })
    .option('file', { type: 'string', describe: 'GeoJSON or GPX file path' })
    .option('type', { choices: ['geojson', 'gpx'], describe: 'Layer content type' })
    .option('name', { type: 'string', describe: 'Layer display name' })
    .option('color', { type: 'string', describe: 'Layer color hex' })
    .option('opacity', { type: 'number', describe: 'Layer opacity, 0.2-1' })
    .option('line-width', { type: 'number', describe: 'Layer line width, 1-12' })
    .option('visible', { type: 'boolean', describe: 'Layer visibility' })
    .option('persistence', { choices: ['ephemeral', 'persistent'], describe: 'Room persistence hint' });
}

function annotationBuilder(y: any): any {
  return y
    .positional('action', {
      describe: 'list|get|add|upsert|update|patch|delete|remove|rm|reorder|layers',
      type: 'string',
    })
    .positional('items', {
      describe: 'Command arguments such as ids, feature type, or ordered ids',
      type: 'string',
      array: true,
    })
    .option('feature-file', { type: 'string', describe: 'Full DrawingFeature JSON file' })
    .option('feature-json', { type: 'string', describe: 'Full DrawingFeature JSON string' })
    .option('patch-file', { type: 'string', describe: 'Patch JSON file merged into an existing feature' })
    .option('patch-json', { type: 'string', describe: 'Patch JSON string merged into an existing feature' })
    .option('id', { type: 'string', describe: 'Annotation or annotation-layer id' })
    .option('layer-id', { type: 'string', describe: 'Annotation layer id' })
    .option('label', { type: 'string', describe: 'Annotation label' })
    .option('note', { type: 'string', describe: 'Annotation note' })
    .option('color', { type: 'string', describe: 'Annotation color hex' })
    .option('lng', { type: 'number', describe: 'Point/text longitude' })
    .option('lat', { type: 'number', describe: 'Point/text latitude' })
    .option('coordinate', { type: 'string', describe: 'Point/text coordinate as "lng,lat" or JSON' })
    .option('points', { type: 'string', describe: 'Path/polygon points JSON or "lng,lat;lng,lat"' })
    .option('waypoints', { type: 'string', describe: 'Route waypoints JSON or "lng,lat;lng,lat"' })
    .option('geometry', { type: 'string', describe: 'Route geometry JSON or "lng,lat;lng,lat"' })
    .option('width', { type: 'number', describe: 'Path, route, polygon, or text width' })
    .option('height', { type: 'number', describe: 'Text height' })
    .option('fill-opacity', { type: 'number', describe: 'Polygon fill opacity' })
    .option('directed', { type: 'boolean', describe: 'Path/route direction arrow' })
    .option('profile', { choices: ['driving', 'walking', 'cycling'], describe: 'Route profile' })
    .option('distance', { type: 'number', describe: 'Route distance in meters' })
    .option('duration', { type: 'number', describe: 'Route duration in seconds' })
    .option('distance-text', { type: 'string', describe: 'Route distance label' })
    .option('duration-text', { type: 'string', describe: 'Route duration label' })
    .option('updated-by', { type: 'string', describe: 'Annotation editor id/name' })
    .option('stack-order', { type: 'number', describe: 'Annotation layer stack order' })
    .option('name', { type: 'string', describe: 'Annotation layer name' })
    .option('visible', { type: 'boolean', describe: 'Annotation layer visibility' });
}

async function runSnapshot(args: JsonRecord): Promise<void> {
  await runRoomCommand(
    {
      subject: 'snapshot',
      action: 'snapshot',
    },
    args,
  );
}

async function runLayer(args: JsonRecord): Promise<void> {
  const items = (args.items || []) as string[];
  const action = args.action;
  const command: Command = {
    subject: 'layers',
    action,
    id: args.id,
    file: args.file,
    ids: items,
    type: args.type,
    name: args.name,
    color: args.color,
    opacity: args.opacity,
    lineWidth: args.lineWidth,
    visible: args.visible,
    persistence: args.persistence,
  };

  if (action === 'add' || action === 'upsert') command.file ||= items[0];
  else if (action === 'reorder') command.ids = items;
  else command.id ||= items[0];

  await runRoomCommand(command, args);
}

async function runAnnotation(args: JsonRecord): Promise<void> {
  const items = (args.items || []) as string[];
  const action = args.action;
  const command = normalizeAnnotationCommand(action, items, args);
  await runRoomCommand(command, args);
}

function normalizeAnnotationCommand(action: string | undefined, items: string[], args: JsonRecord): Command {
  if (action === 'layers') {
    return {
      subject: 'annotations',
      action: 'layers',
      layerAction: items[0] || 'list',
      id: args.id || items[1],
      name: args.name,
      visible: args.visible,
      stackOrder: args.stackOrder,
    };
  }

  const command: Command = {
    subject: 'annotations',
    action,
    id: args.id,
    ids: items,
    featureType: undefined,
    type: undefined,
    layerId: args.layerId,
    label: args.label,
    note: args.note,
    color: args.color,
    lng: args.lng,
    lat: args.lat,
    coordinate: args.coordinate,
    points: args.points,
    waypoints: args.waypoints,
    geometry: args.geometry,
    width: args.width,
    height: args.height,
    fillOpacity: args.fillOpacity,
    directed: args.directed,
    profile: args.profile,
    distance: args.distance,
    duration: args.duration,
    distanceText: args.distanceText,
    durationText: args.durationText,
    updatedBy: args.updatedBy,
    featureFile: args.featureFile,
    featureJson: args.featureJson,
    patchFile: args.patchFile,
    patchJson: args.patchJson,
  };

  if (action === 'add' || action === 'upsert') {
    command.featureType = FEATURE_TYPES.includes(items[0]) ? items[0] : undefined;
    command.type = command.featureType;
    if (!command.id && command.featureType && items[1]) command.id = items[1];
    if (!command.id && !command.featureType && items[0]) command.id = items[0];
  } else if (action === 'reorder') {
    command.ids = items;
  } else {
    command.id ||= items[0];
    command.featureType = FEATURE_TYPES.includes(items[1]) ? items[1] : undefined;
    command.type = command.featureType;
  }

  return command;
}

async function runRoomCommand(command: Command, args: JsonRecord): Promise<void> {
  const config = createConfig(args);
  const client = new RoomClient(config);
  await client.connect();
  try {
    const response = await executeCommand(client, command);
    args.io.log(formatOutput(response.result, { json: args.json, pretty: args.pretty }, response.human));
  } finally {
    client.close();
  }
}
