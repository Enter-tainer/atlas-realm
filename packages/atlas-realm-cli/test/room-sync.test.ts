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
