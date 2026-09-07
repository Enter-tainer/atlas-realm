import { afterEach, describe, expect, it, vi } from 'vitest';
import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { parseRoomMutation, fieldVersion, type RoomCommand } from './room-sync-protocol.js';
import type { MapCollaboration } from './worker.js';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';

type TestMessage = string | Uint8Array | ArrayBuffer;
type TestSqlValue = string | number | boolean | null | ArrayBuffer;
type TestSqlRow = Record<string, TestSqlValue>;
type TestConnectionState = Record<string, unknown> | null;
type WorkerConnection = Parameters<MapCollaboration['onMessage']>[0];

interface TestConnection {
  id: string;
  state: TestConnectionState;
  sent: TestMessage[];
  closed?: { code?: number; reason?: string };
  send(message: TestMessage): void;
  close(code?: number, reason?: string): void;
  setState(update: TestConnectionState | ((previous: TestConnectionState) => TestConnectionState)): TestConnectionState;
}

type TestMapCollaboration = MapCollaboration & {
  _listLayers(): Array<Record<string, unknown>>;
  _listAnnotationFeatures(layerId?: string): Array<Record<string, unknown>>;
  _applyAccessRefresh(
    updates: Array<{ userId: string; role: 'view' | 'edit' | 'manage' | null }>,
    connections?: Iterable<WorkerConnection>,
  ): number;
  _applyAccessRefreshPayload(
    payload: Record<string, unknown>,
    connections?: Iterable<WorkerConnection>,
  ): Promise<number | null>;
  sql<T extends TestSqlRow = TestSqlRow>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
};

type TestLinkAccess = 'restricted' | 'view' | 'edit';
type TestRoomRole = 'view' | 'edit' | 'manage';

class FakeAccessRefreshStmt {
  private args: unknown[] = [];

  constructor(
    private db: FakeAccessRefreshD1Database,
    private sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.firstQueries += 1;
    if (this.sql.includes('FROM rooms') && this.sql.includes('LEFT JOIN room_grants')) {
      const [roomId, userId] = this.args as [string, string];
      const room = this.db.rooms.get(roomId);
      if (!room) return null;
      return {
        owner_user_id: room.ownerUserId,
        link_access: room.linkAccess,
        grant_role: this.db.grants.get(`${roomId}:${userId}`) || null,
      } as T;
    }

    if (this.sql.includes('FROM rooms') && this.sql.includes('NULL AS grant_role')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room) return null;
      return {
        owner_user_id: room.ownerUserId,
        link_access: room.linkAccess,
        grant_role: null,
      } as T;
    }

    if (this.sql.includes('FROM rooms') && this.sql.includes('SELECT owner_user_id, link_access')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room) return null;
      return {
        owner_user_id: room.ownerUserId,
        link_access: room.linkAccess,
      } as T;
    }

    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.allQueries += 1;
    if (this.sql.includes('FROM room_grants')) {
      const [roomId] = this.args as [string];
      return {
        results: [...this.db.grants.entries()]
          .filter(([key]) => key.startsWith(`${roomId}:`))
          .map(([key, role]) => ({ user_id: key.slice(roomId.length + 1), role }) as T),
      };
    }

    throw new Error(`Unexpected all SQL: ${this.sql}`);
  }
}

class FakeAccessRefreshD1Database {
  rooms = new Map<string, { ownerUserId: string | null; linkAccess: TestLinkAccess }>();
  grants = new Map<string, TestRoomRole>();
  firstQueries = 0;
  allQueries = 0;

  prepare(sql: string): FakeAccessRefreshStmt {
    return new FakeAccessRefreshStmt(this, sql);
  }
}

const HASH_A = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const CONTENT_A = new Uint8Array([1, 2, 3]);
const textEncoder = new TextEncoder();
const INTERNAL_AUTH_SECRET = 'test-internal-auth-secret';

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

function roomStub(name: string): DurableObjectStub<TestMapCollaboration> {
  const namespace = env.MapCollaboration as DurableObjectNamespace<TestMapCollaboration>;
  return namespace.get(namespace.idFromName(name));
}

function runInDO<R>(
  stub: DurableObjectStub<TestMapCollaboration>,
  callback: (instance: TestMapCollaboration, state: DurableObjectState) => R | Promise<R>,
): Promise<R> {
  return runInDurableObject(stub, callback);
}

function runAlarm(stub: DurableObjectStub<TestMapCollaboration>): Promise<boolean> {
  return runDurableObjectAlarm(stub as unknown as DurableObjectStub);
}

function createConnection(id = 'client-a'): TestConnection {
  return {
    id,
    state: null,
    sent: [],
    send(message: TestMessage) {
      this.sent.push(message);
    },
    close(code?: number, reason?: string) {
      this.closed = { code, reason };
    },
    setState(update: TestConnectionState | ((previous: TestConnectionState) => TestConnectionState)) {
      this.state = typeof update === 'function' ? update(this.state) : update;
      return this.state;
    },
  };
}

function authorizeConnection(
  connection: TestConnection,
  {
    userId = 'user-a',
    role = 'edit',
    clientId = connection.id,
    authKind = 'user',
  }: {
    userId?: string;
    role?: TestRoomRole;
    clientId?: string;
    authKind?: 'anonymous' | 'user' | 'token';
  } = {},
): TestConnection {
  connection.setState({
    ...(connection.state || {}),
    syncProtocol: 2,
    syncConnectionToken: (connection.state?.syncConnectionToken as string) || crypto.randomUUID(),
    auth: {
      userId,
      role,
      clientId,
      agentId: null,
      authKind,
      issuedAt: Date.now(),
      displayName: userId,
      avatarUrl: null,
    },
  });
  return connection;
}

function workerConnection(connection: TestConnection): WorkerConnection {
  return connection as unknown as WorkerConnection;
}

async function connectWorker(
  instance: TestMapCollaboration,
  connection: TestConnection,
  context: ConnectionContext,
): Promise<void> {
  const url = new URL(context.request.url);
  url.searchParams.set('syncProtocol', '2');
  await instance.onConnect(connection as unknown as Connection, {
    ...context,
    request: new Request(url, context.request),
  });
}

