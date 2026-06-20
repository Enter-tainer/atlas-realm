import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch } from './support/map-fixture';
import { openRealRoom, uniqueRoomName } from './support/real-collaboration';

test.describe('collaboration background disconnect', () => {
  test('disconnects after 30s hidden, reconnects when visible', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-bg', testInfo.title);

    const ctxA = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const ctxB = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errorsA = await installBrowserErrorWatch(pageA);
    const errorsB = await installBrowserErrorWatch(pageB);

    try {
      // Both devices join the same room.
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);

      // Both are live.
      await expect(pageA.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
      await expect(pageB.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');

      // Each sees the other.
      await expect(pageA.locator('.collab-presence-summary')).toContainText('1 other');
      await expect(pageB.locator('.collab-presence-summary')).toContainText('1 other');

      // Page A goes to background.
      await pageA.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // After 30s, page A should disconnect itself.
      await pageA.waitForTimeout(32_000);

      // Page A panel shows idle/offline (closed by background timer).
      await expect(pageA.locator('.collab-panel')).not.toHaveAttribute('data-connection', 'live');

      // Page B eventually notices page A left via presence:leave.
      await expect(pageB.locator('.collab-presence-summary')).toContainText('No one else');

      // Page A comes back to foreground.
      await pageA.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Page A reconnects within a reasonable window.
      await expect(pageA.locator('.collab-panel')).toHaveAttribute('data-connection', 'live', { timeout: 15_000 });

      // Both see each other again.
      await expect(pageA.locator('.collab-presence-summary')).toContainText('1 other');
      await expect(pageB.locator('.collab-presence-summary')).toContainText('1 other');

      // No unexpected errors.
      errorsA.assertNoErrors();
      errorsB.assertNoErrors();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('cancels background timer if tab returns within 30s', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-bg-cancel', testInfo.title);

    const ctx = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const page = await ctx.newPage();
    const errors = await installBrowserErrorWatch(page);

    try {
      await openRealRoom(page, room);
      await expect(page.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');

      // Tab goes to background briefly (10s).
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(10_000);

      // Returns before the 30s cutoff.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Still connected - the timer was cancelled.
      await expect(page.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
      errors.assertNoErrors();
    } finally {
      await ctx.close();
    }
  });
});
