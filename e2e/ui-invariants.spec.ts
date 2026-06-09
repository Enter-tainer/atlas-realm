import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp, openFixture } from './support/map-fixture';
import {
  expectCenterPointReceivesMap,
  expectLocatorInsideViewport,
  expectLocatorOperable,
  expectNoVisibleInteractiveElementOverflow,
  expectViewportHasNoHorizontalScroll,
} from './support/ui-audit';

test.describe('first-principles UI invariants', () => {
  test('keeps visible interactive controls inside the desktop viewport', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openApp(page);
    await expectViewportHasNoHorizontalScroll(page);
    await expectNoVisibleInteractiveElementOverflow(page);
    await expectCenterPointReceivesMap(page);

    const controls = [
      page.getByRole('button', { name: 'Zoom in' }),
      page.locator('.maplibregl-ctrl-layers'),
      page.locator('.maplibregl-ctrl-annotation'),
      page.getByRole('button', { name: 'Routing' }),
      page.getByRole('button', { name: 'Pick a point for weather' }),
      page.getByRole('button', { name: 'Open collaboration controls' }),
    ];
    for (const [index, control] of controls.entries()) {
      await expectLocatorInsideViewport(control, `desktop control ${index + 1}`);
    }

    errors.assertNoErrors();
  });

  test('keeps open tool panels bounded and operable', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openApp(page);

    const panelFlows = [
      {
        open: page.locator('.maplibregl-ctrl-layers'),
        panel: page.locator('.layer-manager-panel'),
        close: page.getByRole('button', { name: 'Close layers' }),
        afterOpen: async () => {},
      },
      {
        open: page.locator('.maplibregl-ctrl-annotation'),
        panel: page.locator('.annotation-panel'),
        close: page.getByRole('button', { name: 'Close annotations' }),
        afterOpen: async () => {},
      },
      {
        open: page.getByRole('button', { name: 'Routing' }),
        panel: page.locator('.routing-panel'),
        close: page.getByRole('button', { name: 'Close routing' }),
        afterOpen: async () => {},
      },
      {
        open: page.getByRole('button', { name: 'Pick a point for weather' }),
        panel: page.locator('.weather-panel'),
        close: page.getByRole('button', { name: 'Close weather' }),
        afterOpen: async () => {
          const box = await page.locator('#map canvas').boundingBox();
          expect(box, 'map canvas should be available for weather picking').not.toBeNull();
          if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        },
      },
    ];

    for (const { open, panel, close, afterOpen } of panelFlows) {
      await open.click();
      await afterOpen();
      const panelLabel = (await panel.getAttribute('aria-label')) || 'tool panel';
      await expectLocatorOperable(panel, panelLabel);
      await expectLocatorInsideViewport(panel, panelLabel);
      await expectNoVisibleInteractiveElementOverflow(page, '#map');
      await close.click();
      await expectLocatorOperable(panel, panelLabel, false);
    }

    errors.assertNoErrors();
  });

  test('keeps fixture-heavy panels inside the viewport', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    for (const [mode, panelSelector] of [
      ['layers', '.layer-manager-panel'],
      ['annotations', '.annotation-panel'],
      ['sharing', '.collab-panel'],
    ] as const) {
      await openFixture(page, mode);
      const panel = page.locator(panelSelector);
      await expect(panel).toBeVisible();
      await expectLocatorInsideViewport(panel, `${mode} panel`);
      await expectNoVisibleInteractiveElementOverflow(page, '#map');
    }

    errors.assertNoErrors();
  });
});
