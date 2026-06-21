import { afterEach, describe, expect, it, vi } from 'vitest';
import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
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

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CONTENT_A = new Uint8Array([1, 2, 3]);
const CONTENT_B = new Uint8Array([4, 5, 6, 7]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
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
  await instance.onConnect(connection as unknown as Connection, context);
}

async function sendWorkerMessage(
  instance: TestMapCollaboration,
  connection: TestConnection,
  message: WSMessage,
): Promise<void> {
  await instance.onMessage(workerConnection(connection), message);
}

function jsonMessage(type: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, ...payload });
}

function sentJson(connection: TestConnection, type?: string): Array<Record<string, unknown>> {
  return connection.sent
    .filter((message) => typeof message === 'string')
    .map((message) => JSON.parse(message) as unknown)
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

function decodeFileContentFrame(message: unknown): { contentHash: string; content: Uint8Array } | null {
  const bytes =
    message instanceof ArrayBuffer
      ? new Uint8Array(message)
      : ArrayBuffer.isView(message)
        ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
        : null;
  if (!bytes || bytes[0] !== 1) return null;
  const hashLength = bytes[1];
  return {
    contentHash: textDecoder.decode(bytes.slice(2, 2 + hashLength)),
    content: bytes.slice(2 + hashLength),
  };
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

function contentCount(instance: TestMapCollaboration): number {
  return Number(
    instance.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM file_contents
    `[0]?.count || 0,
  );
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

  it('sends layer and annotation-feature lists when a client connects', async () => {
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
      return sentJson(connection).map((message) => message.type);
    });

    expect(result).toContain('presence:init');
    expect(result).toContain('room:status');
    expect(result).toContain('layer:list');
    expect(result).toContain('annotation-feature:list');
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
        managerUpdated: sentJson(manager, 'room:updated').at(-1),
      };
    });

    expect(result.viewerDenied).toEqual([
      { type: 'permission:denied', action: 'layer:create' },
      { type: 'permission:denied', action: 'room:update' },
    ]);
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
      feature: { id: 'path-a', layerId: 'annotation-default' },
    });
    expect(result.stored).toHaveLength(1);
  });

  it('broadcasts editor layer and annotation updates to active viewers', async () => {
    const stub = roomStub('viewer-sync');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      withInternalAuth(instance);
      const viewer = createConnection('viewer');
      const editor = createConnection('editor');
      installFakeBroadcast(instance, [viewer, editor]);

      await connectWorker(instance, viewer, {
        request: new Request('https://example.com/parties/map-collaboration/viewer-sync', {
          headers: await authHeaders('viewer-sync', {
            userId: 'user-viewer',
            role: 'view',
            clientId: 'viewer-session',
          }),
        }),
      } as ConnectionContext);
      await connectWorker(instance, editor, {
        request: new Request('https://example.com/parties/map-collaboration/viewer-sync', {
          headers: await authHeaders('viewer-sync', {
            userId: 'user-editor',
            role: 'edit',
            clientId: 'editor-session',
          }),
        }),
      } as ConnectionContext);
      viewer.sent = [];
      editor.sent = [];

      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('layer:create', { layer: annotationLayer('day-1', { sortKey: '000030' }) }),
      );
      await sendWorkerMessage(
        instance,
        editor,
        jsonMessage('annotation-feature:upsert', { feature: annotationFeature('path-a', 'day-1') }),
      );
      await sendWorkerMessage(instance, viewer, jsonMessage('annotation-feature:list:request', { layerId: 'day-1' }));

      return {
        viewerLayerCreated: sentJson(viewer, 'layer:created').at(-1),
        viewerFeatureUpserted: sentJson(viewer, 'annotation-feature:upserted').at(-1),
        viewerFeatureList: sentJson(viewer, 'annotation-feature:list').at(-1),
        viewerDenied: sentJson(viewer, 'permission:denied'),
      };
    });

    expect(result.viewerLayerCreated).toMatchObject({
      type: 'layer:created',
      layer: { id: 'day-1', kind: 'annotation' },
    });
    expect(result.viewerFeatureUpserted).toMatchObject({
      type: 'annotation-feature:upserted',
      feature: { id: 'path-a', layerId: 'day-1', featureType: 'path' },
    });
    expect(result.viewerFeatureList).toMatchObject({
      type: 'annotation-feature:list',
      layerId: 'day-1',
      features: [{ id: 'path-a', layerId: 'day-1', featureType: 'path' }],
    });
    expect(result.viewerDenied).toEqual([]);
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
        denied: sentJson(editor, 'permission:denied').at(-1),
        layers: instance._listLayers().map((layer) => layer.id),
      };
    });

    expect(result.refreshed).toBe(1);
    expect(result.state).toMatchObject({ auth: { role: 'view' } });
    expect(result.accessUpdated).toMatchObject({ type: 'access:updated', role: 'view', canEdit: false });
    expect(result.denied).toEqual({ type: 'permission:denied', action: 'layer:create' });
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
      feature: { id: 'upgraded-point', layerId: 'annotation-default' },
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

  it('stores file content, creates file layers, serves content requests, and prunes unreferenced content', async () => {
    const stub = roomStub('file-layer-flow');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection());

      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: fileLayer('route-a', HASH_A) }),
      );
      const needed = sentJson(connection, 'file:content:needed');

      await storeContent(instance, connection, HASH_A, CONTENT_A);
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: fileLayer('route-a', HASH_A) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:update', {
          layerId: 'route-a',
          patch: { name: 'Route A', payload: { style: { color: '#ef4444', opacity: 0.5 } } },
        }),
      );
      await sendWorkerMessage(instance, connection, jsonMessage('file:content:request', { contentHash: HASH_A }));
      const binary = decodeFileContentFrame(connection.sent.at(-1));
      await sendWorkerMessage(instance, connection, jsonMessage('layer:delete', { layerId: 'route-a' }));

      return {
        needed,
        stored: sentJson(connection, 'file:content:stored'),
        created: sentJson(connection, 'layer:created').at(-1),
        updated: sentJson(connection, 'layer:updated').at(-1),
        binary,
        layers: instance._listLayers(),
        contentCount: contentCount(instance),
      };
    });

    expect(result.needed).toEqual([{ type: 'file:content:needed', contentHash: HASH_A }]);
    expect(result.stored).toEqual([{ type: 'file:content:stored', contentHash: HASH_A }]);
    expect(result.created).toMatchObject({ type: 'layer:created', layer: { id: 'route-a', kind: 'file' } });
    expect(result.updated).toMatchObject({
      type: 'layer:updated',
      layer: { id: 'route-a', name: 'Route A', payload: { style: { color: '#ef4444', opacity: 0.5 } } },
    });
    expect(result.binary).toEqual({ contentHash: HASH_A, content: CONTENT_A });
    expect(result.layers.map((layer) => layer.id)).toEqual(['annotation-default']);
    expect(result.contentCount).toBe(0);
  });

  it('does not rewrite identical layer create replays', async () => {
    const stub = roomStub('layer-create-replay-dedupe');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection());
      await storeContent(instance, connection, HASH_A, CONTENT_A);

      const layer = fileLayer('route-a', HASH_A);
      await sendWorkerMessage(instance, connection, jsonMessage('layer:create', { layer }));
      await sendWorkerMessage(instance, connection, jsonMessage('layer:create', { layer }));

      return {
        layers: instance._listLayers(),
        created: sentJson(connection, 'layer:created'),
      };
    });

    const route = result.layers.find((layer) => layer.id === 'route-a');
    expect(route).toMatchObject({ id: 'route-a', revision: 1 });
    expect(result.created).toHaveLength(2);
    expect(result.created[1].layer).toMatchObject({ id: 'route-a', revision: 1 });
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

  it('stores annotation features as rows and rejects features for missing layers', async () => {
    const stub = roomStub('annotation-feature-flow');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection());

      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('annotation-feature:upsert', { feature: annotationFeature('missing-feature', 'missing-layer') }),
      );
      await sendWorkerMessage(instance, connection, encodeFileContentFrame(HASH_A, CONTENT_A));
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: fileLayer('route-layer', HASH_A) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('annotation-feature:upsert', { feature: annotationFeature('wrong-kind-feature', 'route-layer') }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: annotationLayer('day-1', { sortKey: '000030' }) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('annotation-feature:upsert', { feature: annotationFeature('path-a', 'day-1') }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('annotation-feature:reorder', { updates: [{ featureId: 'path-a', sortKey: '000050' }] }),
      );

      const beforeDelete = instance._listAnnotationFeatures('day-1');
      await sendWorkerMessage(instance, connection, jsonMessage('layer:delete', { layerId: 'day-1' }));

      return {
        rejected: sentJson(connection, 'annotation-feature:rejected'),
        upserted: sentJson(connection, 'annotation-feature:upserted')[0],
        reordered: sentJson(connection, 'annotation-feature:reordered')[0],
        beforeDelete,
        afterDelete: instance._listAnnotationFeatures('day-1'),
      };
    });

    expect(result.rejected).toEqual([
      {
        type: 'annotation-feature:rejected',
        featureId: 'missing-feature',
        layerId: 'missing-layer',
        reason: 'missing-layer',
      },
      {
        type: 'annotation-feature:rejected',
        featureId: 'wrong-kind-feature',
        layerId: 'route-layer',
        layerKind: 'file',
        reason: 'wrong-layer-kind',
      },
    ]);
    expect(result.upserted).toMatchObject({
      type: 'annotation-feature:upserted',
      feature: { id: 'path-a', layerId: 'day-1', featureType: 'path' },
    });
    expect(result.reordered).toMatchObject({
      type: 'annotation-feature:reordered',
      features: [{ id: 'path-a', sortKey: '000050' }],
    });
    expect(result.beforeDelete).toHaveLength(1);
    expect(result.afterDelete).toEqual([]);
  });

  it('keeps concurrent annotation feature inserts as separate rows', async () => {
    const stub = roomStub('annotation-feature-concurrent-inserts');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connectionA = authorizeConnection(createConnection('client-a'), { userId: 'user-a' });
      const connectionB = authorizeConnection(createConnection('client-b'), { userId: 'user-b' });

      await sendWorkerMessage(
        instance,
        connectionA,
        jsonMessage('layer:create', { layer: annotationLayer('day-1', { sortKey: '000030' }) }),
      );
      await sendWorkerMessage(
        instance,
        connectionA,
        jsonMessage('annotation-feature:upsert', {
          feature: annotationFeature('path-a', 'day-1', { sortKey: '000010', label: 'A' }),
        }),
      );
      await sendWorkerMessage(
        instance,
        connectionB,
        jsonMessage('annotation-feature:upsert', {
          feature: annotationFeature('path-b', 'day-1', { sortKey: '000020', label: 'B', updatedBy: 'user-b' }),
        }),
      );

      return {
        features: instance._listAnnotationFeatures('day-1'),
        connectionAUpserts: sentJson(connectionA, 'annotation-feature:upserted'),
        connectionBUpserts: sentJson(connectionB, 'annotation-feature:upserted'),
      };
    });

    expect(result.features.map((feature) => feature.id)).toEqual(['path-a', 'path-b']);
    expect(result.features.map((feature) => (feature.payload as Record<string, unknown>).label)).toEqual(['A', 'B']);
    expect(result.connectionAUpserts).toHaveLength(1);
    expect(result.connectionBUpserts).toHaveLength(1);
  });

  it('uses last-write-wins for same-feature annotation updates and increments revision', async () => {
    const stub = roomStub('annotation-feature-last-write-wins');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connectionA = authorizeConnection(createConnection('client-a'), { userId: 'user-a' });
      const connectionB = authorizeConnection(createConnection('client-b'), { userId: 'user-b' });

      await sendWorkerMessage(
        instance,
        connectionA,
        jsonMessage('layer:create', { layer: annotationLayer('day-1', { sortKey: '000030' }) }),
      );
      await sendWorkerMessage(
        instance,
        connectionA,
        jsonMessage('annotation-feature:upsert', {
          feature: annotationFeature('path-a', 'day-1', { label: 'First label', updatedBy: 'user-a' }),
        }),
      );
      await sendWorkerMessage(
        instance,
        connectionB,
        jsonMessage('annotation-feature:upsert', {
          feature: annotationFeature('path-a', 'day-1', { label: 'Second label', updatedBy: 'user-b' }),
        }),
      );

      return {
        features: instance._listAnnotationFeatures('day-1'),
        firstAck: sentJson(connectionA, 'annotation-feature:upserted')[0],
        secondAck: sentJson(connectionB, 'annotation-feature:upserted')[0],
      };
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({ id: 'path-a', revision: 2, updatedBy: 'user-b' });
    expect((result.features[0].payload as Record<string, unknown>).label).toBe('Second label');
    expect(result.firstAck.feature).toMatchObject({ id: 'path-a', revision: 1 });
    expect(result.secondAck.feature).toMatchObject({ id: 'path-a', revision: 2, updatedBy: 'user-b' });
  });

  it('does not rewrite identical annotation feature replays', async () => {
    const stub = roomStub('annotation-feature-replay-dedupe');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection('client-a'), { userId: 'user-a' });

      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: annotationLayer('day-1', { sortKey: '000030' }) }),
      );
      const feature = annotationFeature('path-a', 'day-1', { label: 'Same label', updatedBy: 'user-a' });
      await sendWorkerMessage(instance, connection, jsonMessage('annotation-feature:upsert', { feature }));
      await sendWorkerMessage(instance, connection, jsonMessage('annotation-feature:upsert', { feature }));

      return {
        features: instance._listAnnotationFeatures('day-1'),
        upserted: sentJson(connection, 'annotation-feature:upserted'),
      };
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({ id: 'path-a', revision: 1 });
    expect(result.upserted).toHaveLength(2);
    expect(result.upserted[1].feature).toMatchObject({ id: 'path-a', revision: 1 });
  });

  it('reorders mixed file and annotation layers with layer sort keys only', async () => {
    const stub = roomStub('mixed-reorder');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = authorizeConnection(createConnection());
      await storeContent(instance, connection, HASH_A, CONTENT_A);
      await storeContent(instance, connection, HASH_B, CONTENT_B);
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: fileLayer('route-a', HASH_A, { sortKey: '000020' }) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: annotationLayer('notes', { sortKey: '000030' }) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:create', { layer: fileLayer('area-b', HASH_B, { sortKey: '000040' }) }),
      );
      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('layer:reorder', {
          updates: [
            { layerId: 'area-b', sortKey: '000010' },
            { layerId: 'notes', sortKey: '000020' },
            { layerId: 'route-a', sortKey: '000030' },
            { layerId: 'annotation-default', sortKey: '000040' },
          ],
        }),
      );

      return {
        ack: sentJson(connection, 'layer:reordered').at(-1),
        layers: instance._listLayers(),
      };
    });

    const ackLayers = Array.isArray(result.ack?.layers) ? result.ack.layers : [];
    expect(ackLayers.map((layer) => layer.id)).toEqual(['area-b', 'notes', 'route-a', 'annotation-default']);
    expect(result.layers.map((layer) => layer.sortKey)).toEqual(['000010', '000020', '000030', '000040']);
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
        reason: 'unsupported-protocol',
        message: 'Use layer, annotation-feature, and file:content messages.',
      },
      {
        type: 'protocol:error',
        reason: 'unsupported-protocol',
        message: 'Use layer, annotation-feature, and file:content messages.',
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
});
