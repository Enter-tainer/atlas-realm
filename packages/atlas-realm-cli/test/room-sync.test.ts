import { afterEach, expect, it, vi } from 'vitest';
import { RoomClient } from '../src/room-client.js';
import { createConfig } from '../src/config.js';
const clients: RoomClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.sync.dispose();
});
const layer = (name = 'Notes', version = 1) => ({
  id: 'notes',
  kind: 'annotation',
  name,
  visible: true,
  sortKey: '000010',
  revision: version,
  fieldVersions: { name: version, visible: 1 },
  payload: { version: 1 },
});
async function client() {
  const sent: any[] = [];
  const client = new RoomClient(createConfig({ host: 'http://localhost:4178', room: 'test', clientId: 'test-agent' }), {
    WebSocketImpl: { OPEN: 1 } as never,
  });
  client.socket = { readyState: 1, send: (message: string) => sent.push(JSON.parse(message)) } as never;
  clients.push(client);
  client.sync.connect(true);
  await client.handleMessage(
    JSON.stringify({
      type: 'sync:snapshot',
      protocol: 2,
      epoch: 'test',
      commitVersion: 1,
      clientId: 'stream',
      lastProcessedSeq: 0,
      lastResult: null,
      layers: [layer()],
      features: [],
    }),
  );
  return { client, sent, submissions: () => sent.filter((m) => m.type === 'sync:submit') };
}
// A client whose connect() wait is still pending: no snapshot delivered yet,
// exactly like RoomClient.connect() waiting on presence:init + sync:snapshot.
async function connectingClient() {
  const sent: any[] = [];
  const client = new RoomClient(createConfig({ host: 'http://localhost:4178', room: 'test', clientId: 'test-agent' }), {
    WebSocketImpl: { OPEN: 1 } as never,
  });
  client.socket = { readyState: 1, send: (message: string) => sent.push(JSON.parse(message)) } as never;
  clients.push(client);
  client.sync.connect(true);
  return { client, sent };
}
it('correlates results to the submitted batch and reports conflicts rather than another agent success', async () => {
  const h = await client();
  h.client.sendJson({ type: 'layer:update', layerId: 'notes', patch: { name: 'Mine' } });
  const wait = h.client.waitFor((event) => event.json?.type === 'layer:updated', 'rename');
  const assertion = expect(wait).rejects.toThrow('revision-conflict');
  await vi.waitFor(() => expect(h.submissions()).toHaveLength(1));
  await h.client.handleMessage(
    JSON.stringify({
      type: 'sync:commit',
      epoch: 'test',
      commitVersion: 2,
      delta: { layers: [layer('Other', 2)], features: [], deletedLayers: [], deletedFeatures: [] },
    }),
  );
  await h.client.handleMessage(
    JSON.stringify({
      type: 'sync:result',
      epoch: 'test',
      clientId: 'stream',
      result: {
        seq: 1,
        status: 'rejected',
        reason: 'revision-conflict',
        commandIndex: 0,
        commitVersion: 2,
        ids: {},
        versions: {},
      },
    }),
  );
  await assertion;
  expect(h.client.layers[0].name).toBe('Other');
});
it('recovers a lost acknowledgement from one compact result without replay', async () => {
  const h = await client();
  h.client.sendJson({ type: 'layer:update', layerId: 'notes', patch: { name: 'Mine' } });
  const wait = h.client.waitFor((event) => event.json?.type === 'layer:updated', 'rename');
  await vi.waitFor(() => expect(h.submissions()).toHaveLength(1));
  h.client.sync.requestSnapshot(true);
  await h.client.handleMessage(
    JSON.stringify({
      type: 'sync:snapshot',
      protocol: 2,
      epoch: 'test',
      clientId: 'stream',
      commitVersion: 2,
      lastProcessedSeq: 1,
      lastResult: { seq: 1, status: 'accepted', commitVersion: 2, ids: {}, versions: { 'layer:notes': { name: 2 } } },
      layers: [layer('Mine', 2)],
      features: [],
    }),
  );
  expect((await wait).json?.layer.name).toBe('Mine');
  expect(h.submissions()).toHaveLength(1);
});
it('fails the pending snapshot wait immediately when the server rejects sync with a fatal error', async () => {
  const h = await connectingClient();
  await h.client.handleMessage(JSON.stringify({ type: 'presence:init', peers: [] }));
  const wait = h.client.waitFor((event) => event.json?.type === 'sync:snapshot', 'sync:snapshot');
  await h.client.handleMessage(JSON.stringify({ type: 'sync:error', reason: 'client_limit', limit: 'owned-clients' }));
  await expect(wait).rejects.toThrow(/client_limit/);
  await expect(wait).rejects.toThrow(/owned-clients/);
});
it('fails a snapshot wait registered after a fatal sync error instead of scanning past it', async () => {
  const h = await connectingClient();
  await h.client.handleMessage(
    JSON.stringify({ type: 'sync:error', reason: 'client_limit', limit: 'recent-registrations-per-minute' }),
  );
  await expect(h.client.waitFor((event) => event.json?.type === 'sync:snapshot', 'sync:snapshot')).rejects.toThrow(
    /recent-registrations-per-minute/,
  );
});
it('still waits through recoverable sync errors such as client_expired', async () => {
  const h = await connectingClient();
  const wait = h.client.waitFor((event) => event.json?.type === 'sync:snapshot', 'sync:snapshot');
  await h.client.handleMessage(JSON.stringify({ type: 'sync:error', reason: 'client_expired' }));
  // The client re-registers without a clientId and the retry snapshot resolves the wait.
  await vi.waitFor(() => expect(h.sent.filter((m) => m.type === 'sync:open' && !m.clientId)).toHaveLength(2));
  await h.client.handleMessage(
    JSON.stringify({
      type: 'sync:snapshot',
      protocol: 2,
      epoch: 'test',
      clientId: 'fresh-stream',
      commitVersion: 1,
      lastProcessedSeq: 0,
      lastResult: null,
      layers: [layer()],
      features: [],
    }),
  );
  expect((await wait).json?.clientId).toBe('fresh-stream');
});
it('reports which room messages were received when a wait times out', async () => {
  const h = await connectingClient();
  const wait = h.client.waitFor((event) => event.json?.type === 'sync:snapshot', 'sync:snapshot', 50);
  await h.client.handleMessage(JSON.stringify({ type: 'presence:init', peers: [] }));
  await h.client.handleMessage(JSON.stringify({ type: 'presence:update', peer: { id: 'p1' } }));
  await h.client.handleMessage(JSON.stringify({ type: 'presence:update', peer: { id: 'p1', lngLat: [1, 2] } }));
  // A recoverable error retried in the background is still visible in the
  // histogram with its reason, so a timeout after recovery attempts can be
  // distinguished from a room that went silent.
  await h.client.handleMessage(JSON.stringify({ type: 'sync:error', reason: 'client_expired' }));
  await expect(wait).rejects.toThrow(/presence:update x2/);
  await expect(wait).rejects.toThrow(/presence:init x1/);
  await expect(wait).rejects.toThrow(/sync:error\(client_expired\) x1/);
});
