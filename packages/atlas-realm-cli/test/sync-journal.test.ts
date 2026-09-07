import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CliSyncJournal } from '../src/sync-journal.js';
import { createConfig } from '../src/config.js';
import type { SyncJournal } from '../src/sync-client.js';
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
it('persists a frozen batch and file bytes and recovers them in a new process session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-journal-'));
  directories.push(dir);
  const config = createConfig({ clientId: 'agent' });
  const first = new CliSyncJournal(config, dir);
  expect(await first.load()).toBeUndefined();
  const journal: SyncJournal = {
    epoch: 'e',
    commitVersion: 3,
    clientId: 'server-client',
    lastProcessedSeq: 2,
    layers: [],
    features: [],
    pending: [],
    conflicts: [],
    aliases: {},
    files: { hash: new Blob(['file content']) },
    inFlight: {
      operation: {
        type: 'sync:submit',
        protocol: 2,
        epoch: 'e',
        clientId: 'server-client',
        seq: 3,
        commands: [{ type: 'delete', kind: 'layer', id: 'old' }],
      },
      entryIds: [],
    },
  };
  await first.save(journal);
  await first.close();
  const second = new CliSyncJournal(config, dir);
  const restored = await second.load();
  expect(restored?.inFlight).toEqual(journal.inFlight);
  expect(await restored?.files.hash.text()).toBe('file content');
  expect(JSON.parse(await readFile(second.path, 'utf8')).clientId).toBe('server-client');
  await second.close();
});
it('refuses concurrent writers using the same client identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-journal-'));
  directories.push(dir);
  const config = createConfig({ clientId: 'agent' });
  const first = new CliSyncJournal(config, dir);
  const second = new CliSyncJournal(config, dir);
  await first.load();
  await expect(second.load()).rejects.toThrow('already in use');
  await first.close();
  expect(await second.load()).toBeUndefined();
  await second.close();
});
