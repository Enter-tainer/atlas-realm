import { afterEach, describe, expect, it } from 'vitest';
import { RoomSyncClient } from './room-sync-client.js';
import { createDefaultAnnotationLayer } from './layer-model.js';
import type { RoomSnapshot, RoomOperation, BatchResult } from './room-sync-protocol.js';
const clients: RoomSyncClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});
const layer = (name = 'Notes', version = 1) => ({
  ...createDefaultAnnotationLayer(),
  id: 'notes',
  name,
  fieldVersions: { name: version, visible: 1, position: 1 },
});
const snapshot = (extra: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  type: 'sync:snapshot',
  protocol: 2,
  epoch: 'epoch',
  commitVersion: 1,
  clientId: 'client',
  lastProcessedSeq: 0,
  lastResult: null,
  layers: [layer()],
  features: [],
  ...extra,
});
async function harness(journal?: ReturnType<RoomSyncClient['journal']>) {
  const sent: any[] = [];
  const saved: any[] = [];
  const client = new RoomSyncClient({
    journal,
    send: (m) => {
      sent.push(structuredClone(m));
      return true;
    },
    publish: () => {},
    save: (journal) => {
      saved.push(structuredClone(journal));
    },
    batchDelay: 1000,
  });
  clients.push(client);
  await client.loaded;
  client.connect(true);
  await client.receive(snapshot());
  return { client, sent, saved, submissions: () => sent.filter((m) => m.type === 'sync:submit') as RoomOperation[] };
}
const accepted = (seq = 1): BatchResult => ({
  seq,
  status: 'accepted',
  commitVersion: 2,
  ids: {},
  versions: { 'layer:notes': { name: 2 } },
});
describe('bounded stream synchronization', () => {
  it('never infers writes from cached state or an absent layer in a snapshot', async () => {
    const h = await harness();
    await h.client.receive(snapshot({ layers: [], commitVersion: 2 }));
    await h.client.flush();
    expect(h.submissions()).toEqual([]);
    expect(h.client.view.getLayers()).toEqual([]);
  });
  it('saves an offline draft and resumes the same frozen batch after reload', async () => {
    const h = await harness();
    h.client.disconnect();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'Offline' } });
    expect(h.submissions()).toEqual([]);
    h.client.connect(true);
    await h.client.receive(snapshot());
    await h.client.flush();
    const operation = h.submissions()[0];
    const restored = await harness(structuredClone(h.client.journal()));
    await restored.client.flush();
    expect(restored.submissions()[0]).toEqual(operation);
    expect(operation.commands[0]).toMatchObject({
      type: 'patch',
      fields: { name: { expectedVersion: 1, value: 'Offline' } },
    });
  });
  it('uses the last compact result to resolve a lost acknowledgement without replay', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'Saved' } });
    await h.client.flush();
    h.client.disconnect();
    h.client.connect(true);
    await h.client.receive(
      snapshot({ commitVersion: 2, lastProcessedSeq: 1, lastResult: accepted(), layers: [layer('Saved', 2)] }),
    );
    await h.client.flush();
    expect(h.submissions()).toHaveLength(1);
    expect(h.client.pending).toEqual([]);
  });
  it('coalesces unsent edits while retaining their original field baseline', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'A' } });
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'B' } });
    await h.client.flush();
    expect(h.submissions()[0].commands).toHaveLength(1);
    expect(h.submissions()[0].commands[0]).toMatchObject({ fields: { name: { expectedVersion: 1, value: 'B' } } });
  });
  it('keeps later in-flight-dependent edits and uses actual acknowledged field versions', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'First' } });
    await h.client.flush();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'Second' } });
    await h.client.receive({
      type: 'sync:result',
      epoch: 'epoch',
      clientId: 'client',
      result: accepted(),
      delta: { layers: [layer('First', 2)], features: [], deletedLayers: [], deletedFeatures: [] },
    });
    await h.client.flush();
    expect(h.client.view.getLayer('notes')?.name).toBe('Second');
    expect(h.submissions()[1].commands[0]).toMatchObject({ fields: { name: { expectedVersion: 2 } } });
  });
  it('preserves rejected and dependent drafts but continues independent fields', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'First' } });
    await h.client.flush();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'Second' } });
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { visible: false } });
    await h.client.receive({
      type: 'sync:result',
      epoch: 'epoch',
      clientId: 'client',
      result: { ...accepted(), status: 'rejected', reason: 'revision-conflict', commitVersion: 1, commandIndex: 0 },
    });
    await h.client.flush();
    expect(h.client.conflicts).toHaveLength(2);
    expect(h.submissions()[1].commands[0]).toMatchObject({ fields: { visible: { value: false, expectedVersion: 1 } } });
  });
  it('does not infer success from a rejected batch recovered in a snapshot', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:update', layerId: 'notes', patch: { name: 'Lost' } });
    await h.client.flush();
    await h.client.receive(
      snapshot({
        lastProcessedSeq: 1,
        lastResult: { ...accepted(), status: 'rejected', reason: 'target_missing', commandIndex: 0, commitVersion: 1 },
        layers: [],
      }),
    );
    expect(h.client.conflicts[0].reason).toBe('target_missing');
    expect(h.client.view.getLayers()).toEqual([]);
  });
  it('does not republish unknown creations after stream expiry', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:create', layer: { ...layer(), id: 'draft' } });
    await h.client.flush();
    await h.client.receive({ type: 'sync:error', reason: 'client_expired' });
    await h.client.receive(snapshot({ clientId: 'new-client', layers: [] }));
    await h.client.flush();
    expect(h.submissions()).toHaveLength(1);
    expect(h.client.conflicts[0].reason).toBe('result_unknown');
  });
  it('remaps IDs on acknowledgement, including references in subsequent child drafts', async () => {
    const h = await harness();
    await h.client.enqueue({ type: 'layer:create', layer: { ...layer(), id: 'draft' } });
    await h.client.flush();
    await h.client.enqueue({ type: 'layer:update', layerId: 'draft', patch: { name: 'Renamed' } });
    const row = { ...layer('New', 2), id: 'real' };
    await h.client.receive({
      type: 'sync:result',
      epoch: 'epoch',
      clientId: 'client',
      result: { ...accepted(), ids: { draft: 'real' }, versions: { 'layer:real': { name: 2 } } },
      delta: { layers: [row], features: [], deletedLayers: [], deletedFeatures: [] },
    });
    await h.client.flush();
    expect(h.submissions()[1].commands[0]).toMatchObject({
      id: 'real',
      fields: { name: { expectedVersion: 2, value: 'Renamed' } },
    });
  });
  it('detects gaps and ignores old commits', async () => {
    const h = await harness();
    await h.client.receive({
      type: 'sync:commit',
      epoch: 'epoch',
      commitVersion: 3,
      delta: { layers: [], features: [], deletedLayers: ['notes'], deletedFeatures: [] },
    });
    expect(h.client.ready).toBe(false);
    await h.client.receive(snapshot({ commitVersion: 3, layers: [] }));
    await h.client.receive({
      type: 'sync:commit',
      epoch: 'epoch',
      commitVersion: 2,
      delta: { layers: [layer()], features: [], deletedLayers: [], deletedFeatures: [] },
    });
    expect(h.client.view.getLayers()).toEqual([]);
  });
  it('uploads a large geometry before sending its small immutable batch reference', async () => {
    const h = await harness();
    const points = Array.from({ length: 16000 }, (_, i) => [100 + i / 100000, 30 + i / 100000]);
    await h.client.enqueue({
      commands: [
        {
          type: 'create',
          kind: 'feature',
          localId: 'large',
          data: {
            id: 'large',
            layerId: 'notes',
            featureType: 'path',
            sortKey: '000010',
            payload: { type: 'path', points, label: 'Large', note: '' },
          },
        },
      ],
    });
    await h.client.flush();
    expect(h.submissions()).toHaveLength(0);
    const command = h.client.inFlight!.operation.commands[0];
    expect(command.type).toBe('create');
    if (command.type !== 'create') throw new Error('Expected create');
    const hash = command.data.payload.$content;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.client.files[hash]).toBeInstanceOf(Blob);
    h.client.contentStored(hash);
    await h.client.flush();
    expect(h.submissions()).toHaveLength(1);
    expect(JSON.stringify(h.submissions()[0]).length).toBeLessThan(2000);
  });
});
