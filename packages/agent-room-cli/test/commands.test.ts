import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFeatureFromParts } from '../src/annotation-feature.js';
import { getStoredToken, saveStoredToken } from '../src/auth.js';
import { buildFileLayerAssetFromText } from '../src/file-layer-asset.js';
import { buildApiUrl, buildSocketUrl, createConfig } from '../src/config.js';
import { executeCommand } from '../src/commands.js';
import { RoomClient } from '../src/room-client.js';
import { runCli } from '../src/cli.js';

const NOW = 1_700_000_000_000;

class FakeRoomClient {
  constructor() {
    this.config = { room: 'test-room', agentName: 'Agent', timeoutMs: 1000 };
    this.layers = [
      {
        id: 'annotation-default',
        kind: 'annotation',
        name: 'Annotations',
        visible: true,
        sortKey: '000010',
        payload: { version: 1 },
        revision: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    this.annotationFeatures = [];
    this.peers = [];
    this.agents = [
      {
        id: 'agent-a',
        user: { id: 'agent-a', name: 'Agent', color: '#4f46e5' },
        clientType: 'agent',
        active: true,
        lastSeenAt: NOW,
        expiresAt: NOW + 300_000,
        lastAction: 'connect',
      },
    ];
    this.roomStatus = {
      type: 'room:status',
      room: 'test-room',
      persistence: 'ephemeral',
      lastActiveAt: NOW,
      expiresAt: NOW + 86_400_000,
    };
    this.sentJson = [];
    this.sentBinary = [];
    this.fileContents = new Map();
  }

  sendJson(message) {
    this.sentJson.push(message);
  }

  sendBinary(bytes) {
    this.sentBinary.push(bytes);
  }

  async waitFor(_predicate, label) {
    if (label.startsWith('file content store')) {
      const contentHash = label.split(' ').at(-1);
      return { json: { type: 'file:content:stored', contentHash } };
    }
    if (label.startsWith('file content')) {
      const contentHash = label.split(' ').at(-1);
      const content = this.fileContents.get(contentHash);
      if (!content) throw new Error(`Missing fake file content: ${contentHash}`);
      return { binary: { contentHash, content } };
    }
    if (label === 'room status') {
      return { json: { ...this.roomStatus, type: 'room:status' } };
    }
    if (label.startsWith('room persistence')) {
      const persistence = label.split(' ').at(-1);
      this.roomStatus = { ...this.roomStatus, type: 'room:updated', persistence };
      return { json: this.roomStatus };
    }
    if (label.startsWith('layer create')) {
      const layer = this.sentJson.at(-1)?.layer;
      this.upsertLayer(layer);
      return { json: { type: 'layer:created', layer } };
    }
    if (
      label.startsWith('layer update') ||
      label.startsWith('annotation layer update') ||
      label.includes(' visibility ')
    ) {
      const message = this.sentJson.at(-1);
      const layer = this.layers.find((item) => item.id === message.layerId);
      const next = { ...layer, ...message.patch, updatedAt: NOW + 1 };
      if (message.patch?.payload?.style && next.payload?.style) {
        next.payload = { ...next.payload, style: { ...next.payload.style, ...message.patch.payload.style } };
      }
      this.upsertLayer(next);
      return { json: { type: 'layer:updated', layer: next } };
    }
    if (label.startsWith('layer delete') || label.startsWith('annotation layer delete')) {
      const layerId = this.sentJson.at(-1)?.layerId;
      this.layers = this.layers.filter((layer) => layer.id !== layerId);
      return { json: { type: 'layer:deleted', layerId } };
    }
    if (label === 'layer reorder' || label === 'annotation layer reorder') {
      for (const update of this.sentJson.at(-1)?.updates || []) {
        const layer = this.layers.find((item) => item.id === update.layerId);
        if (layer) layer.sortKey = update.sortKey;
      }
      this.layers.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      return { json: { type: 'layer:reordered', layers: this.layers } };
    }
    if (label.startsWith('annotation feature upsert') || label.startsWith('annotation feature update')) {
      const feature = this.sentJson.at(-1)?.feature;
      const index = this.annotationFeatures.findIndex((item) => item.id === feature.id);
      if (index === -1) this.annotationFeatures.push(feature);
      else this.annotationFeatures[index] = feature;
      return { json: { type: 'annotation-feature:upserted', feature } };
    }
    if (label.startsWith('annotation feature delete')) {
      const featureId = this.sentJson.at(-1)?.featureId;
      this.annotationFeatures = this.annotationFeatures.filter((feature) => feature.id !== featureId);
      return { json: { type: 'annotation-feature:deleted', featureId } };
    }
    if (label === 'annotation feature reorder') {
      for (const update of this.sentJson.at(-1)?.updates || []) {
        const feature = this.annotationFeatures.find((item) => item.id === update.featureId);
        if (feature) feature.sortKey = update.sortKey;
      }
      this.annotationFeatures.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      return { json: { type: 'annotation-feature:reordered', features: this.annotationFeatures } };
    }
    throw new Error(`Unexpected waitFor: ${label}`);
  }

  upsertLayer(layer) {
    const index = this.layers.findIndex((item) => item.id === layer.id);
    if (index === -1) this.layers.push(layer);
    else this.layers[index] = layer;
  }
}

class FakeWebSocket {
  static OPEN = 1;
  static urls: string[] = [];
  binaryType = 'arraybuffer';
  readyState = FakeWebSocket.OPEN;
  listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    FakeWebSocket.urls.push(url);
    queueMicrotask(() => {
      this.dispatch('open', {});
      this.dispatch('message', {
        data: JSON.stringify({
          type: 'presence:init',
          peers: [],
          agents: [],
          roomStatus: { type: 'room:status', room: 'trip-room', persistence: 'persistent' },
        }),
      });
      this.dispatch('message', {
        data: JSON.stringify({ type: 'layer:list', layers: [] }),
      });
      this.dispatch('message', {
        data: JSON.stringify({ type: 'annotation-feature:list', features: [] }),
      });
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((item) => item !== listener),
    );
  }

  send(_data: unknown) {}

  close() {}

  dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function addFakeFileLayer(client, geojson = routeGeoJson(), options = {}) {
  const asset = buildFileLayerAssetFromText('route.geojson', JSON.stringify(geojson), {
    id: 'route-layer',
    name: 'Route layer',
    ...options,
  });
  client.layers.push({
    id: asset.manifest.id,
    kind: 'file',
    name: asset.manifest.name,
    visible: asset.manifest.visible,
    sortKey: '000020',
    payload: {
      version: 1,
      fileType: asset.manifest.type,
      contentHash: asset.manifest.contentHash,
      contentType: asset.manifest.contentType,
      contentEncoding: asset.manifest.contentEncoding,
      contentByteLength: asset.manifest.contentByteLength,
      rawByteLength: asset.manifest.rawByteLength,
      bounds: asset.manifest.bounds,
      style: {
        color: asset.manifest.color,
        opacity: asset.manifest.opacity,
        lineWidth: asset.manifest.lineWidth,
      },
    },
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'Agent',
  });
  client.fileContents.set(asset.manifest.contentHash, asset.content);
  return { asset, geojson };
}

function routeGeoJson() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Walk' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [121.5, 31.2],
            [121.51, 31.21],
          ],
        },
      },
    ],
  };
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalTokenStore = process.env.ORM_AGENT_ROOM_TOKEN_STORE;
const originalRoomClientId = process.env.ORM_ROOM_CLIENT_ID;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.urls = [];
  if (originalTokenStore === undefined) delete process.env.ORM_AGENT_ROOM_TOKEN_STORE;
  else process.env.ORM_AGENT_ROOM_TOKEN_STORE = originalTokenStore;
  if (originalRoomClientId === undefined) delete process.env.ORM_ROOM_CLIENT_ID;
  else process.env.ORM_ROOM_CLIENT_ID = originalRoomClientId;
});

