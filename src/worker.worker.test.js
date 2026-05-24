import { afterEach, describe, expect, it } from 'vitest';
import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { decodeOverlayBinaryMessage, encodeOverlayBinaryMessage } from './overlay-sync.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CONTENT_A = new Uint8Array([1, 2, 3]);
const CONTENT_B = new Uint8Array([4, 5, 6, 7]);

afterEach(async () => {
  await reset();
});

function roomStub(name) {
  return env.MapCollaboration.get(env.MapCollaboration.idFromName(name));
}

function createConnection(id = 'client-a') {
  return {
    id,
    state: null,
    sent: [],
    send(message) {
      this.sent.push(message);
    },
    setState(update) {
      this.state = typeof update === 'function' ? update(this.state) : update;
      return this.state;
    },
  };
}

function jsonMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function sentJson(connection, type) {
  return connection.sent
    .filter((message) => typeof message === 'string')
    .map((message) => JSON.parse(message))
    .filter((message) => message.type === type);
}

function manifest(id, contentHash, extra = {}) {
  return {
    id,
    type: 'geojson',
    name: id,
    visible: true,
    color: '#3b82f6',
    opacity: 0.95,
    lineWidth: 5,
    bounds: [[0, 0], [1, 1]],
    contentHash,
    contentType: 'application/geo+json',
    contentEncoding: 'identity',
    contentByteLength: 3,
    rawByteLength: 20,
    syncVersion: 1,
    persistence: 'ephemeral',
    ...extra,
  };
}

async function storeContent(instance, connection, contentHash = HASH_A, content = CONTENT_A) {
  await instance.onMessage(connection, encodeOverlayBinaryMessage(contentHash, content));
}

async function upsertOverlay(instance, connection, overlayManifest) {
  await instance.onMessage(connection, jsonMessage('overlay:upsert', { manifest: overlayManifest }));
}

function overlayList(instance) {
  return instance._listOverlayManifests();
}

function contentHashes(instance) {
  return instance.sql`
    SELECT content_hash FROM overlay_contents ORDER BY content_hash ASC
  `.map((row) => row.content_hash);
}

function contentCount(instance) {
  return Number(instance.sql`
    SELECT COUNT(*) AS count FROM overlay_contents
  `[0]?.count || 0);
}

