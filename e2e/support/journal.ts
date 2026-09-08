import { expect, type Page } from '@playwright/test';

/**
 * Wait until the room journal in IndexedDB holds a pending draft matching
 * `needle`. Drafts are persisted asynchronously, so a test that closes or
 * reloads a tab right after an offline edit races the write: the browser tears
 * the page down and the draft is lost before the recovery path ever runs.
 * Waiting for durability here keeps the closed-tab/reload coverage testing
 * recovery instead of write timing.
 */
export async function waitForJournalDraft(page: Page, needle: string, timeout = 20_000) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(async (value) => {
            // Only look at an existing database: opening it here would create an
            // empty version-1 database and break the app's own upgrade path.
            const databases = await indexedDB.databases?.();
            if (!databases || !databases.some((entry) => entry.name === 'atlas-sync')) return false;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open('atlas-sync');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const journals = await new Promise<Array<{ pending?: unknown }>>((resolve, reject) => {
                const request = db.transaction('journals').objectStore('journals').getAll();
                request.onsuccess = () => resolve(request.result as Array<{ pending?: unknown }>);
                request.onerror = () => reject(request.error);
              });
              return journals.some((journal) => JSON.stringify(journal?.pending ?? []).includes(value));
            } finally {
              db.close();
            }
          }, needle);
        } catch {
          // The page may be mid-navigation; retry until the poll times out.
          return false;
        }
      },
      { timeout },
    )
    .toBe(true);
}
