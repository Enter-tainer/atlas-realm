import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentRoomConfig } from './types.js';
import type { SyncJournal } from './sync-client.js';

export class CliSyncJournal {
  readonly path: string;
  private readonly directory: string;
  private locked = false;
  constructor(
    config: AgentRoomConfig,
    directory = process.env.ATLAS_REALM_STATE_DIR ||
      join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'atlas-realm'),
  ) {
    this.directory = directory;
    const key = createHash('sha256')
      .update(JSON.stringify([config.host, config.room, config.clientId, config.accessToken]))
      .digest('hex');
    this.path = join(directory, `${key}.json`);
  }
  async load(): Promise<SyncJournal | undefined> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const lock = await open(lockPath, 'wx', 0o600);
        try {
          await lock.writeFile(String(process.pid));
        } finally {
          await lock.close();
        }
        this.locked = true;
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        const pid = Number(await readFile(lockPath, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid journal lock: ${lockPath}`);
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as { code?: string }).code === 'ESRCH') {
            await unlink(lockPath).catch(() => {});
            continue;
          }
          throw error;
        }
        throw new Error('This client ID is already in use. Parallel agents must use distinct --client-id values.');
      }
    }
    if (!this.locked) throw new Error('Could not acquire the client journal lock. Retry the command.');
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      value.files = Object.fromEntries(
        Object.entries(value.files || {}).map(([hash, bytes]) => [
          hash,
          new Blob([Buffer.from(String(bytes), 'base64')]),
        ]),
      );
      return value;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async save(journal: SyncJournal) {
    if (!this.locked) throw new Error('Journal is not locked');
    const files: Record<string, string> = {};
    for (const [hash, blob] of Object.entries(journal.files))
      files[hash] = Buffer.from(await blob.arrayBuffer()).toString('base64');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ ...journal, files }));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async close() {
    if (this.locked) {
      this.locked = false;
      await unlink(`${this.path}.lock`).catch(() => {});
    }
  }
}