describe('MapCollaboration overlay state machine', () => {
  it('stores binary overlay content and acknowledges the content hash', async () => {
    const stub = roomStub('binary-store');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();
      await storeContent(instance, connection);
      return {
        hashes: contentHashes(instance),
        acknowledgements: sentJson(connection, 'overlay:content:stored'),
      };
    });

    expect(result.hashes).toEqual([HASH_A]);
    expect(result.acknowledgements).toEqual([{ type: 'overlay:content:stored', contentHash: HASH_A }]);
  });

  it('stores sanitized overlay manifests only after content exists', async () => {
    const stub = roomStub('upsert-sanitize');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A));
      const needed = sentJson(connection, 'overlay:content:needed');
      connection.sent = [];

      await storeContent(instance, connection);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A, {
        name: '  Imported   Route  ',
        color: 'not-a-color',
        opacity: 10,
        lineWidth: 99,
        contentEncoding: 'brotli',
        pendingOrderIndex: 3,
      }));

      return {
        needed,
        overlays: overlayList(instance),
      };
    });

    expect(result.needed).toEqual([{ type: 'overlay:content:needed', contentHash: HASH_A }]);
    expect(result.overlays).toHaveLength(1);
    expect(result.overlays[0]).toMatchObject({
      id: 'overlay-a',
      type: 'geojson',
      name: 'Imported Route',
      color: '#3b82f6',
      opacity: 1,
      lineWidth: 12,
      contentEncoding: 'identity',
      contentHash: HASH_A,
    });
    expect(result.overlays[0]).not.toHaveProperty('pendingOrderIndex');
  });

  it('ignores malformed binary, JSON, and invalid overlay manifests', async () => {
    const stub = roomStub('invalid-inputs');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await instance.onMessage(connection, new Uint8Array([2, 0]));
      await instance.onMessage(connection, '{not-json');
      await upsertOverlay(instance, connection, manifest('../bad', HASH_A));
      await upsertOverlay(instance, connection, manifest('overlay-a', 'not-a-hash'));
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A, { type: 'kml' }));

      return {
        overlays: overlayList(instance),
        hashes: contentHashes(instance),
        sentCount: connection.sent.length,
      };
    });

    expect(result.overlays).toEqual([]);
    expect(result.hashes).toEqual([]);
    expect(result.sentCount).toBe(0);
  });

  it('returns stored content as a binary frame when requested', async () => {
    const stub = roomStub('content-request');
    const response = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await storeContent(instance, connection);
      connection.sent = [];
      await instance.onMessage(connection, jsonMessage('overlay:content:request', { contentHash: HASH_A }));

      const binary = connection.sent.find((message) => typeof message !== 'string');
      return binary ? Array.from(new Uint8Array(binary)) : null;
    });

    const decoded = decodeOverlayBinaryMessage(new Uint8Array(response));
    expect(decoded.contentHash).toBe(HASH_A);
    expect(decoded.content).toEqual(CONTENT_A);
  });

  it('patches editable manifest fields while preserving identity and content', async () => {
    const stub = roomStub('patch-overlay');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await storeContent(instance, connection);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A));
      await instance.onMessage(connection, jsonMessage('overlay:patch', {
        overlayId: 'overlay-a',
        patch: {
          id: 'wrong-id',
          type: 'gpx',
          contentHash: HASH_B,
          name: '  Patched   Name  ',
          visible: false,
          color: '#ef4444',
          opacity: 0.1,
          lineWidth: 99,
        },
      }));

      return overlayList(instance)[0];
    });

    expect(result).toMatchObject({
      id: 'overlay-a',
      type: 'geojson',
      contentHash: HASH_A,
      name: 'Patched Name',
      visible: false,
      color: '#ef4444',
      opacity: 0.2,
      lineWidth: 12,
    });
  });

  it('reorders overlays by explicit ordered ids', async () => {
    const stub = roomStub('reorder-overlays');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await storeContent(instance, connection, HASH_A, CONTENT_A);
      await storeContent(instance, connection, HASH_B, CONTENT_B);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A, { pendingOrderIndex: 0 }));
      await upsertOverlay(instance, connection, manifest('overlay-b', HASH_B, { pendingOrderIndex: 1 }));

      const before = overlayList(instance).map((overlay) => overlay.id);
      await instance.onMessage(connection, jsonMessage('overlay:reorder', {
        orderedIds: ['overlay-b', 'bad/id', 'overlay-a'],
      }));
      const after = overlayList(instance).map((overlay) => overlay.id);
      return { before, after };
    });

    expect(result.before).toEqual(['overlay-a', 'overlay-b']);
    expect(result.after).toEqual(['overlay-b', 'overlay-a']);
  });

  it('deletes overlays and prunes content only when it is unreferenced', async () => {
    const stub = roomStub('delete-prune');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await storeContent(instance, connection);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A, { pendingOrderIndex: 0 }));
      await upsertOverlay(instance, connection, manifest('overlay-b', HASH_A, { pendingOrderIndex: 1 }));

      await instance.onMessage(connection, jsonMessage('overlay:delete', { overlayId: 'overlay-a' }));
      const afterFirstDelete = { overlays: overlayList(instance), contentCount: contentCount(instance) };

      await instance.onMessage(connection, jsonMessage('overlay:delete', { overlayId: 'overlay-b' }));
      const afterSecondDelete = { overlays: overlayList(instance), contentCount: contentCount(instance) };

      return { afterFirstDelete, afterSecondDelete };
    });

    expect(result.afterFirstDelete.overlays.map((overlay) => overlay.id)).toEqual(['overlay-b']);
    expect(result.afterFirstDelete.contentCount).toBe(1);
    expect(result.afterSecondDelete.overlays).toEqual([]);
    expect(result.afterSecondDelete.contentCount).toBe(0);
  });

  it('replaces existing overlay content and removes the old unreferenced blob', async () => {
    const stub = roomStub('replace-content');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await storeContent(instance, connection, HASH_A, CONTENT_A);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A));
      await storeContent(instance, connection, HASH_B, CONTENT_B);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_B));

      return {
        overlays: overlayList(instance),
        hashes: contentHashes(instance),
      };
    });

    expect(result.overlays).toHaveLength(1);
    expect(result.overlays[0].contentHash).toBe(HASH_B);
    expect(result.hashes).toEqual([HASH_B]);
  });

  it('prunes old orphaned content on the next overlay mutation', async () => {
    const stub = roomStub('old-orphans');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();

      await storeContent(instance, connection, HASH_A, CONTENT_A);
      instance.sql`
        UPDATE overlay_contents
        SET created_at = ${Date.now() - (2 * 60 * 60 * 1000)}
        WHERE content_hash = ${HASH_A}
      `;
      await storeContent(instance, connection, HASH_B, CONTENT_B);
      await upsertOverlay(instance, connection, manifest('overlay-b', HASH_B));

      return contentHashes(instance);
    });

    expect(result).toEqual([HASH_B]);
  });

  it('sends presence and overlay initialization on connect', async () => {
    const stub = roomStub('connect-init');
    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const seedConnection = createConnection('seed-client');
      await storeContent(instance, seedConnection);
      await upsertOverlay(instance, seedConnection, manifest('overlay-a', HASH_A));

      const connection = createConnection('joining-client');
      await instance.onConnect(connection, {
        request: new Request('https://example.com/parties/map-collaboration/connect-init?name=Alice&color=%23ef4444&userId=user-a'),
      });

      return {
        state: connection.state,
        presence: sentJson(connection, 'presence:init')[0],
        overlay: sentJson(connection, 'overlay:init')[0],
      };
    });

    expect(result.state.user).toEqual({ id: 'user-a', name: 'Alice', color: '#ef4444' });
    expect(result.presence).toMatchObject({
      type: 'presence:init',
      id: 'joining-client',
      room: 'connect-init',
      peers: [],
    });
    expect(result.overlay.overlays.map((overlay) => overlay.id)).toEqual(['overlay-a']);
  });
});

