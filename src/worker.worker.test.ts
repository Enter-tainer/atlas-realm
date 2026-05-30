import { afterEach, describe, expect, it } from 'vitest';
import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { MapCollaboration } from './worker.js';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';

type TestMessage = string | Uint8Array | ArrayBuffer;
type TestSqlValue = string | number | boolean | null | ArrayBuffer;
type TestSqlRow = Record<string, TestSqlValue>;
type TestConnectionState = Record<string, unknown> | null;

interface TestConnection {
  id: string;
  state: TestConnectionState;
  sent: TestMessage[];
  send(message: TestMessage): void;
  setState(update: TestConnectionState | ((previous: TestConnectionState) => TestConnectionState)): TestConnectionState;
}

type TestMapCollaboration = MapCollaboration & {
  _listLayers(): Array<Record<string, unknown>>;
  _listAnnotationFeatures(layerId?: string): Array<Record<string, unknown>>;
  sql<T extends TestSqlRow = TestSqlRow>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
};
type WorkerConnection = Parameters<MapCollaboration['onMessage']>[0];

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CONTENT_A = new Uint8Array([1, 2, 3]);
const CONTENT_B = new Uint8Array([4, 5, 6, 7]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

afterEach(async () => {
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
    setState(update: TestConnectionState | ((previous: TestConnectionState) => TestConnectionState)) {
      this.state = typeof update === 'function' ? update(this.state) : update;
      return this.state;
    },
  };
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
      const connection = createConnection('alice');
      await connectWorker(instance, connection, {
        request: new Request('https://example.com/parties/map-collaboration/connect-snapshot?name=Alice'),
      } as ConnectionContext);
      return sentJson(connection).map((message) => message.type);
    });

    expect(result).toContain('presence:init');
    expect(result).toContain('layer:list');
    expect(result).toContain('annotation-feature:list');
    expect(result).not.toContain('overlay:init');
    expect(result).not.toContain('drawing:snapshot');
  });

  it('stores file content, creates file layers, serves content requests, and prunes unreferenced content', async () => {
    const stub = roomStub('file-layer-flow');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

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

  it('stores annotation features as rows and rejects features for missing layers', async () => {
    const stub = roomStub('annotation-feature-flow');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await sendWorkerMessage(
        instance,
        connection,
        jsonMessage('annotation-feature:upsert', { feature: annotationFeature('missing-feature', 'missing-layer') }),
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
        rejected: sentJson(connection, 'annotation-feature:rejected')[0],
        upserted: sentJson(connection, 'annotation-feature:upserted')[0],
        reordered: sentJson(connection, 'annotation-feature:reordered')[0],
        beforeDelete,
        afterDelete: instance._listAnnotationFeatures('day-1'),
      };
    });

    expect(result.rejected).toEqual({
      type: 'annotation-feature:rejected',
      featureId: 'missing-feature',
      reason: 'missing-layer',
    });
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
      const connectionA = createConnection('client-a');
      const connectionB = createConnection('client-b');

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
      const connectionA = createConnection('client-a');
      const connectionB = createConnection('client-b');

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

  it('reorders mixed file and annotation layers with layer sort keys only', async () => {
    const stub = roomStub('mixed-reorder');
    const result = await runInDO(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();
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
      const connection = createConnection();
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
        request: new Request('https://example.com/parties/map-collaboration/alarm-cleanup?name=Alice'),
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