async function openStream(instance: TestMapCollaboration, connection: TestConnection) {
  await instance.onMessage(workerConnection(connection), JSON.stringify({ type: 'sync:open', protocol: 2 }));
  return sentJson(connection, 'sync:snapshot').at(-1)!;
}
async function submit(
  instance: TestMapCollaboration,
  connection: TestConnection,
  commands: RoomCommand[],
  extra: Record<string, unknown> = {},
) {
  let client = instance.sql<{
    client_id: string;
    last_seq: number;
  }>`SELECT client_id, last_seq FROM sync_clients WHERE connection_id = ${String(connection.state?.syncConnectionToken || connection.id)} ORDER BY created_at DESC LIMIT 1`[0];
  if (!client) {
    const snapshot = await openStream(instance, connection);
    if (!snapshot.clientId) return;
    client = { client_id: String(snapshot.clientId), last_seq: Number(snapshot.lastProcessedSeq) };
  }
  const state = instance.sql<{ epoch: string }>`SELECT epoch FROM sync_state WHERE singleton = 1`[0];
  const operation = {
    type: 'sync:submit',
    protocol: 2,
    epoch: state.epoch,
    clientId: client.client_id,
    seq: client.last_seq + 1,
    commands,
    ...extra,
  };
  await instance.onMessage(workerConnection(connection), JSON.stringify(operation));
  return { operation, response: sentJson(connection, 'sync:result').at(-1) as any };
}
async function sendWorkerMessage(
  instance: TestMapCollaboration,
  connection: TestConnection,
  message: WSMessage,
): Promise<void> {
  const m = typeof message === 'string' ? JSON.parse(message) : null;
  if (m && parseRoomMutation(m)) {
    if (m.type === 'layer:create')
      await submit(instance, connection, [{ type: 'create', kind: 'layer', localId: m.layer.id, data: m.layer }]);
    else if (m.type === 'annotation-feature:upsert')
      await submit(instance, connection, [{ type: 'create', kind: 'feature', localId: m.feature.id, data: m.feature }]);
    else throw new Error('Use explicit commands in new protocol tests');
  } else await instance.onMessage(workerConnection(connection), message);
}

function jsonMessage(type: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, ...(type === 'sync:request' ? { protocol: 2 } : {}), ...payload });
}

function sentJson(connection: TestConnection, type?: string): Array<Record<string, unknown>> {
  return connection.sent
    .filter((message) => typeof message === 'string')
    .flatMap((message) => {
      const parsed = JSON.parse(message);
      if ((parsed.type === 'sync:result' || parsed.type === 'sync:commit') && type !== parsed.type)
        return [
          ...(parsed.delta?.layers || []).map((layer: unknown) => ({ type: 'layer:created', layer })),
          ...(parsed.delta?.features || []).map((feature: unknown) => ({
            type: 'annotation-feature:upserted',
            feature,
          })),
        ];
      return [parsed];
    })
    .filter((message): message is Record<string, unknown> => {
      if (!message || typeof message !== 'object') return false;
      return !type || (message as Record<string, unknown>).type === type;
    });
}

function installFakeBroadcast(instance: TestMapCollaboration, connections: TestConnection[]): void {
  (instance as unknown as { broadcast: (message: TestMessage, exclude?: string[]) => void }).broadcast = (
    message,
    exclude = [],
  ) => {
    const excluded = new Set(exclude);
    for (const connection of connections) {
      if (!excluded.has(connection.id)) connection.send(message);
    }
  };
}

function encodeFileContentFrame(contentHash: string, content: Uint8Array): Uint8Array {
  const hashBytes = textEncoder.encode(contentHash);
  const buffer = new Uint8Array(2 + hashBytes.byteLength + content.byteLength);
  buffer[0] = 1;
  buffer[1] = hashBytes.byteLength;
  buffer.set(hashBytes, 2);
  buffer.set(content, 2 + hashBytes.byteLength);
  return buffer;
}

function fileLayer(id: string, contentHash: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'file',
    name: id,
    visible: true,
    sortKey: '000020',
    payload: {
      version: 1,
      fileType: 'geojson',
      contentHash,
      contentType: 'application/geo+json',
      contentEncoding: 'identity',
      contentByteLength: 3,
      rawByteLength: 20,
      bounds: [
        [0, 0],
        [1, 1],
      ],
      style: { color: '#3b82f6', opacity: 0.95, lineWidth: 5 },
    },
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

function annotationLayer(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'annotation',
    name: id,
    visible: true,
    sortKey: '000020',
    payload: { version: 1 },
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

function annotationFeature(id: string, layerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  const payload = {
    id,
    type: 'path',
    layerId,
    points: [
      [121.5, 31.2],
      [121.6, 31.3],
    ],
    directed: true,
    width: 4,
    label: id,
    note: '',
    color: '#2563eb',
    createdAt: now,
    updatedAt: now,
    updatedBy: 'user-a',
    ...extra,
  };
  return {
    id,
    layerId,
    featureType: payload.type,
    payload,
    sortKey: '000010',
    revision: 0,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    updatedBy: payload.updatedBy,
    ...extra,
  };
}

function contentHashes(instance: TestMapCollaboration): TestSqlValue[] {
  return instance.sql<{ content_hash: string }>`
    SELECT content_hash FROM file_contents ORDER BY content_hash ASC
  `.map((row) => row.content_hash);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authHeaders(
  room: string,
  {
    userId = 'user-a',
    role = 'edit',
    issuedAt = Date.now(),
    secret = INTERNAL_AUTH_SECRET,
    clientId = 'client-auth-a',
    agentId,
    authKind = 'user',
  }: {
    userId?: string;
    role?: 'view' | 'edit' | 'manage';
    issuedAt?: number;
    secret?: string;
    clientId?: string;
    agentId?: string;
    authKind?: 'anonymous' | 'user' | 'token';
  } = {},
): Promise<Headers> {
  const payload = `${room}\n${userId}\n${role}\n${clientId}\n${agentId || ''}\n${authKind}\n${issuedAt}`;
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const headers = new Headers({
    'x-orm-auth-user-id': userId,
    'x-orm-auth-user-name': 'Alice',
    'x-orm-auth-user-avatar': 'https://avatars.example/alice.png',
    'x-orm-room-role': role,
    'x-orm-auth-issued-at': String(issuedAt),
    'x-orm-auth-signature': hex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload))),
    'x-orm-client-id': clientId,
    'x-orm-auth-kind': authKind,
  });
  if (agentId) headers.set('x-orm-agent-id', agentId);
  return headers;
}

