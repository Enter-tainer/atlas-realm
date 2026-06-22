import { expect, test, type Page } from '@playwright/test';
import { installBrowserErrorWatch } from './support/map-fixture';
import {
  clickMap,
  createAnnotationLayerFromUi,
  expectFeatureLabel,
  expectFeatureMissing,
  expectLayerMissing,
  expectLayerVisible,
  openAnnotationEditorFromCanvas,
  openAnnotationsForLayer,
  selectLayer,
} from './support/map-interactions';
import { createAgentProtocolClient, openRealRoom, uniqueRoomName } from './support/real-collaboration';

test.describe('real multi-device collaboration sync', () => {
  test('syncs annotation layer CRUD, feature CRUD, and survives refresh through the real worker', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoomName('e2e-sync', testInfo.title);
    const deviceA = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const deviceB = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });

    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();
    const errorsA = await installBrowserErrorWatch(pageA);
    const errorsB = await installBrowserErrorWatch(pageB);

    try {
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);
      await expect(pageB.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');

      await createAnnotationLayerFromUi(pageA, 'Shared field notes');
      await expectLayerVisible(pageB, 'Shared field notes');

      await upsertFeatureFromDevice(pageA, {
        layerName: 'Shared field notes',
        label: 'Signal inspection point',
        note: 'Created on device A',
      });
      await expectFeatureLabel(pageB, 'Signal inspection point');
      await openAnnotationEditorFromCanvas(pageB, 'Signal inspection point');

      await upsertFeatureFromDevice(pageA, {
        layerName: 'Shared field notes',
        label: 'Signal inspection point updated',
        note: 'Edited on device A',
      });
      await expectFeatureLabel(pageB, 'Signal inspection point updated');
      await expectFeatureMissing(pageB, 'Signal inspection point');
      await openAnnotationEditorFromCanvas(pageB, 'Signal inspection point updated');

      await deleteFeatureFromDevice(pageA);
      await expectFeatureMissing(pageB, 'Signal inspection point updated');

      await upsertFeatureFromDevice(pageA, {
        layerName: 'Shared field notes',
        label: 'Refresh persistence marker',
        note: 'Must survive a fresh connection',
      });
      await expectFeatureLabel(pageB, 'Refresh persistence marker');

      await pageB.reload();
      await expect(pageB.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
      await expectLayerVisible(pageB, 'Shared field notes');
      await expectFeatureLabel(pageB, 'Refresh persistence marker');
      await openAnnotationEditorFromCanvas(pageB, 'Refresh persistence marker');

      await renameSelectedLayerFromUi(pageA, 'Shared field notes', 'Shared field notes renamed');
      await expectLayerVisible(pageB, 'Shared field notes renamed');

      await createAnnotationLayerFromUi(pageA, 'Follow-up notes');
      await expectLayerVisible(pageB, 'Follow-up notes');

      await deleteLayerFromUi(pageA, 'Shared field notes renamed');
      await expectLayerMissing(pageB, 'Shared field notes renamed');
      await expectLayerVisible(pageB, 'Follow-up notes');
      await expectFeatureMissing(pageB, 'Refresh persistence marker');

      errorsA.assertNoErrors();
      errorsB.assertNoErrors();
    } finally {
      await deviceA.close();
      await deviceB.close();
    }
  });

  test('shows an agent as online after an agent edit activity update', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-agent-presence', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const page = await context.newPage();
    const errors = await installBrowserErrorWatch(page);

    try {
      await openRealRoom(page, room);
      const agent = await createAgentProtocolClient(page, room, {
        clientId: 'agent-presence-writer',
        name: 'Planner',
      });
      await agent.send({ type: 'client:update', action: 'annotations add' });
      await agent.waitFor(
        'agent:participant:update',
        (message) =>
          (message.agent as Record<string, unknown> | undefined)?.id === 'agent-presence-writer' &&
          (message.agent as Record<string, unknown> | undefined)?.lastAction === 'annotations add',
      );

      await expect(page.locator('.collab-compact-meta')).toContainText('1 agent active');
      await expect(page.locator('.collab-compact-avatar.collab-agent-avatar')).toHaveCount(1);

      await page.locator('.collab-compact-toggle').click();
      await expect(page.locator('.collab-presence-summary')).toContainText('1 agent active');
      await expect(page.locator('.collab-avatars')).toHaveAttribute('aria-label', /1 agent/);
      await expect(page.locator('.collab-avatar.collab-agent-avatar')).toHaveAttribute(
        'aria-label',
        /Planner, agent active/,
      );

      errors.assertNoErrors();
      await agent.close();
    } finally {
      await context.close();
    }
  });
});

async function renameSelectedLayerFromUi(page: Page, currentName: string, nextName: string) {
  await selectLayer(page, currentName);
  const nameInput = page.locator('.layer-manager-name-input');
  await expect(nameInput).toBeEnabled();
  await nameInput.fill(nextName);
  await expect(page.locator('.layer-manager-item-name', { hasText: nextName })).toBeVisible();
}

async function deleteLayerFromUi(page: Page, name: string) {
  const panel = await selectLayer(page, name);
  await panel.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.layer-manager-item-name', { hasText: name })).toHaveCount(0);
}

async function upsertFeatureFromDevice(
  page: Page,
  {
    layerName,
    label,
    note,
  }: {
    layerName: string;
    label: string;
    note: string;
  },
) {
  await openAnnotationsForLayer(page, layerName);
  const editor = page.locator('.annotation-editor');
  if ((await editor.count()) === 0) {
    await page.getByRole('button', { name: 'Marker' }).click();
    await clickMap(page);
    await expect(editor).toBeVisible();
  }
  await editor.locator('input.annotation-input').fill(label);
  await editor.locator('textarea.annotation-note').fill(note);
  await expectFeatureLabel(page, label);
}

async function deleteFeatureFromDevice(page: Page) {
  await expect(page.locator('.annotation-editor')).toBeVisible();
  await page.locator('.annotation-editor .annotation-danger').click();
  await expect(page.locator('.annotation-editor')).toHaveCount(0);
}
