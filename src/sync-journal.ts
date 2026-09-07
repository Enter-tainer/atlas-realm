import type { SyncJournal } from './room-sync-client.js';
const DB_NAME = 'atlas-sync';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('journals');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
// A journal has one exclusive writer. Other tabs get independent streams; closed-tab drafts can be recovered.
export class SyncJournalStorage {
  key = '';
  private release?: () => void;
  private db?: IDBDatabase;
  private closed = false;
  constructor(private scope: string) {}
  async load(): Promise<SyncJournal | undefined> {
    this.db = await database();
    const keys: IDBValidKey[] = await new Promise((resolve, reject) => {
      const request = this.db!.transaction('journals').objectStore('journals').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values: SyncJournal[] = await new Promise((resolve, reject) => {
      const request = this.db!.transaction('journals').objectStore('journals').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const hasDraft = new Set(
      keys.filter((_, index) => values[index]?.pending?.length || values[index]?.conflicts?.length),
    );
    if (this.closed) {
      this.db.close();
      throw new Error('Journal closed');
    }
    const preferred = sessionStorage.getItem(`atlas-journal:${this.scope}`);
    const candidates = [
      ...new Set(
        [preferred, ...keys.filter((key) => typeof key === 'string' && key.startsWith(`${this.scope}:`))].filter(
          Boolean,
        ),
      ),
    ] as string[];
    candidates.sort(
      (a, b) => Number(hasDraft.has(b)) - Number(hasDraft.has(a)) || Number(b === preferred) - Number(a === preferred),
    );
    for (const key of [...candidates, `${this.scope}:${crypto.randomUUID()}`]) {
      if (navigator.locks) {
        const claimed = await new Promise<boolean>((resolve) => {
          void navigator.locks.request(`atlas-journal:${key}`, { ifAvailable: true }, async (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            await new Promise<void>((release) => {
              this.release = release;
              resolve(true);
            });
          });
        });
        if (!claimed) continue;
      } else if (candidates.includes(key)) continue;
      if (this.closed) {
        this.release?.();
        this.db.close();
        throw new Error('Journal closed');
      }
      this.key = key;
      sessionStorage.setItem(`atlas-journal:${this.scope}`, key);
      break;
    }
    return new Promise((resolve, reject) => {
      const request = this.db!.transaction('journals').objectStore('journals').get(this.key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async save(journal: SyncJournal) {
    if (!this.db || !this.key) throw new Error('Journal is not ready');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('journals', 'readwrite');
      tx.objectStore('journals').put(journal, this.key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  close() {
    this.closed = true;
    this.release?.();
    this.db?.close();
  }
}