async function controlRequest(
  room: string,
  body: Record<string, unknown>,
  {
    action = 'access-refresh',
    issuedAt = Date.now(),
    secret = INTERNAL_AUTH_SECRET,
  }: { action?: string; issuedAt?: number; secret?: string } = {},
): Promise<Request> {
  const text = JSON.stringify(body);
  const payload = `${room}\n${action}\n${issuedAt}\n${text}`;
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Request(`https://example.com/parties/map-collaboration/${room}/_control/access-refresh`, {
    method: 'POST',
    headers: {
      'x-orm-control-action': action,
      'x-orm-control-issued-at': String(issuedAt),
      'x-orm-control-signature': hex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload))),
    },
    body: text,
  });
}

function withInternalAuth(instance: TestMapCollaboration): void {
  ((instance as unknown as { env: Cloudflare.Env }).env as Cloudflare.Env).INTERNAL_AUTH_SECRET = INTERNAL_AUTH_SECRET;
}

async function storeContent(
  instance: TestMapCollaboration,
  connection: TestConnection,
  contentHash = HASH_A,
  content = CONTENT_A,
): Promise<void> {
  await sendWorkerMessage(instance, connection, encodeFileContentFrame(contentHash, content));
}

describe('MapCollaboration layer storage', () => {
  it('creates the clean-break layer tables', async () => {
    const stub = roomStub('schema-clean-break');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      return {
        tables: instance.sql<{ name: string }>`
            SELECT name FROM sqlite_master
            WHERE type = ${'table'}
            ORDER BY name ASC
          `.map((row) => row.name),
        layers: instance._listLayers(),
      };
    });

    expect(result.tables).toContain('layers');
    expect(result.tables).toContain('annotation_features');
    expect(result.tables).toContain('file_contents');
    expect(result.layers[0]).toMatchObject({ id: 'annotation-default', kind: 'annotation' });
  });

  it('rejects old clients before joining and closes legacy connections after an upgrade', async () => {
    const result = await runInDO(roomStub('reject-old-protocol'), async (instance) => {
      await instance.onStart();
      const old = createConnection('old');
      await instance.onConnect(
        old as unknown as Connection,
        {
          request: new Request('https://example.com/parties/map-collaboration/reject-old-protocol'),
        } as ConnectionContext,
      );
      const previous = authorizeConnection(createConnection('previous'));
      previous.setState({ ...previous.state, syncProtocol: undefined });
      await instance.onMessage(workerConnection(previous), jsonMessage('client:update'));
      const current = authorizeConnection(createConnection('current'));
      await instance.onMessage(workerConnection(current), jsonMessage('layer:list:request'));
      return [old, previous, current].map((connection) => ({ closed: connection.closed, sent: sentJson(connection) }));
    });
    for (const entry of result) {
      expect(entry.closed?.code).toBe(1008);
      expect(entry.sent).toEqual([{ type: 'protocol:error', reason: 'upgrade-required', protocol: 2 }]);
    }
  });

  it('sends one atomic snapshot only when a v2 client requests it', async () => {
    const stub = roomStub('connect-snapshot');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const connection = createConnection('alice');
      await connectWorker(instance, connection, {
        request: new Request('https://example.com/parties/map-collaboration/connect-snapshot?name=Alice', {
          headers: await authHeaders('connect-snapshot', { role: 'edit', clientId: connection.id }),
        }),
      } as ConnectionContext);
      await openStream(instance, connection);
      return sentJson(connection).map((message) => message.type);
    });

    expect(result).toContain('presence:init');
    expect(result).toContain('room:status');
    expect(result).toContain('sync:snapshot');
    expect(result).not.toContain('layer:list');
    expect(result).not.toContain('annotation-feature:list');
    expect(result).not.toContain('overlay:init');
    expect(result).not.toContain('drawing:snapshot');
  });

  it('accepts signed auth headers and stores trusted connection auth state', async () => {
    const stub = roomStub('auth-connect');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const connection = createConnection('client-auth-a');
      await connectWorker(instance, connection, {
        request: new Request('https://example.com/parties/map-collaboration/auth-connect?name=Spoofed', {
          headers: await authHeaders('auth-connect', { role: 'edit', clientId: 'browser-session-a' }),
        }),
      } as ConnectionContext);

      return {
        state: connection.state,
        init: sentJson(connection, 'presence:init')[0],
      };
    });

    expect(result.init).toMatchObject({ type: 'presence:init', id: 'client-auth-a' });
    expect(result.state).toMatchObject({
      auth: {
        userId: 'user-a',
        role: 'edit',
        clientId: 'browser-session-a',
        displayName: 'Alice',
        avatarUrl: 'https://avatars.example/alice.png',
      },
      user: {
        id: 'browser-session-a',
        name: 'Alice',
      },
    });
  });

  it('rejects tampered or stale signed auth headers when internal auth is enabled', async () => {
    const stub = roomStub('auth-reject');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const badSignature = createConnection('bad-signature');
      const stale = createConnection('stale');
      const goodHeaders = await authHeaders('auth-reject');
      goodHeaders.set('x-orm-room-role', 'manage');
      const staleHeaders = await authHeaders('auth-reject', { issuedAt: Date.now() - 120_000 });

      const attempts: string[] = [];
      try {
        await connectWorker(instance, badSignature, {
          request: new Request('https://example.com/parties/map-collaboration/auth-reject', { headers: goodHeaders }),
        } as ConnectionContext);
      } catch (error) {
        attempts.push(error instanceof Error ? error.message : String(error));
      }
      try {
        await connectWorker(instance, stale, {
          request: new Request('https://example.com/parties/map-collaboration/auth-reject', { headers: staleHeaders }),
        } as ConnectionContext);
      } catch (error) {
        attempts.push(error instanceof Error ? error.message : String(error));
      }
      return attempts;
    });

    expect(result).toEqual(['Unauthorized room connection', 'Unauthorized room connection']);
  });

  it('uses trusted room roles for write and manage permissions', async () => {
    const stub = roomStub('auth-roles');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const viewer = createConnection('viewer');
      const manager = createConnection('manager');
      await connectWorker(instance, viewer, {
        request: new Request('https://example.com/parties/map-collaboration/auth-roles', {
          headers: await authHeaders('auth-roles', { role: 'view', clientId: 'viewer-session' }),
        }),
      } as ConnectionContext);
      await connectWorker(instance, manager, {
        request: new Request('https://example.com/parties/map-collaboration/auth-roles', {
          headers: await authHeaders('auth-roles', { userId: 'owner-a', role: 'manage', clientId: 'manager-session' }),
        }),
      } as ConnectionContext);

      await sendWorkerMessage(
        instance,
        viewer,
        jsonMessage('layer:create', { layer: annotationLayer('viewer-layer') }),
      );
      await sendWorkerMessage(instance, viewer, jsonMessage('room:update', { persistence: 'persistent' }));
      await sendWorkerMessage(instance, manager, jsonMessage('room:update', { persistence: 'persistent' }));

      return {
        viewerDenied: sentJson(viewer, 'permission:denied'),
        viewerOperation: sentJson(viewer, 'sync:snapshot'),
        managerUpdated: sentJson(manager, 'room:updated').at(-1),
      };
    });

    expect(result.viewerDenied).toEqual([{ type: 'permission:denied', action: 'room:update' }]);
    expect(result.viewerOperation).toMatchObject([{ clientId: null }]);
    expect(result.managerUpdated).toMatchObject({ type: 'room:updated', persistence: 'persistent' });
  });

  it('keeps trusted auth state after presence updates', async () => {
    const stub = roomStub('auth-state-presence-update');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const editor = createConnection('editor');
      await connectWorker(instance, editor, {
        request: new Request('https://example.com/parties/map-collaboration/auth-state-presence-update', {
          headers: await authHeaders('auth-state-presence-update', {
            userId: 'user-editor',
            role: 'edit',
            clientId: 'editor-session',
          }),
        }),
      } as ConnectionContext);
      editor.sent = [];

      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('client:update', {
          user: { id: 'editor-session', name: 'Editor', color: '#2563eb' },
          viewport: {
            center: [105, 35],
            zoom: 4,
            bearing: 0,
            pitch: 0,
            corners: [
              [104, 34],
              [106, 34],
              [106, 36],
              [104, 36],
            ],
          },
          cursor: { visible: false },
          location: { enabled: false },
          viewState: { terrain: false, satellite: false },
        }),
      );
      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('annotation-feature:upsert', { feature: annotationFeature('path-a', 'annotation-default') }),
      );

      return {
        state: editor.state,
        denied: sentJson(editor, 'permission:denied'),
        upserted: sentJson(editor, 'annotation-feature:upserted').at(-1),
        stored: instance._listAnnotationFeatures('annotation-default'),
      };
    });

    expect(result.state).toMatchObject({ auth: { userId: 'user-editor', role: 'edit', clientId: 'editor-session' } });
    expect(result.denied).toEqual([]);
    expect(result.upserted).toMatchObject({
      type: 'annotation-feature:upserted',
      feature: { id: expect.any(String), layerId: 'annotation-default' },
    });
    expect(result.stored).toHaveLength(1);
  });

  it('downgrades active connections through access refresh before later messages', async () => {
    const stub = roomStub('auth-refresh-downgrade');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const editor = createConnection('editor');
      await connectWorker(instance, editor, {
        request: new Request('https://example.com/parties/map-collaboration/auth-refresh-downgrade', {
          headers: await authHeaders('auth-refresh-downgrade', {
            userId: 'user-editor',
            role: 'edit',
            clientId: 'editor-session',
          }),
        }),
      } as ConnectionContext);

      await storeContent(instance, editor, HASH_A, CONTENT_A);
      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('layer:create', { layer: fileLayer('before-downgrade', HASH_A) }),
      );
      const refreshed = instance._applyAccessRefresh(
        [{ userId: 'user-editor', role: 'view' }],
        [workerConnection(editor)],
      );
      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('layer:create', { layer: annotationLayer('after-downgrade') }),
      );

      return {
        refreshed,
        state: editor.state,
        accessUpdated: sentJson(editor, 'access:updated').at(-1),
        denied: sentJson(editor, 'sync:result').at(-1),
        layers: instance._listLayers().map((layer) => layer.name),
      };
    });

    expect(result.refreshed).toBe(1);
    expect(result.state).toMatchObject({ auth: { role: 'view' } });
    expect(result.accessUpdated).toMatchObject({ type: 'access:updated', role: 'view', canEdit: false });
    expect(result.denied).toMatchObject({
      type: 'sync:result',
      result: { status: 'rejected', reason: 'permission-denied' },
    });
    expect(result.layers).toContain('before-downgrade');
    expect(result.layers).not.toContain('after-downgrade');
  });

  it('closes active connections when access refresh removes the last role', async () => {
    const stub = roomStub('auth-refresh-revoke');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const viewer = createConnection('viewer');
      await connectWorker(instance, viewer, {
        request: new Request('https://example.com/parties/map-collaboration/auth-refresh-revoke', {
          headers: await authHeaders('auth-refresh-revoke', {
            userId: 'user-viewer',
            role: 'view',
            clientId: 'viewer-session',
          }),
        }),
      } as ConnectionContext);

      const refreshed = instance._applyAccessRefresh(
        [{ userId: 'user-viewer', role: null }],
        [workerConnection(viewer)],
      );

      return {
        refreshed,
        revoked: sentJson(viewer, 'access:revoked').at(-1),
        closed: viewer.closed,
      };
    });

    expect(result.refreshed).toBe(1);
    expect(result.revoked).toEqual({ type: 'access:revoked' });
    expect(result.closed).toEqual({ code: 4003, reason: 'access revoked' });
  });

  it('recomputes all active connection roles for room-wide access refresh', async () => {
    const stub = roomStub('auth-refresh-room');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const db = new FakeAccessRefreshD1Database();
      db.rooms.set('auth-refresh-room', { ownerUserId: 'owner', linkAccess: 'restricted' });
      db.grants.set('auth-refresh-room:user-editor', 'edit');
      ((instance as unknown as { env: Cloudflare.Env }).env as Cloudflare.Env).ACCOUNTS_DB =
        db as unknown as D1Database;

      const anonymous = createConnection('anonymous');
      await connectWorker(instance, anonymous, {
        request: new Request('https://example.com/parties/map-collaboration/auth-refresh-room', {
          headers: await authHeaders('auth-refresh-room', {
            userId: 'anon_public',
            role: 'edit',
            clientId: 'public-session',
            authKind: 'anonymous',
          }),
        }),
      } as ConnectionContext);

      const editor = createConnection('editor');
      await connectWorker(instance, editor, {
        request: new Request('https://example.com/parties/map-collaboration/auth-refresh-room', {
          headers: await authHeaders('auth-refresh-room', {
            userId: 'user-editor',
            role: 'edit',
            clientId: 'editor-session',
          }),
        }),
      } as ConnectionContext);

      const refreshed = await instance._applyAccessRefreshPayload({ refresh: { mode: 'room' } }, [
        workerConnection(anonymous),
        workerConnection(editor),
      ]);

      return {
        refreshed,
        anonymousRevoked: sentJson(anonymous, 'access:revoked').at(-1),
        anonymousClosed: anonymous.closed,
        editorUpdated: sentJson(editor, 'access:updated').at(-1),
        editorState: editor.state,
        firstQueries: db.firstQueries,
        allQueries: db.allQueries,
      };
    });

    expect(result.refreshed).toBe(2);
    expect(result.anonymousRevoked).toEqual({ type: 'access:revoked' });
    expect(result.anonymousClosed).toEqual({ code: 4003, reason: 'access revoked' });
    expect(result.editorUpdated).toMatchObject({ type: 'access:updated', role: 'edit', canEdit: true });
    expect(result.editorState).toMatchObject({ auth: { userId: 'user-editor', role: 'edit' } });
    expect(result.firstQueries).toBe(1);
    expect(result.allQueries).toBe(1);
  });

  it('upgrades active anonymous viewers when link access changes to edit', async () => {
    const stub = roomStub('auth-refresh-link-edit');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const db = new FakeAccessRefreshD1Database();
      db.rooms.set('auth-refresh-link-edit', { ownerUserId: 'owner', linkAccess: 'view' });
      ((instance as unknown as { env: Cloudflare.Env }).env as Cloudflare.Env).ACCOUNTS_DB =
        db as unknown as D1Database;

      const editor = createConnection('guest-editor');
      const observer = createConnection('guest-observer');
      installFakeBroadcast(instance, [editor, observer]);

      await connectWorker(instance, editor, {
        request: new Request('https://example.com/parties/map-collaboration/auth-refresh-link-edit', {
          headers: await authHeaders('auth-refresh-link-edit', {
            userId: 'anon_editor',
            role: 'view',
            clientId: 'editor-session',
            authKind: 'anonymous',
          }),
        }),
      } as ConnectionContext);
      await connectWorker(instance, observer, {
        request: new Request('https://example.com/parties/map-collaboration/auth-refresh-link-edit', {
          headers: await authHeaders('auth-refresh-link-edit', {
            userId: 'anon_observer',
            role: 'view',
            clientId: 'observer-session',
            authKind: 'anonymous',
          }),
        }),
      } as ConnectionContext);

      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('client:update', {
          user: { id: 'editor-session', name: 'Guest Editor', color: '#2563eb' },
          viewport: {
            center: [105, 35],
            zoom: 4,
            bearing: 0,
            pitch: 0,
            corners: [
              [104, 34],
              [106, 34],
              [106, 36],
              [104, 36],
            ],
          },
          cursor: { visible: false },
          location: { enabled: false },
          viewState: { terrain: false, satellite: false },
        }),
      );

      editor.sent = [];
      observer.sent = [];
      db.rooms.set('auth-refresh-link-edit', { ownerUserId: 'owner', linkAccess: 'edit' });

      const refreshed = await instance._applyAccessRefreshPayload({ refresh: { mode: 'room' } }, [
        workerConnection(editor),
        workerConnection(observer),
      ]);
      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('annotation-feature:upsert', {
          feature: annotationFeature('upgraded-point', 'annotation-default'),
        }),
      );

      return {
        refreshed,
        editorAccessUpdated: sentJson(editor, 'access:updated').at(-1),
        editorDenied: sentJson(editor, 'permission:denied'),
        editorState: editor.state,
        observerFeatureUpserted: sentJson(observer, 'annotation-feature:upserted').at(-1),
        stored: instance._listAnnotationFeatures('annotation-default'),
      };
    });

    expect(result.refreshed).toBe(2);
    expect(result.editorAccessUpdated).toMatchObject({ type: 'access:updated', role: 'edit', canEdit: true });
    expect(result.editorDenied).toEqual([]);
    expect(result.editorState).toMatchObject({ auth: { userId: 'anon_editor', role: 'edit' } });
    expect(result.observerFeatureUpserted).toMatchObject({
      type: 'annotation-feature:upserted',
      feature: { id: expect.any(String), layerId: 'annotation-default' },
    });
    expect(result.stored).toHaveLength(1);
  });

  it('accepts signed access-refresh control requests and rejects stale control requests', async () => {
    const stub = roomStub('auth-refresh-control');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const ok = await instance.onRequest(
        await controlRequest('auth-refresh-control', { updates: [{ userId: 'user-a', role: 'view' }] }),
      );
      const stale = await instance.onRequest(
        await controlRequest(
          'auth-refresh-control',
          { updates: [{ userId: 'user-a', role: 'view' }] },
          { issuedAt: Date.now() - 120_000 },
        ),
      );
      return {
        ok: { status: ok.status, body: await ok.json() },
        stale: { status: stale.status, body: await stale.text() },
      };
    });

    expect(result.ok).toEqual({ status: 200, body: { ok: true, refreshed: 0 } });
    expect(result.stale).toEqual({ status: 403, body: 'Unauthorized control request' });
  });

  it('serves room status and updates room persistence', async () => {
    const stub = roomStub('room-status');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection(), { role: 'manage' });

      await sendWorkerMessage(instance, connection, jsonMessage('room:status:request'));
      await sendWorkerMessage(instance, connection, jsonMessage('room:update', { persistence: 'persistent' }));

      return {
        status: sentJson(connection, 'room:status').at(-1),
        updated: sentJson(connection, 'room:updated').at(-1),
        roomMeta: instance.sql`
          SELECT persistence, expires_at
          FROM room_meta
          WHERE room_id = ${'room-status'}
          LIMIT 1
        `[0],
      };
    });

    expect(result.status).toMatchObject({ type: 'room:status', room: 'room-status', persistence: 'ephemeral' });
    expect(result.updated).toMatchObject({ type: 'room:updated', room: 'room-status', persistence: 'persistent' });
    expect(result.roomMeta).toMatchObject({ persistence: 'persistent', expires_at: null });
  });

  it('does not rewrite identical file content uploads', async () => {
    const stub = roomStub('file-content-replay-dedupe');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection());
      const now = vi.spyOn(Date, 'now');

      now.mockReturnValue(1_000);
      await storeContent(instance, connection, HASH_A, CONTENT_A);
      now.mockReturnValue(9_000);
      await storeContent(instance, connection, HASH_A, CONTENT_A);

      return {
        stored: sentJson(connection, 'file:content:stored'),
        row: instance.sql<{ content_hash: string; created_at: number }>`
          SELECT content_hash, created_at FROM file_contents WHERE content_hash = ${HASH_A} LIMIT 1
        `[0],
      };
    });

    expect(result.stored).toEqual([
      { type: 'file:content:stored', contentHash: HASH_A },
      { type: 'file:content:stored', contentHash: HASH_A },
    ]);
    expect(result.row).toEqual({ content_hash: HASH_A, created_at: 1_000 });
  });

  it('returns a protocol error for old overlay and drawing messages', async () => {
    const stub = roomStub('legacy-protocol-error');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection());
      await sendWorkerMessage(instance, connection, jsonMessage('overlay:upsert', { manifest: {} }));
      await sendWorkerMessage(instance, connection, jsonMessage('drawing:feature:upsert', { feature: {} }));
      return sentJson(connection, 'protocol:error');
    });

    expect(result).toEqual([
      {
        type: 'protocol:error',
        reason: 'upgrade-required',
        protocol: 2,
      },
      {
        type: 'protocol:error',
        reason: 'upgrade-required',
        protocol: 2,
      },
    ]);
  });

  it('clears layer tables on ephemeral room alarm', async () => {
    const stub = roomStub('alarm-cleanup');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();
      await connectWorker(instance, connection, {
        request: new Request('https://example.com/parties/map-collaboration/alarm-cleanup?name=Alice', {
          headers: await authHeaders('alarm-cleanup', { role: 'edit', clientId: connection.id }),
        }),
      } as ConnectionContext);
      await storeContent(instance, connection, HASH_A, CONTENT_A);
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: fileLayer('route-a', HASH_A) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('annotation-feature:upsert', {
          feature: annotationFeature('path-a', 'annotation-default'),
        }),
      );
      instance.sql`
        UPDATE room_meta
        SET expires_at = ${Date.now() - 1}
        WHERE room_id = ${'alarm-cleanup'}
      `;
      return {
        before: {
          layers: instance._listLayers(),
          features: instance._listAnnotationFeatures(),
          content: contentHashes(instance),
        },
      };
    });
    await runAlarm(stub);
    const after = await runInDO(stub, (instance) => ({
      layers: instance._listLayers(),
      features: instance._listAnnotationFeatures(),
      content: contentHashes(instance),
      roomMeta: instance.sql`SELECT room_id FROM room_meta`,
    }));

    expect(result.before.layers.length).toBeGreaterThan(0);
    expect(result.before.features.length).toBeGreaterThan(0);
    expect(result.before.content).toEqual([HASH_A]);
    expect(after.layers).toEqual([]);
    expect(after.features).toEqual([]);
    expect(after.content).toEqual([]);
    expect(after.roomMeta).toEqual([]);
  });
  it('assigns IDs and retains only the latest compact result per stream', async () => {
    const data = await runInDO(roomStub('bounded-stream'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const created = await submit(instance, c, [
        { type: 'create', kind: 'layer', localId: 'draft', data: annotationLayer('chosen-id') },
      ]);
      const id = created!.response.result.ids.draft;
      expect(id).not.toBe('chosen-id');
      for (let i = 0; i < 150; i++)
        await submit(instance, c, [
          {
            type: 'patch',
            kind: 'layer',
            id,
            fields: { name: { expectedVersion: fieldVersion(instance._getLayer(id), 'name'), value: `Edit ${i}` } },
          },
        ]);
      return {
        row: instance._getLayer(id),
        clients: instance.sql`SELECT last_seq, result_json FROM sync_clients`,
        tables: instance.sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
      };
    });
    expect(data.row?.name).toBe('Edit 149');
    expect(data.clients).toHaveLength(1);
    expect(data.clients[0].last_seq).toBe(151);
    expect(String(data.clients[0].result_json).length).toBeLessThan(1000);
    expect(String(data.clients[0].result_json)).not.toContain('Edit 149');
    expect(data.tables.map((row) => row.name)).not.toContain('sync_receipts');
    expect(data.tables.map((row) => row.name)).not.toContain('deleted_layers');
  });

  it('deduplicates the last batch and rejects altered bodies and sequence gaps', async () => {
    const data = await runInDO(roomStub('stream-retry'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const first = (await submit(instance, c, [
        { type: 'create', kind: 'layer', localId: 'draft', data: annotationLayer('draft') },
      ]))!;
      await instance.onMessage(workerConnection(c), JSON.stringify(first.operation));
      const replay = sentJson(c, 'sync:result').at(-1);
      await instance.onMessage(
        workerConnection(c),
        JSON.stringify({
          ...first.operation,
          commands: [{ type: 'delete', kind: 'layer', id: first.response.result.ids.draft }],
        }),
      );
      await instance.onMessage(workerConnection(c), JSON.stringify({ ...first.operation, seq: 3 }));
      return { first: first.response, replay, errors: sentJson(c, 'sync:error'), layers: instance._listLayers() };
    });
    expect(data.replay?.result).toEqual(data.first.result);
    expect(data.replay?.delta).toBeUndefined();
    expect(data.errors.map((error) => error.reason)).toEqual(['sequence-reused', 'sequence-gap']);
    expect(data.layers).toHaveLength(2);
  });

  it('merges independent fields but rejects same-field conflicts atomically', async () => {
    const data = await runInDO(roomStub('field-conflicts'), async (instance) => {
      await instance.onStart();
      const a = authorizeConnection(createConnection('a'));
      const b = authorizeConnection(createConnection('b'));
      const created = (await submit(instance, a, [
        { type: 'create', kind: 'layer', localId: 'draft', data: annotationLayer('original') },
      ]))!;
      const id = created.response.result.ids.draft;
      await submit(instance, a, [
        { type: 'patch', kind: 'layer', id, fields: { name: { expectedVersion: 1, value: 'A' } } },
      ]);
      await submit(instance, b, [
        { type: 'patch', kind: 'layer', id, fields: { visible: { expectedVersion: 1, value: false } } },
      ]);
      const rejected = (await submit(instance, b, [
        { type: 'create', kind: 'layer', localId: 'must-rollback', data: annotationLayer('Never') },
        { type: 'patch', kind: 'layer', id, fields: { name: { expectedVersion: 1, value: 'B' } } },
      ]))!;
      return {
        row: instance._getLayer(id),
        layers: instance._listLayers(),
        result: rejected.response.result,
        client:
          instance.sql`SELECT last_seq, result_json FROM sync_clients WHERE connection_id = ${String(b.state?.syncConnectionToken)}`[0],
      };
    });
    expect(data.row).toMatchObject({ name: 'A', visible: false, fieldVersions: { name: 2, visible: 3 } });
    expect(data.layers).toHaveLength(2);
    expect(data.result).toMatchObject({
      status: 'rejected',
      reason: 'revision-conflict',
      commandIndex: 1,
      commitVersion: 3,
    });
    expect(data.client.last_seq).toBe(2);
  });

  it('uses the batch baseline for dependent create and patch commands', async () => {
    const data = await runInDO(roomStub('batch-create-patch'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const response = (await submit(instance, c, [
        { type: 'create', kind: 'layer', localId: 'draft', data: annotationLayer('Original') },
        { type: 'patch', kind: 'layer', id: 'draft', fields: { name: { expectedVersion: 0, value: 'Renamed' } } },
        { type: 'create', kind: 'feature', localId: 'point', data: annotationFeature('point', 'draft') },
      ]))!.response;
      return { response, layers: instance._listLayers(), features: instance._listAnnotationFeatures() };
    });
    expect(data.response.result.status).toBe('accepted');
    expect(data.layers.find((row) => row.name === 'Renamed')).toBeTruthy();
    expect(data.features[0].layerId).toBe(data.response.result.ids.draft);
  });

  it('deletion dominates stale edits without storing tombstones or allowing ID reuse', async () => {
    const data = await runInDO(roomStub('delete-no-tombstones'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const created = (await submit(instance, c, [
        { type: 'create', kind: 'layer', localId: 'draft', data: annotationLayer('Draft') },
      ]))!;
      const id = created.response.result.ids.draft;
      await submit(instance, c, [
        { type: 'create', kind: 'feature', localId: 'feature', data: annotationFeature('feature', id) },
      ]);
      await submit(instance, c, [{ type: 'delete', kind: 'layer', id }]);
      const stale = (await submit(instance, c, [
        { type: 'patch', kind: 'layer', id, fields: { name: { expectedVersion: 1, value: 'Old cache' } } },
      ]))!.response;
      const duplicateDelete = (await submit(instance, c, [{ type: 'delete', kind: 'layer', id }]))!.response;
      const fresh = (await submit(instance, c, [
        { type: 'create', kind: 'layer', localId: 'fresh', data: annotationLayer(id) },
      ]))!.response;
      return { stale, duplicateDelete, fresh, id, features: instance._listAnnotationFeatures() };
    });
    expect(data.stale.result.reason).toBe('target_missing');
    expect(data.features).toEqual([]);
    expect(data.duplicateDelete.result).toMatchObject({ status: 'accepted', commitVersion: 3 });
    expect(data.fresh.result.ids.fresh).not.toBe(data.id);
  });

  it('fences replaced connections and rejects expired streams before metadata collection', async () => {
    const data = await runInDO(roomStub('lease-fence'), async (instance) => {
      await instance.onStart();
      const a = authorizeConnection(createConnection('a'));
      const b = authorizeConnection(createConnection('b'));
      const initial = await openStream(instance, a);
      await instance.onMessage(
        workerConnection(b),
        JSON.stringify({ type: 'sync:open', protocol: 2, clientId: initial.clientId, epoch: initial.epoch }),
      );
      await instance.onMessage(
        workerConnection(a),
        JSON.stringify({
          type: 'sync:submit',
          protocol: 2,
          clientId: initial.clientId,
          epoch: initial.epoch,
          seq: 1,
          commands: [{ type: 'delete', kind: 'layer', id: 'annotation-default' }],
        }),
      );
      instance.sql`UPDATE sync_clients SET expires_at = ${Date.now() - 1}`;
      await instance.onMessage(
        workerConnection(b),
        JSON.stringify({ type: 'sync:open', protocol: 2, clientId: initial.clientId, epoch: initial.epoch }),
      );
      return { a: sentJson(a, 'sync:error'), b: sentJson(b, 'sync:error'), layers: instance._listLayers() };
    });
    expect(data.a[0].reason).toBe('client_fenced');
    expect(data.b[0].reason).toBe('client_expired');
    expect(data.layers).toHaveLength(1);
  });

  it('does not allow another identity to resume a stream and limits stream creation', async () => {
    const data = await runInDO(roomStub('stream-owner'), async (instance) => {
      await instance.onStart();
      const a = authorizeConnection(createConnection('a'), { userId: 'a' });
      const b = authorizeConnection(createConnection('b'), { userId: 'b' });
      const initial = await openStream(instance, a);
      await instance.onMessage(
        workerConnection(b),
        JSON.stringify({ type: 'sync:open', protocol: 2, clientId: initial.clientId, epoch: initial.epoch }),
      );
      for (let i = 0; i < 20; i++)
        await instance.onMessage(workerConnection(a), JSON.stringify({ type: 'sync:open', protocol: 2 }));
      return {
        b: sentJson(b, 'sync:error'),
        a: sentJson(a, 'sync:error'),
        count: instance.sql`SELECT COUNT(*) AS n FROM sync_clients`[0],
      };
    });
    expect(data.b[0].reason).toBe('client_forbidden');
    expect(data.a.at(-1)?.reason).toBe('client_limit');
    expect(data.count.n).toBe(16);
  });

  it('rolls back business data, stream progress and room version together on storage failure', async () => {
    const data = await runInDO(roomStub('stream-rollback'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      await openStream(instance, c);
      const original = instance._upsertLayerRow.bind(instance);
      const spy = vi.spyOn(instance, '_upsertLayerRow').mockImplementation((row) => {
        original(row);
        throw new Error('injected');
      });
      await expect(
        submit(instance, c, [{ type: 'create', kind: 'layer', localId: 'draft', data: annotationLayer('Draft') }]),
      ).rejects.toThrow('injected');
      spy.mockRestore();
      return {
        layers: instance._listLayers(),
        state: instance.sql`SELECT seq FROM sync_state`[0],
        client: instance.sql`SELECT last_seq, result_json FROM sync_clients`[0],
        results: sentJson(c, 'sync:result'),
      };
    });
    expect(data.layers).toHaveLength(1);
    expect(data.state.seq).toBe(0);
    expect(data.client).toMatchObject({ last_seq: 0, result_json: null });
    expect(data.results).toEqual([]);
  });

  it('applies semantic moves without changing unrelated position versions', async () => {
    const data = await runInDO(roomStub('semantic-move'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const created = (await submit(
        instance,
        c,
        ['a', 'b', 'c'].map((id) => ({
          type: 'create' as const,
          kind: 'layer' as const,
          localId: id,
          data: annotationLayer(id),
        })),
      ))!.response.result.ids;
      await submit(instance, c, [
        { type: 'move', kind: 'layer', id: created.c, beforeId: created.a, expectedVersion: 1 },
      ]);
      const stale = (await submit(instance, c, [
        { type: 'move', kind: 'layer', id: created.c, beforeId: null, expectedVersion: 1 },
      ]))!.response;
      return { rows: instance._listLayers(), ids: created, stale };
    });
    expect(data.rows.map((row) => row.name)).toEqual(['Annotations', 'c', 'a', 'b']);
    expect(
      fieldVersion(
        data.rows.find((row) => row.id === data.ids.a),
        'position',
      ),
    ).toBe(1);
    expect(data.stale.result.reason).toBe('revision-conflict');
  });

  it('returns an atomic snapshot with the last rejected outcome and no historical receipts', async () => {
    const data = await runInDO(roomStub('snapshot-progress'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const failed = (await submit(instance, c, [
        { type: 'patch', kind: 'layer', id: 'missing', fields: { name: { expectedVersion: 0, value: 'No' } } },
      ]))!;
      await instance.onMessage(
        workerConnection(c),
        JSON.stringify({
          type: 'sync:request',
          protocol: 2,
          clientId: failed.operation.clientId,
          epoch: failed.operation.epoch,
        }),
      );
      return sentJson(c, 'sync:snapshot').at(-1);
    });
    expect(data).toMatchObject({
      commitVersion: 0,
      lastProcessedSeq: 1,
      lastResult: { status: 'rejected', reason: 'target_missing' },
      features: [],
    });
    expect(data).not.toHaveProperty('receipts');
  });

  it('fences reconnects even when the transport reuses the same connection ID', async () => {
    const data = await runInDO(roomStub('same-transport-id'), async (instance) => {
      await instance.onStart();
      const old = authorizeConnection(createConnection('same'));
      const fresh = authorizeConnection(createConnection('same'));
      const initial = await openStream(instance, old);
      await instance.onMessage(
        workerConnection(fresh),
        JSON.stringify({ type: 'sync:open', protocol: 2, clientId: initial.clientId, epoch: initial.epoch }),
      );
      await instance.onMessage(
        workerConnection(old),
        JSON.stringify({
          type: 'sync:submit',
          protocol: 2,
          clientId: initial.clientId,
          epoch: initial.epoch,
          seq: 1,
          commands: [{ type: 'delete', kind: 'layer', id: 'annotation-default' }],
        }),
      );
      return { errors: sentJson(old, 'sync:error'), layers: instance._listLayers() };
    });
    expect(data.errors[0].reason).toBe('client_fenced');
    expect(data.layers).toHaveLength(1);
  });

  it('verifies uploaded bytes and materializes prepared geometry inside an atomic batch', async () => {
    const data = await runInDO(roomStub('prepared-geometry'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          type: 'path',
          points: [
            [121.5, 31.2],
            [121.6, 31.3],
          ],
          label: 'Prepared',
          note: '',
        }),
      );
      const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
      await storeContent(instance, c, HASH_A, bytes);
      expect(sentJson(c, 'sync:error').at(-1)?.reason).toBe('content-hash-mismatch');
      const commands: RoomCommand[] = [
        {
          type: 'create',
          kind: 'feature',
          localId: 'prepared',
          data: { id: 'prepared', layerId: 'annotation-default', featureType: 'path', payload: { $content: hash } },
        },
      ];
      const initial = await openStream(instance, c);
      const request = {
        type: 'sync:submit',
        protocol: 2,
        clientId: initial.clientId,
        epoch: initial.epoch,
        seq: 1,
        commands,
      };
      await instance.onMessage(workerConnection(c), JSON.stringify(request));
      expect(sentJson(c, 'sync:error').at(-1)?.reason).toBe('content_needed');
      await storeContent(instance, c, hash, bytes);
      await instance.onMessage(workerConnection(c), JSON.stringify(request));
      return {
        rows: instance._listAnnotationFeatures(),
        result: sentJson(c, 'sync:result').at(-1),
        clients: instance.sql`SELECT last_seq, length(result_json) AS size FROM sync_clients`,
      };
    });
    expect(data.rows[0].payload).toMatchObject({
      label: 'Prepared',
      points: [
        [121.5, 31.2],
        [121.6, 31.3],
      ],
    });
    expect(data.result).toMatchObject({ result: { seq: 1, status: 'accepted' } });
    expect(data.clients[0].last_seq).toBe(1);
    expect(Number(data.clients[0].size)).toBeLessThan(2000);
  });

  it('exposes bounded diagnostic counters only to room managers', async () => {
    const data = await runInDO(roomStub('sync-metrics'), async (instance) => {
      await instance.onStart();
      const c = authorizeConnection(createConnection());
      await submit(instance, c, [{ type: 'delete', kind: 'layer', id: 'missing' }]);
      await instance.onMessage(workerConnection(c), JSON.stringify({ type: 'sync:stats:request', protocol: 2 }));
      expect(sentJson(c, 'sync:error').at(-1)?.reason).toBe('permission-denied');
      authorizeConnection(c, { role: 'manage' });
      await instance.onMessage(workerConnection(c), JSON.stringify({ type: 'sync:stats:request', protocol: 2 }));
      return sentJson(c, 'sync:stats').at(-1);
    });
    expect(data).toMatchObject({ submissions: 1, commands: 1, snapshots: 1, metadata: { clientRows: 1 } });
  });
});
