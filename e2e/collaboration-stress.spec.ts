import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch } from './support/map-fixture';
import {
  annotationSourceSnapshot,
  annotationLabels,
  expectFeatureLabel,
  expectFeatureMissing,
  expectLayerMissing,
  expectLayerVisible,
  layerNames,
} from './support/map-interactions';
import {
  annotationLayer,
  createProtocolClient,
  longTextFeature,
  pointFeature,
  sendBurst,
  sortKey,
  openRealRoom,
  uniqueRoomName,
  type JsonRecord,
} from './support/real-collaboration';

test.describe('real collaboration protocol stress', () => {
  test('fans out a burst of feature upserts to every connected browser', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-burst', testInfo.title);
    const contextA = await browser.newContext({ locale: 'en-US' });
    const contextB = await browser.newContext({ locale: 'en-US' });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const errorsA = await installBrowserErrorWatch(pageA);
    const errorsB = await installBrowserErrorWatch(pageB);

    try {
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);
      const client = await createProtocolClient(pageA, room, 'Burst writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('stress-layer', 'Stress burst') });
      await client.waitFor('layer:created', (message) => (message.layer as JsonRecord)?.id === 'stress-layer');
      await expectLayerVisible(pageA, 'Stress burst');
      await expectLayerVisible(pageB, 'Stress burst');

      const messages = Array.from({ length: 120 }, (_, index) => ({
        type: 'annotation-feature:upsert',
        feature: pointFeature({
          id: `burst-${index}`,
          layerId: 'stress-layer',
          label: `Burst marker ${index}`,
          index,
          lng: 121.42 + index * 0.0001,
          lat: 31.2 + index * 0.00008,
        }),
      }));
      await sendBurst(client, messages);

      await expectFeatureLabel(pageA, 'Burst marker 119');
      await expectFeatureLabel(pageB, 'Burst marker 119');
      await expect.poll(() => annotationLabels(pageB)).toContain('Burst marker 0');
      errorsA.assertNoErrors();
      errorsB.assertNoErrors();
      await client.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('converges after deleting half of a large feature set', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-delete', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    const errors = await installBrowserErrorWatch(page);

    try {
      await openRealRoom(page, room);
      const client = await createProtocolClient(page, room, 'Delete writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('delete-layer', 'Delete convergence') });
      await client.waitFor('layer:created');
      await expectLayerVisible(page, 'Delete convergence');
      await sendBurst(
        client,
        Array.from({ length: 80 }, (_, index) => ({
          type: 'annotation-feature:upsert',
          feature: pointFeature({
            id: `delete-${index}`,
            layerId: 'delete-layer',
            label: `Delete marker ${index}`,
            index,
          }),
        })),
      );
      await expectFeatureLabel(page, 'Delete marker 79');

      await sendBurst(
        client,
        Array.from({ length: 40 }, (_, index) => ({
          type: 'annotation-feature:delete',
          featureId: `delete-${index}`,
        })),
      );
      await expectFeatureMissing(page, 'Delete marker 0');
      await expectFeatureMissing(page, 'Delete marker 39');
      await expectFeatureLabel(page, 'Delete marker 40');
      await expectFeatureLabel(page, 'Delete marker 79');
      errors.assertNoErrors();
      await client.close();
    } finally {
      await context.close();
    }
  });

  test('reloads a fresh browser into the latest Durable Object snapshot after a burst', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoomName('e2e-reload', testInfo.title);
    const writerContext = await browser.newContext({ locale: 'en-US' });
    const readerContext = await browser.newContext({ locale: 'en-US' });
    const writer = await writerContext.newPage();
    const reader = await readerContext.newPage();

    try {
      await openRealRoom(writer, room);
      const client = await createProtocolClient(writer, room, 'Snapshot writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('snapshot-layer', 'Snapshot layer') });
      await client.waitFor('layer:created');
      await expectLayerVisible(writer, 'Snapshot layer');
      await sendBurst(
        client,
        Array.from({ length: 50 }, (_, index) => ({
          type: 'annotation-feature:upsert',
          feature: pointFeature({
            id: `snapshot-${index}`,
            layerId: 'snapshot-layer',
            label: `Snapshot marker ${index}`,
            index,
          }),
        })),
      );

      await openRealRoom(reader, room);
      await expectLayerVisible(reader, 'Snapshot layer');
      await expectFeatureLabel(reader, 'Snapshot marker 49');
      await reader.reload();
      await expect(reader.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
      await expectFeatureLabel(reader, 'Snapshot marker 0');
      await expectFeatureLabel(reader, 'Snapshot marker 49');
      await client.close();
    } finally {
      await writerContext.close();
      await readerContext.close();
    }
  });

  test('keeps last-write-wins semantics for duplicate feature ids', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-lww', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    try {
      await openRealRoom(page, room);
      const client = await createProtocolClient(page, room, 'Duplicate writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('lww-layer', 'Last write wins') });
      await client.waitFor('layer:created');
      await expectLayerVisible(page, 'Last write wins');
      await client.send({
        type: 'annotation-feature:upsert',
        feature: pointFeature({ id: 'same-feature', layerId: 'lww-layer', label: 'Old duplicate label' }),
      });
      await client.send({
        type: 'annotation-feature:upsert',
        feature: pointFeature({ id: 'same-feature', layerId: 'lww-layer', label: 'Final duplicate label' }),
      });

      await expectFeatureLabel(page, 'Final duplicate label');
      await expectFeatureMissing(page, 'Old duplicate label');
      await client.close();
    } finally {
      await context.close();
    }
  });

  test('rejects feature upserts for missing layers without poisoning the room', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-reject', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    try {
      await openRealRoom(page, room);
      const client = await createProtocolClient(page, room, 'Reject writer');
      await client.send({
        type: 'annotation-feature:upsert',
        feature: pointFeature({ id: 'orphan-feature', layerId: 'missing-layer', label: 'Orphan marker' }),
      });
      await client.waitFor('annotation-feature:rejected', (message) => message.featureId === 'orphan-feature');
      await expectFeatureMissing(page, 'Orphan marker');

      await client.send({ type: 'layer:create', layer: annotationLayer('valid-layer', 'Valid after rejection') });
      await client.waitFor('layer:created');
      await expectLayerVisible(page, 'Valid after rejection');
      await client.send({
        type: 'annotation-feature:upsert',
        feature: pointFeature({ id: 'valid-feature', layerId: 'valid-layer', label: 'Valid marker after rejection' }),
      });
      await expectFeatureLabel(page, 'Valid marker after rejection');
      await client.close();
    } finally {
      await context.close();
    }
  });

  test('deleting a layer removes all child features across connected browsers', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-layer-delete', testInfo.title);
    const contextA = await browser.newContext({ locale: 'en-US' });
    const contextB = await browser.newContext({ locale: 'en-US' });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await openRealRoom(pageA, room);
      await openRealRoom(pageB, room);
      const client = await createProtocolClient(pageA, room, 'Layer delete writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('child-layer', 'Child cleanup') });
      await client.waitFor('layer:created');
      await expectLayerVisible(pageA, 'Child cleanup');
      await expectLayerVisible(pageB, 'Child cleanup');
      await sendBurst(
        client,
        Array.from({ length: 15 }, (_, index) => ({
          type: 'annotation-feature:upsert',
          feature: pointFeature({
            id: `child-${index}`,
            layerId: 'child-layer',
            label: `Child marker ${index}`,
            index,
          }),
        })),
      );
      await expectFeatureLabel(pageB, 'Child marker 14');

      await client.send({ type: 'layer:delete', layerId: 'child-layer' });
      await client.waitFor('layer:deleted', (message) => message.layerId === 'child-layer');
      await expectLayerMissing(pageB, 'Child cleanup');
      await expectFeatureMissing(pageB, 'Child marker 14');
      await client.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('applies layer reorder broadcasts from the real room', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-reorder', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    try {
      await openRealRoom(page, room);
      const client = await createProtocolClient(page, room, 'Reorder writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('layer-one', 'Layer One', 0) });
      await client.send({ type: 'layer:create', layer: annotationLayer('layer-two', 'Layer Two', 1) });
      await client.waitFor('layer:created', (message) => (message.layer as JsonRecord)?.id === 'layer-two');
      await expectLayerVisible(page, 'Layer One');
      await expectLayerVisible(page, 'Layer Two');

      await client.send({
        type: 'layer:reorder',
        updates: [
          { layerId: 'layer-two', sortKey: sortKey(0) },
          { layerId: 'layer-one', sortKey: sortKey(1) },
        ],
      });
      await client.waitFor('layer:reordered');
      await expect.poll(() => layerNames(page)).toEqual(expect.arrayContaining(['Layer Two', 'Layer One']));
      const names = await layerNames(page);
      expect(names.indexOf('Layer Two')).toBeLessThan(names.indexOf('Layer One'));
      await client.close();
    } finally {
      await context.close();
    }
  });

  test('sanitizes long labels, notes, and text marker sizes from protocol input', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-long-tail', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    try {
      await openRealRoom(page, room);
      const client = await createProtocolClient(page, room, 'Long tail writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('long-layer', 'Long tail layer') });
      await client.waitFor('layer:created');
      await expectLayerVisible(page, 'Long tail layer');
      const longLabel = `Long label ${'x'.repeat(180)}`;
      const expectedLabel = longLabel.slice(0, 120);
      await client.send({
        type: 'annotation-feature:upsert',
        feature: longTextFeature({
          id: 'long-text',
          layerId: 'long-layer',
          label: longLabel,
          note: `Long note ${'y'.repeat(1500)}`,
        }),
      });

      await expectFeatureLabel(page, expectedLabel);
      await expect
        .poll(async () => {
          const snapshot = await annotationSourceSnapshot(page);
          const textFeature = snapshot
            .flatMap((source) => source.features)
            .find((feature) => feature.properties?.feature_type === 'text');
          return textFeature?.properties || null;
        })
        .toMatchObject({
          label: expectedLabel,
          description: `Long note ${'y'.repeat(1190)}`,
          text_width: 420,
          text_height: 48,
        });
      await client.close();
    } finally {
      await context.close();
    }
  });

  test('seeded random protocol operations converge after reload', async ({ browser }, testInfo) => {
    const room = uniqueRoomName('e2e-random', testInfo.title);
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    try {
      await openRealRoom(page, room);
      const client = await createProtocolClient(page, room, 'Random writer');
      await client.send({ type: 'layer:create', layer: annotationLayer('random-layer-a', 'Random Layer A', 0) });
      await client.send({ type: 'layer:create', layer: annotationLayer('random-layer-b', 'Random Layer B', 1) });
      await client.waitFor('layer:created', (message) => (message.layer as JsonRecord)?.id === 'random-layer-b');
      await expectLayerVisible(page, 'Random Layer A');
      await expectLayerVisible(page, 'Random Layer B');

      const expected = new Set<string>();
      let seed = 123456789;
      const nextRandom = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const ids: string[] = [];
      const messages: JsonRecord[] = [];
      for (let index = 0; index < 90; index += 1) {
        const id = `random-${Math.floor(nextRandom() * 36)}`;
        const layerId = nextRandom() > 0.5 ? 'random-layer-a' : 'random-layer-b';
        if (nextRandom() < 0.28 && ids.includes(id)) {
          messages.push({ type: 'annotation-feature:delete', featureId: id });
          expected.delete(`Random marker ${id}`);
        } else {
          if (!ids.includes(id)) ids.push(id);
          const label = `Random marker ${id}`;
          messages.push({
            type: 'annotation-feature:upsert',
            feature: pointFeature({
              id,
              layerId,
              label,
              index,
              lng: 121.43 + nextRandom() * 0.04,
              lat: 31.2 + nextRandom() * 0.04,
            }),
          });
          expected.add(label);
        }
      }
      await sendBurst(client, messages);

      const labels = [...expected].slice(0, 8);
      for (const label of labels) await expectFeatureLabel(page, label);
      await page.reload();
      await expect(page.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
      for (const label of labels) await expectFeatureLabel(page, label);
      await client.close();
    } finally {
      await context.close();
    }
  });
});
