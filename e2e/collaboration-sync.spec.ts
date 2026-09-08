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
import { openRealRoom, uniqueRoomName, createProtocolClient } from './support/real-collaboration';

test.describe('real multi-device collaboration sync', () => {
  test.describe.configure({ timeout: 120_000 });
  test('preserves offline drafts as conflicts after another device deletes the layer', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoomName('e2e-offline-delete', testInfo.title);
    const a = await browser.newContext({ locale: 'en-US' });
    const b = await browser.newContext({ locale: 'en-US' });
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    try {
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);
      await createAnnotationLayerFromUi(pageA, 'Offline original');
      await expectLayerVisible(pageB, 'Offline original');
      await selectLayer(pageA, 'Offline original');
      await a.setOffline(true);
      await expect(pageA.locator('.collab-panel')).toHaveAttribute('data-connection', 'offline');
      await pageA.locator('.layer-manager-name-input').fill('My offline draft');
      await expect(pageA.locator('.layer-manager-name-input')).toHaveValue('My offline draft');
      await deleteLayerFromUi(pageB, 'Offline original');
      await a.setOffline(false);
      await pageA.reload();
      await expect(pageA.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
      await expectLayerMissing(pageA, 'Offline original');
      await expectLayerMissing(pageA, 'My offline draft');
      await expectLayerMissing(pageB, 'My offline draft');
      const notice = pageA.locator('.collab-sync-notice');
      await expect(notice).toBeVisible();
      await notice.locator('summary').click();
      await expect(notice).toContainText('This item was deleted on another device.');
      const downloadEvent = pageA.waitForEvent('download');
      await notice.getByRole('button', { name: 'Export saved edits' }).click();
      const download = await downloadEvent;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream!) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toContain('My offline draft');
      await pageA.reload();
      await expect(pageA.locator('.collab-sync-notice')).toBeVisible();
      await expectLayerMissing(pageB, 'My offline draft');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('replays an offline new layer exactly once after reload', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-offline-create', testInfo.title);
    const a = await browser.newContext({ locale: 'en-US' });
    const b = await browser.newContext({ locale: 'en-US' });
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    try {
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);
      await a.setOffline(true);
      await expect(pageA.locator('.collab-panel')).toHaveAttribute('data-connection', 'offline');
      await createAnnotationLayerFromUi(pageA, 'Created offline');
      await a.setOffline(false);
      await pageA.reload();
      await expectLayerVisible(pageB, 'Created offline');
      await pageA.reload();
      await expectLayerVisible(pageA, 'Created offline');
      await expect(pageB.locator('.layer-manager-item-name', { hasText: 'Created offline' })).toHaveCount(1);
      await expect(pageA.locator('.collab-sync-notice')).toBeHidden();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('syncs imported file contents and metadata and keeps deletions across reload', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-file-sync', testInfo.title);
    const a = await browser.newContext({ locale: 'en-US' });
    const b = await browser.newContext({ locale: 'en-US' });
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    try {
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);
      await pageA.getByRole('button', { name: 'Layers', exact: true }).click();
      await pageA.locator('.layer-manager-file-input').setInputFiles({
        name: 'shared-file.geojson',
        mimeType: 'application/geo+json',
        buffer: Buffer.from(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [121.45, 31.22],
                    [121.46, 31.23],
                  ],
                },
              },
            ],
          }),
        ),
      });
      await expectLayerVisible(pageB, 'shared-file.geojson');
      await selectLayer(pageA, 'shared-file.geojson');
      await pageA.locator('.layer-manager-color-input').fill('#ef4444');
      await renameSelectedLayerFromUi(pageA, 'shared-file.geojson', 'Shared route');
      await selectLayer(pageB, 'Shared route');
      await expect(pageB.locator('.layer-manager-color-input')).toHaveValue('#ef4444');
      await deleteLayerFromUi(pageB, 'Shared route');
      await expectLayerMissing(pageA, 'Shared route');
      await pageA.reload();
      await expectLayerMissing(pageA, 'Shared route');
      await expect(pageA.locator('.collab-sync-notice')).toBeHidden();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('merges independent fields and lets the user explicitly resolve a name conflict', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoomName('e2e-fields', testInfo.title);
    const a = await browser.newContext({ locale: 'en-US' });
    const b = await browser.newContext({ locale: 'en-US' });
    const pa = await a.newPage();
    const pb = await b.newPage();
    try {
      await openRealRoom(pa, room);
      await openRealRoom(pb, room);
      await createAnnotationLayerFromUi(pa, 'Field baseline');
      await expectLayerVisible(pb, 'Field baseline');
      await a.setOffline(true);
      await selectLayer(pa, 'Field baseline');
      await pa.locator('.layer-manager-name-input').fill('My offline name');
      const panelB = await selectLayer(pb, 'Field baseline');
      await panelB.locator('.layer-manager-item.selected .layer-manager-visibility-button').click();
      await a.setOffline(false);
      await pa.reload();
      await expectLayerVisible(pb, 'My offline name');
      await expect(pa.locator('.collab-sync-notice')).toBeHidden();
      await a.setOffline(true);
      await selectLayer(pa, 'My offline name');
      await pa.locator('.layer-manager-name-input').fill('My conflicting name');
      await renameSelectedLayerFromUi(pb, 'My offline name', 'Other name');
      await a.setOffline(false);
      await pa.reload();
      await expect(pa.locator('.collab-sync-notice')).toBeVisible();
      await pa.locator('.collab-sync-notice summary').click();
      await expect(pa.locator('.collab-sync-notice')).toContainText('My conflicting name');
      await pa.locator('.collab-sync-notice').getByRole('button', { name: 'Use my edit' }).click();
      await expectLayerVisible(pb, 'My conflicting name');
      await expect(pa.locator('.collab-sync-notice')).toBeHidden();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('discovers an offline draft after its original tab closes', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-closed-tab', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    try {
      const first = await context.newPage();
      await openRealRoom(first, room);
      await context.setOffline(true);
      await createAnnotationLayerFromUi(first, 'Closed tab draft');
      await first.close();
      await context.setOffline(false);
      const recovered = await context.newPage();
      await openRealRoom(recovered, room);
      await expectLayerVisible(recovered, 'Closed tab draft');
      await expect(recovered.locator('.collab-sync-notice')).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test('replaces file contents under the same server ID and rematerializes the map', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-replace', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    try {
      await openRealRoom(page, room);
      await page.getByRole('button', { name: 'Layers', exact: true }).click();
      await page.locator('.layer-manager-file-input').setInputFiles({
        name: 'replace.geojson',
        mimeType: 'application/geo+json',
        buffer: Buffer.from(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [121.45, 31.22],
                    [121.46, 31.23],
                  ],
                },
              },
            ],
          }),
        ),
      });
      await expectLayerVisible(page, 'replace.geojson');
      const client = await createProtocolClient(page, room, 'File replacer');
      const replacement = await page.evaluate(async (room) => {
        const target = (window as any).__e2eRoomClients[room];
        const initial = target.messages.filter((message: any) => message.type === 'sync:snapshot').at(-1);
        const layer = initial.layers.find((layer: any) => layer.name === 'replace.geojson');
        const modulePath = '/src/file-layer-sync.ts';
        const { buildFileLayerSyncAsset, encodeFileContentMessage } = await import(modulePath);
        const asset = await buildFileLayerSyncAsset({
          id: layer.id,
          type: 'geojson',
          name: layer.name,
          data: {
            type: 'FeatureCollection',
            features: [1, 2].map((n) => ({
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [121.45 + n * 0.001, 31.22] },
            })),
          },
        });
        target.ws.send(encodeFileContentMessage(asset.envelope.manifest.contentHash, asset.content));
        const m = asset.envelope.manifest;
        return {
          hash: m.contentHash,
          layer: {
            ...layer,
            payload: {
              ...layer.payload,
              contentHash: m.contentHash,
              contentType: m.contentType,
              contentEncoding: m.contentEncoding,
              contentByteLength: m.contentByteLength,
              rawByteLength: m.rawByteLength,
            },
          },
        };
      }, room);
      await client.waitFor('file:content:stored', (message) => message.contentHash === replacement.hash);
      await client.send({ type: 'layer:replace', layer: replacement.layer });
      await client.waitFor('layer:updated');
      await selectLayer(page, 'replace.geojson');
      await expect(page.locator('.layer-manager-details-title')).toContainText('2 points');
      await expect(page.locator('.layer-manager-item-name', { hasText: 'replace.geojson' })).toHaveCount(1);
      await client.close();
    } finally {
      await context.close();
    }
  });

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
