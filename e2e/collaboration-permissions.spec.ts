import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch } from './support/map-fixture';
import { openRealRoom, uniqueRoomName } from './support/real-collaboration';

test.describe('real collaboration permissions', () => {
  test('uses the real room access chain for anonymous guest rooms', async ({ page }, testInfo) => {
    const errors = await installBrowserErrorWatch(page);
    const room = uniqueRoomName('e2e-guest-access', testInfo.title);

    await openRealRoom(page, room);

    const accessResponse = await page.request.get(`/api/rooms/${encodeURIComponent(room)}/access`);
    await expect(accessResponse).toBeOK();
    await expect(accessResponse.json()).resolves.toMatchObject({
      role: 'edit',
      canView: true,
      canEdit: true,
      canManage: false,
      room: {
        roomId: room,
        createdByKind: 'guest',
        persistence: 'ephemeral',
        linkAccess: 'edit',
      },
      user: null,
    });

    await page.getByRole('button', { name: 'Open collaboration controls' }).click();
    const panel = page.locator('.collab-panel');
    await expect(panel).toHaveAttribute('data-role', 'edit');
    await expect(panel.locator('.collab-role-badge')).toHaveText('Edit');
    await expect(page.locator('.collab-room-context-meta')).toHaveText('Temporary guest room');
    await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(page.locator('#map')).toHaveAttribute('data-collaboration-can-edit', 'true');

    const patchResponse = await page.request.patch(`/api/rooms/${encodeURIComponent(room)}`, {
      data: { linkAccess: 'view' },
    });
    expect(patchResponse.status()).toBe(401);

    const grantsResponse = await page.request.get(`/api/rooms/${encodeURIComponent(room)}/grants`);
    expect(grantsResponse.status()).toBe(401);

    errors.assertNoErrors();
  });
});
