import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  deleteStoredToken,
  fetchCurrentTokenUser,
  getStoredToken,
  pollDeviceLogin,
  saveStoredToken,
  startDeviceLogin,
} from './auth.js';
import { executeCommand } from './commands.js';
import { createConfig } from './config.js';
import { formatOutput } from './format.js';
import { RoomClient } from './room-client.js';
import type { Command, JsonRecord } from './types.js';

const FEATURE_TYPES = ['point', 'text', 'path', 'polygon', 'route'];

export function buildParser(argv: readonly string[] = []) {
  return yargs(argv)
    .scriptName('atlas-realm')
    .usage('$0 <command> [options]')
    .option('host', {
      type: 'string',
      describe: 'App origin or WebSocket host',
      default: process.env.ATLAS_REALM_HOST || process.env.ROOM_HOST || 'http://localhost:5173',
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
      describe: 'Stable WebSocket client id, required for room commands',
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
    .option('token', {
      type: 'string',
      describe: 'Personal access token for authenticated rooms',
      default: process.env.ATLAS_REALM_TOKEN || '',
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
    .option('content', {
      type: 'boolean',
      describe: 'Include decoded layer contents when supported',
    })
    .command(['login'], 'Sign in with GitHub Device Flow and store a local token', authBuilder, runLogin)
    .command(['logout'], 'Remove the stored local token for this host', authBuilder, runLogout)
    .command(['whoami'], 'Print the GitHub account for the stored token', authBuilder, runWhoami)
    .command(['snapshot', 'status'], 'Print room layers and annotations', () => {}, runSnapshot)
    .command(['room <action>', 'rooms <action>'], 'Inspect or update room metadata', roomBuilder, runRoom)
    .command(['presence', 'users', 'participants'], 'Print live users and recent agents', () => {}, runPresence)
    .command(
      ['layers <action> [items..]', 'layer <action> [items..]'],
      'Manage shared GeoJSON/GPX layers',
      layerBuilder,
      runLayer,
    )
    .command(
      ['annotations <action> [items..]', 'annotation <action> [items..]'],
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

function authBuilder(y: any): any {
  return y
    .option('token-name', {
      type: 'string',
      describe: 'Display name for the issued CLI token',
    })
    .option('start-only', {
      type: 'boolean',
      describe: 'Start GitHub Device Flow, print the code, and exit without polling',
    })
    .option('flow-id', {
      type: 'string',
      describe: 'Resume an existing GitHub Device Flow login',
    })
    .option('poll-once', {
      type: 'boolean',
      describe: 'With --flow-id, poll once and exit if authorization is still pending',
    })
    .option('poll-delay', {
      type: 'number',
      describe: 'Override login polling delay in milliseconds',
    })
    .option('max-wait', {
      type: 'number',
      describe: 'Maximum login wait time in milliseconds',
      default: 10 * 60 * 1000,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function runLogin(args: JsonRecord): Promise<void> {
  const config = createConfig(args);
  const flowId = String(args.flowId || '').trim();
  if (args.startOnly && flowId) throw new Error('Use either --start-only or --flow-id, not both.');
  if (args.pollOnce && !flowId) throw new Error('--poll-once requires --flow-id.');

  if (flowId) {
    if (!args.pollOnce && !args.json && !args.pretty) args.io.log('Waiting for GitHub authorization...');
    await runLoginPoll(args, config, flowId, { initialIntervalMs: 0, pollImmediately: true });
    return;
  }

  const tokenName = String(args.tokenName || `Agent CLI (${config.host})`);
  const started = await startDeviceLogin(config.host, tokenName);
  const verificationUrl = started.verificationUriComplete || started.verificationUri;
  const startResult = {
    ok: true,
    status: 'pending',
    host: config.host,
    flowId: started.flowId,
    userCode: started.userCode,
    verificationUri: started.verificationUri,
    verificationUriComplete: started.verificationUriComplete || null,
    verificationUrl,
    expiresAt: started.expiresAt,
    intervalSeconds: started.intervalSeconds,
  };

  if (args.startOnly) {
    args.io.log(
      formatOutput(startResult, { json: args.json, pretty: args.pretty }, (value) =>
        [
          `Open ${value.verificationUrl}`,
          `Enter code: ${value.userCode}`,
          `Device flow: ${value.flowId}`,
          `After approving, run: atlas-realm login --host ${value.host} --flow-id ${value.flowId}`,
        ].join('\n'),
      ),
    );
    return;
  }

  args.io.log(`Open ${verificationUrl}`);
  args.io.log(`Enter code: ${started.userCode}`);
  args.io.log('Waiting for GitHub authorization...');

  let intervalMs = Math.max(1000, started.intervalSeconds * 1000);
  if (args.pollDelay !== undefined) intervalMs = Math.max(0, Number(args.pollDelay) || 0);
  await runLoginPoll(args, config, started.flowId, {
    expiresAt: started.expiresAt,
    initialIntervalMs: intervalMs,
    pollImmediately: false,
  });
}

async function runLoginPoll(
  args: JsonRecord,
  config: ReturnType<typeof createConfig>,
  flowId: string,
  options: { expiresAt?: number; initialIntervalMs: number; pollImmediately: boolean },
): Promise<void> {
  const startedAt = Date.now();
  const maxWait = Number.isFinite(Number(args.maxWait)) ? Number(args.maxWait) : 10 * 60 * 1000;
  const expiresAt = Number.isFinite(Number(options.expiresAt)) ? Number(options.expiresAt) : Number.POSITIVE_INFINITY;
  let intervalMs = Math.max(0, options.initialIntervalMs);
  let shouldSleep = !options.pollImmediately;

  while (Date.now() - startedAt <= maxWait && Date.now() <= expiresAt) {
    if (shouldSleep && intervalMs > 0) await sleep(intervalMs);
    shouldSleep = true;
    const polled = await pollDeviceLogin(config.host, flowId);

    if (polled.status === 'pending') {
      if (args.pollOnce) {
        printLoginPollStatus(args, config.host, flowId, polled);
        return;
      }
      intervalMs =
        args.pollDelay !== undefined ? intervalMs : Math.max(1000, Number(polled.intervalSeconds || 5) * 1000);
      continue;
    }

    if (polled.status === 'slow_down') {
      if (args.pollOnce) {
        printLoginPollStatus(args, config.host, flowId, polled);
        return;
      }
      intervalMs =
        args.pollDelay !== undefined
          ? intervalMs
          : Math.max(1000, Number(polled.retryAfterSeconds || polled.intervalSeconds || 5) * 1000);
      continue;
    }

    if (polled.status === 'expired') throw new Error('GitHub device login expired. Run login again.');
    if (polled.status === 'denied') throw new Error('GitHub device login was denied.');

    if (polled.status === 'complete' && polled.token) {
      await saveStoredToken(config.host, polled.token, polled.user);
      const login = polled.user?.githubLogin || polled.user?.displayName || 'GitHub user';
      const result = {
        ok: true,
        status: 'complete',
        host: config.host,
        tokenSaved: true,
        user: polled.user || null,
      };
      args.io.log(
        formatOutput(
          result,
          { json: args.json, pretty: args.pretty },
          () => `Logged in as ${login}. Token saved for ${config.host}.`,
        ),
      );
      return;
    }

    if (polled.status === 'complete') {
      throw new Error(
        'GitHub device login was already completed and the token is no longer available. Run login again.',
      );
    }

    throw new Error(`Unexpected device login status: ${polled.status || 'unknown'}`);
  }

  throw new Error('Timed out waiting for GitHub device login.');
}

function printLoginPollStatus(args: JsonRecord, host: string, flowId: string, polled: JsonRecord): void {
  const status = String(polled.status || 'pending');
  const result = {
    ok: true,
    status,
    host,
    flowId,
    intervalSeconds: polled.intervalSeconds,
    retryAfterSeconds: polled.retryAfterSeconds,
  };
  args.io.log(
    formatOutput(result, { json: args.json, pretty: args.pretty }, () => {
      const retryAfter = Number(polled.retryAfterSeconds || polled.intervalSeconds || 5);
      return `GitHub authorization is ${status.replace('_', ' ')}. Retry after ${retryAfter}s.`;
    }),
  );
}

async function runLogout(args: JsonRecord): Promise<void> {
  const config = createConfig(args);
  const deleted = await deleteStoredToken(config.host);
  args.io.log(deleted ? `Removed stored token for ${config.host}.` : `No stored token for ${config.host}.`);
}

async function runWhoami(args: JsonRecord): Promise<void> {
  const config = createConfig(args);
  const token = config.accessToken || (await getStoredToken(config.host));
  if (!token) throw new Error(`No token configured for ${config.host}. Run atlas-realm login first.`);
  const data = await fetchCurrentTokenUser(config.host, token);
  const user = data.user as JsonRecord | null;
  if (!user) throw new Error('Stored token is not valid.');
  args.io.log(
    formatOutput({ ok: true, user }, { json: args.json, pretty: args.pretty }, (value) => {
      const current = value.user || {};
      return `${current.githubLogin || current.displayName || current.userId}`;
    }),
  );
}

function layerBuilder(y: any): any {
  return y
    .positional('action', {
      describe: 'list|get|content|metadata|export|add|upsert|update|patch|show|hide|delete|remove|rm|reorder',
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
    .option('sort-key', { type: 'string', describe: 'Layer sort key' })
    .option('out', { type: 'string', alias: 'output', describe: 'Export destination file' })
    .option('persistence', { choices: ['ephemeral', 'persistent'], describe: 'Room persistence hint' });
}

function annotationBuilder(y: any): any {
  return y
    .positional('action', {
      describe: 'list|get|content|add|upsert|update|patch|clear|delete|remove|rm|reorder|layers',
      type: 'string',
    })
    .positional('items', {
      describe: 'Command arguments such as ids, feature type, or ordered ids',
      type: 'string',
      array: true,
    })
    .option('feature-file', { type: 'string', describe: 'Full annotation payload JSON file' })
    .option('feature-json', { type: 'string', describe: 'Full annotation payload JSON string' })
    .option('patch-file', { type: 'string', describe: 'Patch JSON file merged into an existing feature' })
    .option('patch-json', { type: 'string', describe: 'Patch JSON string merged into an existing feature' })
    .option('id', { type: 'string', describe: 'Annotation or annotation-layer id' })
    .option('layer-id', { type: 'string', describe: 'Annotation layer id' })
    .option('label', { type: 'string', describe: 'Annotation label' })
    .option('label-file', { type: 'string', describe: 'Read annotation label from a UTF-8 text file' })
    .option('note', { type: 'string', describe: 'Annotation note' })
    .option('note-file', { type: 'string', describe: 'Read annotation note from a UTF-8 text file' })
    .option('color', { type: 'string', describe: 'Annotation color hex' })
    .option('lng', { type: 'number', describe: 'Point/text longitude' })
    .option('lat', { type: 'number', describe: 'Point/text latitude' })
    .option('coordinate', { type: 'string', describe: 'Point/text coordinate as "lng,lat" or JSON' })
    .option('points', { type: 'string', describe: 'Path/polygon points JSON or "lng,lat;lng,lat"' })
    .option('waypoints', { type: 'string', describe: 'Route waypoints JSON or "lng,lat;lng,lat"' })
    .option('geometry', { type: 'string', describe: 'Route geometry JSON or "lng,lat;lng,lat"' })
    .option('width', { type: 'number', describe: 'Path, route, polygon, or text width' })
    .option('height', { type: 'number', describe: 'Text height' })
    .option('line-style', { choices: ['solid', 'dashed', 'dotted'], describe: 'Path, route, or polygon outline style' })
    .option('opacity', { type: 'number', describe: 'Path, route, or polygon outline opacity, 0.05-1' })
    .option('fill-opacity', { type: 'number', describe: 'Polygon fill opacity' })
    .option('directed', { type: 'boolean', describe: 'Path/route direction arrow' })
    .option('profile', { choices: ['driving', 'walking', 'cycling'], describe: 'Route profile' })
    .option('distance', { type: 'number', describe: 'Route distance in meters' })
    .option('duration', { type: 'number', describe: 'Route duration in seconds' })
    .option('distance-text', { type: 'string', describe: 'Route distance label' })
    .option('duration-text', { type: 'string', describe: 'Route duration label' })
    .option('updated-by', { type: 'string', describe: 'Annotation editor id/name' })
    .option('sort-key', { type: 'string', describe: 'Annotation layer sort key' })
    .option('name', { type: 'string', describe: 'Annotation layer name' })
    .option('visible', { type: 'boolean', describe: 'Annotation layer visibility' })
    .option('hide-layer', { type: 'boolean', describe: 'Hide annotation layer after clearing it' });
}

function roomBuilder(y: any): any {
  return y
    .positional('action', {
      describe: 'status|get|update|set|persistence',
      type: 'string',
    })
    .option('persistence', {
      choices: ['ephemeral', 'persistent'],
      describe: 'Room persistence mode',
    });
}

async function runSnapshot(args: JsonRecord): Promise<void> {
  await runRoomCommand(
    {
      subject: 'snapshot',
      action: 'snapshot',
      content: args.content,
    },
    args,
  );
}

async function runRoom(args: JsonRecord): Promise<void> {
  await runRoomCommand(
    {
      subject: 'room',
      action: args.action,
      persistence: args.persistence,
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
    sortKey: args.sortKey,
    out: args.out,
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
      ids: items.slice(1),
      name: args.name,
      visible: args.visible,
      sortKey: args.sortKey,
      updatedBy: args.updatedBy,
      hideLayer: args.hideLayer,
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
    labelFile: args.labelFile,
    note: args.note,
    noteFile: args.noteFile,
    color: args.color,
    lng: args.lng,
    lat: args.lat,
    coordinate: args.coordinate,
    points: args.points,
    waypoints: args.waypoints,
    geometry: args.geometry,
    width: args.width,
    height: args.height,
    lineStyle: args.lineStyle,
    opacity: args.opacity,
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
    hideLayer: args.hideLayer,
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
  const config = createConfig(args, process.env, { requireClientId: true });
  if (!config.accessToken) config.accessToken = await getStoredToken(config.host);
  const client = new RoomClient(config);
  await client.connect();
  try {
    if (config.clientType === 'agent') await touchAgentAction(client, commandActionLabel(command));
    const response = await executeCommand(client, command);
    args.io.log(formatOutput(response.result, { json: args.json, pretty: args.pretty }, response.human));
  } finally {
    client.close();
  }
}

async function touchAgentAction(client: RoomClient, action: string): Promise<void> {
  client.sendJson({ type: 'client:update', action });
  try {
    await client.waitFor(
      (event) =>
        event.json?.type === 'agent:participant:update' &&
        event.json.agent?.id === client.config.clientId &&
        event.json.agent?.lastAction === action,
      `agent action ${action}`,
      Math.min(client.config.timeoutMs, 1000),
    );
  } catch {
    // Recent-agent activity is useful metadata, but it should not block the requested command.
  }
}

function commandActionLabel(command: Command): string {
  if (command.subject === 'annotations' && command.action === 'layers') {
    return `annotations layers ${command.layerAction || 'list'}`;
  }
  return [command.subject, command.action].filter(Boolean).join(' ') || 'command';
}