describe('MapCollaboration room lifecycle', () => {
  it('clears expired ephemeral room storage when the alarm runs', async () => {
    const stub = roomStub('expired-room');

    await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();
      await storeContent(instance, connection);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A));
      instance.sql`
        UPDATE room_meta
        SET expires_at = ${Date.now() - 1}
        WHERE room_id = ${'expired-room'}
      `;
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);

    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      return {
        overlays: overlayList(instance),
        hashes: contentHashes(instance),
        rooms: instance.sql`SELECT room_id FROM room_meta`,
      };
    });

    expect(result.overlays).toEqual([]);
    expect(result.hashes).toEqual([]);
    expect(result.rooms).toEqual([]);
  });

  it('keeps persistent room storage when the alarm runs', async () => {
    const stub = roomStub('persistent-room');

    await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      const connection = createConnection();
      await storeContent(instance, connection);
      await upsertOverlay(instance, connection, manifest('overlay-a', HASH_A));
      instance.sql`
        UPDATE room_meta
        SET persistence = ${'persistent'}, expires_at = ${Date.now() - 1}
        WHERE room_id = ${'persistent-room'}
      `;
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);

    const result = await runInDurableObject(stub, async (instance) => {
      await instance.onStart();
      return {
        overlays: overlayList(instance),
        hashes: contentHashes(instance),
        rooms: instance.sql`SELECT room_id, persistence FROM room_meta`,
      };
    });

    expect(result.overlays.map((overlay) => overlay.id)).toEqual(['overlay-a']);
    expect(result.hashes).toEqual([HASH_A]);
    expect(result.rooms).toEqual([{ room_id: 'persistent-room', persistence: 'persistent' }]);
  });
});