function captureIo() {
  const lines: string[] = [];
  return {
    lines,
    io: {
      log(value?: unknown) {
        lines.push(String(value ?? ''));
      },
    } as Console,
  };
}

async function withTokenStore<T>(callback: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-room-cli-auth-'));
  const path = join(dir, 'tokens.json');
  process.env.ORM_AGENT_ROOM_TOKEN_STORE = path;
  try {
    return await callback(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('agent-room CLI package', () => {
  it('builds PartyServer WebSocket URLs from config', () => {
    const config = createConfig({
      host: 'https://example.com/app/',
      room: 'trip-room',
      party: 'map-collaboration',
      clientId: 'agent-a',
      agentName: 'Planner',
      agentColor: '#2563eb',
    });

    expect(buildSocketUrl(config)).toBe(
      'wss://example.com/app/parties/map-collaboration/trip-room?_pk=agent-a&userId=agent-a&name=Planner&color=%232563eb&clientType=agent',
    );
  });

  it('adds PAT tokens to WebSocket URLs when configured', () => {
    const config = createConfig({
      host: 'https://example.com',
      room: 'trip-room',
      party: 'map-collaboration',
      clientId: 'agent-a',
      token: 'orm_pat_secret',
    });

    const url = new URL(buildSocketUrl(config));
    expect(url.searchParams.get('token')).toBe('orm_pat_secret');
  });

  it('reads PAT tokens from ORM_ROOM_TOKEN', () => {
    const config = createConfig(
      {
        host: 'https://example.com',
        room: 'trip-room',
        party: 'map-collaboration',
        clientId: 'agent-a',
      },
      { ORM_ROOM_TOKEN: 'orm_pat_env' },
    );

    expect(new URL(buildSocketUrl(config)).searchParams.get('token')).toBe('orm_pat_env');
  });

  it('builds account API URLs from host config', () => {
    expect(buildApiUrl({ host: 'https://example.com/app/' }, '/api/rooms')).toBe('https://example.com/app/api/rooms');
    expect(buildApiUrl({ host: 'localhost:5173' }, '/api/rooms')).toBe('http://localhost:5173/api/rooms');
    expect(buildApiUrl({ host: 'wss://example.com/live' }, '/api/rooms')).toBe('https://example.com/live/api/rooms');
  });

  it('requires a stable client id for room commands', async () => {
    delete process.env.ORM_ROOM_CLIENT_ID;

    await expect(
      runCli(['snapshot', '--host', 'https://example.com', '--room', 'trip-room', '--json'], captureIo().io),
    ).rejects.toThrow('Room commands require --client-id <id> or ORM_ROOM_CLIENT_ID.');
    expect(FakeWebSocket.urls).toHaveLength(0);
  });

  it('logs in with GitHub Device Flow and stores the returned local PAT', async () => {
    await withTokenStore(async (storePath) => {
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        if (String(url).endsWith('/api/auth/github/device/start')) {
          return Response.json(
            {
              flowId: 'flow_cli',
              userCode: 'ABCD-EFGH',
              verificationUri: 'https://github.com/login/device',
              verificationUriComplete: 'https://github.com/login/device?user_code=ABCD-EFGH',
              expiresAt: Date.now() + 60_000,
              intervalSeconds: 5,
            },
            { status: 201 },
          );
        }
        if (String(url).endsWith('/api/auth/github/device/poll')) {
          return Response.json({
            status: 'complete',
            token: 'orm_pat_device',
            user: { githubLogin: 'octocat', displayName: 'Octocat' },
            accessToken: { tokenId: 'tok_1', name: 'CLI' },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };
      const { io, lines } = captureIo();

      await runCli(
        ['login', '--host', 'https://example.com/app', '--token-name', 'Laptop CLI', '--poll-delay', '0'],
        io,
      );

      expect(fetchCalls.map((call) => call.url)).toEqual([
        'https://example.com/app/api/auth/github/device/start',
        'https://example.com/app/api/auth/github/device/poll',
      ]);
      expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ name: 'Laptop CLI' });
      expect(JSON.parse(String(fetchCalls[1].init?.body))).toEqual({ flowId: 'flow_cli' });
      expect(lines.join('\n')).toContain('Open https://github.com/login/device?user_code=ABCD-EFGH');
      expect(lines.join('\n')).toContain('Logged in as octocat');
      expect(await getStoredToken('https://example.com/app', storePath)).toBe('orm_pat_device');
      expect(await readFile(storePath, 'utf8')).toContain('octocat');
    });
  });

  it('starts Device Flow login without polling for non-interactive agents', async () => {
    await withTokenStore(async (storePath) => {
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return Response.json(
          {
            flowId: 'flow_cli',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://github.com/login/device',
            verificationUriComplete: 'https://github.com/login/device?user_code=ABCD-EFGH',
            expiresAt: Date.now() + 60_000,
            intervalSeconds: 5,
          },
          { status: 201 },
        );
      };
      const { io, lines } = captureIo();

      await runCli(
        ['login', '--host', 'https://example.com/app', '--token-name', 'Agent CLI', '--start-only', '--json'],
        io,
      );

      expect(fetchCalls.map((call) => call.url)).toEqual(['https://example.com/app/api/auth/github/device/start']);
      expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ name: 'Agent CLI' });
      expect(JSON.parse(lines[0])).toMatchObject({
        ok: true,
        status: 'pending',
        host: 'https://example.com/app',
        flowId: 'flow_cli',
        userCode: 'ABCD-EFGH',
        verificationUrl: 'https://github.com/login/device?user_code=ABCD-EFGH',
      });
      expect(await getStoredToken('https://example.com/app', storePath)).toBe('');
    });
  });

  it('resumes Device Flow login by flow id and can poll once without waiting', async () => {
    await withTokenStore(async (storePath) => {
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return Response.json({
          status: 'complete',
          token: 'orm_pat_resumed',
          user: { githubLogin: 'octocat', displayName: 'Octocat' },
        });
      };
      const resumed = captureIo();

      await runCli(['login', '--host', 'https://example.com/app', '--flow-id', 'flow_cli', '--json'], resumed.io);

      expect(fetchCalls.map((call) => call.url)).toEqual(['https://example.com/app/api/auth/github/device/poll']);
      expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ flowId: 'flow_cli' });
      expect(JSON.parse(resumed.lines[0])).toMatchObject({
        ok: true,
        status: 'complete',
        host: 'https://example.com/app',
        tokenSaved: true,
        user: { githubLogin: 'octocat' },
      });
      expect(await getStoredToken('https://example.com/app', storePath)).toBe('orm_pat_resumed');
    });

    await withTokenStore(async (storePath) => {
      globalThis.fetch = async () => Response.json({ status: 'pending', intervalSeconds: 5 });
      const pending = captureIo();

      await runCli(
        ['login', '--host', 'https://example.com/app', '--flow-id', 'flow_pending', '--poll-once', '--json'],
        pending.io,
      );

      expect(JSON.parse(pending.lines[0])).toMatchObject({
        ok: true,
        status: 'pending',
        host: 'https://example.com/app',
        flowId: 'flow_pending',
        intervalSeconds: 5,
      });
      expect(await getStoredToken('https://example.com/app', storePath)).toBe('');
    });
  });

  it('continues Device Flow login after slow_down and reports denied or expired flows', async () => {
    await withTokenStore(async () => {
      let pollCount = 0;
      globalThis.fetch = async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/api/auth/github/device/start')) {
          return Response.json({
            flowId: 'flow_cli',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://github.com/login/device',
            expiresAt: Date.now() + 60_000,
            intervalSeconds: 5,
          });
        }
        pollCount += 1;
        return pollCount === 1
          ? Response.json({ status: 'slow_down', intervalSeconds: 10, retryAfterSeconds: 0 })
          : Response.json({ status: 'complete', token: 'orm_pat_after_slow', user: { githubLogin: 'octocat' } });
      };

      await runCli(['login', '--host', 'https://example.com', '--poll-delay', '0'], captureIo().io);
      expect(pollCount).toBe(2);
      expect(await getStoredToken('https://example.com')).toBe('orm_pat_after_slow');
    });

    await withTokenStore(async () => {
      globalThis.fetch = async (url: RequestInfo | URL) =>
        String(url).endsWith('/device/start')
          ? Response.json({
              flowId: 'flow_cli',
              userCode: 'ABCD-EFGH',
              verificationUri: 'https://github.com/login/device',
              expiresAt: Date.now() + 60_000,
              intervalSeconds: 5,
            })
          : Response.json({ status: 'denied' });
      await expect(
        runCli(['login', '--host', 'https://example.com', '--poll-delay', '0'], captureIo().io),
      ).rejects.toThrow('denied');
    });

    await withTokenStore(async () => {
      globalThis.fetch = async (url: RequestInfo | URL) =>
        String(url).endsWith('/device/start')
          ? Response.json({
              flowId: 'flow_cli',
              userCode: 'ABCD-EFGH',
              verificationUri: 'https://github.com/login/device',
              expiresAt: Date.now() + 60_000,
              intervalSeconds: 5,
            })
          : Response.json({ status: 'expired' });
      await expect(
        runCli(['login', '--host', 'https://example.com', '--poll-delay', '0'], captureIo().io),
      ).rejects.toThrow('expired');
    });
  });

  it('prints whoami from a stored token and removes it on logout', async () => {
    await withTokenStore(async (storePath) => {
      await saveStoredToken('https://example.com/app', 'orm_pat_saved', { githubLogin: 'octocat' }, storePath);
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return Response.json({ user: { userId: 'user_1', githubLogin: 'octocat', displayName: 'Octocat' } });
      };

      const who = captureIo();
      await runCli(['whoami', '--host', 'https://example.com/app'], who.io);
      expect(who.lines).toEqual(['octocat']);
      expect(fetchCalls[0]).toMatchObject({ url: 'https://example.com/app/api/auth/me' });
      expect(fetchCalls[0].init?.headers).toMatchObject({ Authorization: 'Bearer orm_pat_saved' });

      const out = captureIo();
      await runCli(['logout', '--host', 'https://example.com/app'], out.io);
      expect(out.lines[0]).toContain('Removed stored token');
      expect(await getStoredToken('https://example.com/app', storePath)).toBe('');
    });
  });

  it('uses stored login tokens for room commands when no token option is passed', async () => {
    await withTokenStore(async (storePath) => {
      await saveStoredToken('https://example.com/app', 'orm_pat_saved', { githubLogin: 'octocat' }, storePath);
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return Response.json({});
      };
      globalThis.WebSocket = FakeWebSocket as never;
      const { io } = captureIo();

      await runCli(
        [
          'snapshot',
          '--host',
          'https://example.com/app',
          '--room',
          'trip-room',
          '--client-id',
          'agent-a',
          '--client-type',
          'query',
          '--json',
        ],
        io,
      );

      expect(fetchCalls[0].init?.headers).toMatchObject({ Authorization: 'Bearer orm_pat_saved' });
      expect(new URL(FakeWebSocket.urls[0]).searchParams.get('token')).toBe('orm_pat_saved');
    });
  });

  it('prepares the room registry with PAT auth before opening the WebSocket', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    };
    FakeWebSocket.urls = [];

    try {
      const config = createConfig({
        host: 'https://example.com/app',
        room: 'trip-room',
        party: 'map-collaboration',
        clientId: 'agent-a',
        token: 'orm_pat_secret',
        timeoutMs: 1000,
      });
      const client = new RoomClient(config, { WebSocketImpl: FakeWebSocket as never });

      await client.connect();

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]).toMatchObject({
        url: 'https://example.com/app/api/rooms',
        init: {
          method: 'POST',
          body: JSON.stringify({ roomId: 'trip-room' }),
        },
      });
      expect(fetchCalls[0].init.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: 'Bearer orm_pat_secret',
      });
      expect(FakeWebSocket.urls).toHaveLength(1);
      expect(new URL(FakeWebSocket.urls[0]).searchParams.get('token')).toBe('orm_pat_secret');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('can query live peers and recent agents from the room snapshot', async () => {
    const client = new FakeRoomClient();

    const snapshot = await executeCommand(client, { subject: 'snapshot' });
    const presence = await executeCommand(client, { subject: 'presence', action: 'list' });

    expect(snapshot.result.presence.agents[0]).toMatchObject({ id: 'agent-a', active: true });
    expect(snapshot.result.layers[0]).toMatchObject({ id: 'annotation-default', kind: 'annotation' });
    expect(presence.result.agents[0]).toMatchObject({ id: 'agent-a', lastAction: 'connect' });
    expect(presence.result.peers).toEqual([]);
  });

  it('can request full snapshot layer contents', async () => {
    const client = new FakeRoomClient();
    client.annotationFeatures.push({
      id: 'stop-a',
      layerId: 'annotation-default',
      featureType: 'point',
      payload: {
        id: 'stop-a',
        type: 'point',
        layerId: 'annotation-default',
        label: 'Station',
        coordinate: [121.5, 31.2],
      },
      sortKey: '000010',
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: 'Agent',
    });

    const snapshot = await executeCommand(client, { subject: 'snapshot', content: true });

    expect(snapshot.result.layerContents[0]).toMatchObject({
      layer: { id: 'annotation-default' },
      annotations: [{ id: 'stop-a' }],
    });
  });

  it('can inspect and update room persistence', async () => {
    const client = new FakeRoomClient();

    const status = await executeCommand(client, { subject: 'room', action: 'status' });
    const updated = await executeCommand(client, {
      subject: 'room',
      action: 'update',
      persistence: 'persistent',
    });

    expect(client.sentJson[0]).toEqual({ type: 'room:status:request' });
    expect(client.sentJson[1]).toEqual({ type: 'room:update', persistence: 'persistent' });
    expect(status.result.roomStatus).toMatchObject({ room: 'test-room', persistence: 'ephemeral' });
    expect(updated.result.roomStatus).toMatchObject({ room: 'test-room', persistence: 'persistent' });
  });

  it('builds file layer assets with metadata and compressed content', () => {
    const asset = buildFileLayerAssetFromText(
      'route.geojson',
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Walk' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [121.5, 31.2],
                [121.51, 31.21],
              ],
            },
          },
        ],
      }),
      { id: 'route-layer', name: 'Route layer', color: '#ef4444' },
      NOW,
    );

    expect(asset.manifest).toMatchObject({
      id: 'route-layer',
      type: 'geojson',
      name: 'Route layer',
      color: '#ef4444',
      bounds: [
        [121.5, 31.2],
        [121.51, 31.21],
      ],
      lines: 1,
      features: 1,
      contentEncoding: 'gzip',
      syncVersion: 1,
    });
    expect(asset.content.byteLength).toBeGreaterThan(0);
  });

  it('builds point annotation payloads from command options', () => {
    const feature = buildFeatureFromParts({
      options: {
        id: 'stop-a',
        label: 'Station',
        lng: 121.5,
        lat: 31.2,
      },
      config: { agentName: 'Planner' },
      typeHint: 'point',
      now: NOW,
    });

    expect(feature).toMatchObject({
      id: 'stop-a',
      type: 'point',
      label: 'Station',
      updatedBy: 'Planner',
      coordinate: [121.5, 31.2],
    });
  });

  it('builds styled line annotation payloads from command options', () => {
    const feature = buildFeatureFromParts({
      options: {
        id: 'walk-a',
        points: '121.5,31.2;121.51,31.21',
        lineStyle: 'dashed',
        opacity: 0.55,
      },
      config: { agentName: 'Planner' },
      typeHint: 'path',
      now: NOW,
    });

    expect(feature).toMatchObject({
      id: 'walk-a',
      type: 'path',
      lineStyle: 'dashed',
      opacity: 0.55,
      width: 4,
    });
  });

  it('reads multiline annotation text from files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cli-text-'));
    const noteFile = join(dir, 'note.txt');
    await writeFile(noteFile, 'Line 1\nLine 2\nLine 3', 'utf8');

    try {
      const client = new FakeRoomClient();
      await executeCommand(client, {
        subject: 'annotations',
        action: 'add',
        featureType: 'text',
        type: 'text',
        id: 'plan-note',
        coordinate: '121.5,31.2',
        label: 'Plan',
        noteFile,
      });

      expect(client.sentJson[0]).toMatchObject({
        type: 'annotation-feature:upsert',
        feature: {
          id: 'plan-note',
          featureType: 'text',
          payload: {
            type: 'text',
            label: 'Plan',
            note: 'Line 1\nLine 2\nLine 3',
          },
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous inline and file text options', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cli-text-'));
    const labelFile = join(dir, 'label.txt');
    await writeFile(labelFile, 'File label', 'utf8');
    try {
      const client = new FakeRoomClient();
      await expect(
        executeCommand(client, {
          subject: 'annotations',
          action: 'add',
          featureType: 'text',
          type: 'text',
          id: 'plan-note',
          coordinate: '121.5,31.2',
          label: 'Inline',
          labelFile,
        }),
      ).rejects.toThrow('Use either --label or --label-file, not both.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sends file content upload followed by layer:create for file layers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cli-'));
    const file = join(dir, 'route.geojson');
    await writeFile(
      file,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Walk' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [121.5, 31.2],
                [121.51, 31.21],
              ],
            },
          },
        ],
      }),
    );

    const client = new FakeRoomClient();
    let response;
    try {
      response = await executeCommand(client, {
        subject: 'layers',
        action: 'add',
        file,
        id: 'route-layer',
        name: 'Route layer',
        type: 'geojson',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(client.sentBinary).toHaveLength(1);
    expect(client.sentJson).toHaveLength(1);
    expect(client.sentJson[0]).toMatchObject({
      type: 'layer:create',
      layer: {
        id: 'route-layer',
        kind: 'file',
        name: 'Route layer',
        payload: { fileType: 'geojson' },
      },
    });
    expect(response.result.layer.id).toBe('route-layer');
  });

  it('returns annotation features when getting an annotation layer', async () => {
    const client = new FakeRoomClient();
    client.annotationFeatures.push({
      id: 'stop-a',
      layerId: 'annotation-default',
      featureType: 'point',
      payload: {
        id: 'stop-a',
        type: 'point',
        layerId: 'annotation-default',
        label: 'Station',
        coordinate: [121.5, 31.2],
      },
      sortKey: '000010',
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: 'Agent',
    });

    const response = await executeCommand(client, {
      subject: 'layers',
      action: 'get',
      id: 'annotation-default',
    });

    expect(client.sentJson).toEqual([]);
    expect(response.result.layer).toMatchObject({ id: 'annotation-default', kind: 'annotation' });
    expect(response.result.annotations).toMatchObject([
      {
        id: 'stop-a',
        payload: { label: 'Station' },
      },
    ]);
  });

  it('requests and materializes file content when getting a file layer', async () => {
    const client = new FakeRoomClient();
    const { asset, geojson } = addFakeFileLayer(client);

    const response = await executeCommand(client, {
      subject: 'layers',
      action: 'content',
      id: 'route-layer',
    });

    expect(client.sentJson.at(-1)).toEqual({
      type: 'file:content:request',
      contentHash: asset.manifest.contentHash,
    });
    expect(response.result.layer).toMatchObject({ id: 'route-layer', kind: 'file' });
    expect(response.result.content).toMatchObject(geojson);
  });

  it('exports decoded file layer content to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cli-export-'));
    const out = join(dir, 'route-export.geojson');
    const client = new FakeRoomClient();
    const { geojson } = addFakeFileLayer(client);

    try {
      const response = await executeCommand(client, {
        subject: 'layers',
        action: 'export',
        id: 'route-layer',
        out,
      });

      expect(response.result.out).toBe(out);
      expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject(geojson);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sends visibility patches for layer show and hide aliases', async () => {
    const client = new FakeRoomClient();

    const response = await executeCommand(client, {
      subject: 'layers',
      action: 'hide',
      id: 'annotation-default',
    });

    expect(client.sentJson[0]).toEqual({
      type: 'layer:update',
      layerId: 'annotation-default',
      patch: { visible: false },
    });
    expect(response.result.layer.visible).toBe(false);
  });

  it('clears annotation features from a layer and can hide it', async () => {
    const client = new FakeRoomClient();
    client.annotationFeatures.push(
      {
        id: 'stop-a',
        layerId: 'annotation-default',
        featureType: 'point',
        payload: { id: 'stop-a', type: 'point', layerId: 'annotation-default', coordinate: [121.5, 31.2] },
        sortKey: '000010',
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'Agent',
      },
      {
        id: 'stop-b',
        layerId: 'annotation-default',
        featureType: 'point',
        payload: { id: 'stop-b', type: 'point', layerId: 'annotation-default', coordinate: [121.51, 31.21] },
        sortKey: '000020',
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'Agent',
      },
    );

    const response = await executeCommand(client, {
      subject: 'annotations',
      action: 'clear',
      layerId: 'annotation-default',
      hideLayer: true,
    });

    expect(client.sentJson).toEqual([
      { type: 'annotation-feature:delete', featureId: 'stop-a' },
      { type: 'annotation-feature:delete', featureId: 'stop-b' },
      { type: 'layer:update', layerId: 'annotation-default', patch: { visible: false } },
    ]);
    expect(response.result.deletedIds).toEqual(['stop-a', 'stop-b']);
    expect(response.result.layer.visible).toBe(false);
  });

  it('sends annotation-feature upsert and delete protocol messages for annotations', async () => {
    const client = new FakeRoomClient();
    const upsert = await executeCommand(client, {
      subject: 'annotations',
      action: 'add',
      featureType: 'point',
      type: 'point',
      id: 'stop-a',
      lng: 121.5,
      lat: 31.2,
      label: 'Station',
    });
    const deleted = await executeCommand(client, {
      subject: 'annotations',
      action: 'delete',
      id: 'stop-a',
    });

    expect(client.sentJson[0]).toMatchObject({
      type: 'annotation-feature:upsert',
      feature: { id: 'stop-a', featureType: 'point', payload: { type: 'point' } },
    });
    expect(client.sentJson[1]).toEqual({ type: 'annotation-feature:delete', featureId: 'stop-a' });
    expect(upsert.result.annotation.id).toBe('stop-a');
    expect(deleted.result.annotationId).toBe('stop-a');
  });

  it('sends layer:reorder messages for annotation layers', async () => {
    const client = new FakeRoomClient();
    client.layers.push({
      id: 'custom-layer',
      kind: 'annotation',
      name: 'Custom layer',
      visible: true,
      sortKey: '000020',
      payload: { version: 1 },
      revision: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const response = await executeCommand(client, {
      subject: 'annotations',
      action: 'layers',
      layerAction: 'reorder',
      ids: ['custom-layer', 'annotation-default'],
    });

    expect(client.sentJson[0]).toEqual({
      type: 'layer:reorder',
      updates: [
        { layerId: 'custom-layer', sortKey: '000010' },
        { layerId: 'annotation-default', sortKey: '000020' },
      ],
    });
    expect(response.result.orderedIds).toEqual(['custom-layer', 'annotation-default']);
  });
});
