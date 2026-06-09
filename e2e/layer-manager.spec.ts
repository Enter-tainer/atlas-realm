import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import {
  clickMap,
  createAnnotationLayerFromUi,
  expectFeatureLabel,
  expectFeatureMissing,
  mapLayerVisibility,
  openAnnotationsForLayer,
  openLayers,
  selectLayer,
} from './support/map-interactions';

test.describe('layer manager workflows in a real browser', () => {
  test('creates and renames an annotation layer', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);

    await createAnnotationLayerFromUi(page, 'Inspection notes');
    await selectLayer(page, 'Inspection notes');
    await page.locator('.layer-manager-name-input').fill('Renamed inspection notes');
    await expect(page.locator('.layer-manager-item-name', { hasText: 'Renamed inspection notes' })).toBeVisible();
    errors.assertNoErrors();
  });

  test('clears the last annotation layer without deleting the layer row', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);

    await openAnnotationsForLayer(page, 'Annotations');
    await page.getByRole('button', { name: 'Marker' }).click();
    await clickMap(page);
    await page.locator('.annotation-editor input.annotation-input').fill('Layer clear marker');
    await expectFeatureLabel(page, 'Layer clear marker');

    const panel = await selectLayer(page, 'Annotations');
    await expect(panel.getByRole('button', { name: 'Clear' })).toBeVisible();
    await panel.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('.layer-manager-item-name', { hasText: 'Annotations' })).toBeVisible();
    await expectFeatureMissing(page, 'Layer clear marker');
    errors.assertNoErrors();
  });

  test('deletes an annotation layer when another annotation layer remains', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);

    await createAnnotationLayerFromUi(page, 'Temporary notes');
    const panel = await selectLayer(page, 'Temporary notes');
    await expect(panel.getByRole('button', { name: 'Delete' })).toBeVisible();
    await panel.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.layer-manager-item-name', { hasText: 'Temporary notes' })).toHaveCount(0);
    await expect(page.locator('.layer-manager-item-name', { hasText: 'Annotations' })).toBeVisible();
    errors.assertNoErrors();
  });

  test('imports GeoJSON from URL and exposes file layer style controls', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openLayers(page);

    await page
      .getByRole('textbox', { name: 'Layer URL' })
      .fill(new URL('/fixtures/browser-layer.geojson', page.url()).href);
    await page.getByRole('button', { name: 'Import from URL' }).click();
    await expect(panel.locator('.layer-manager-item-name', { hasText: 'browser-layer.geojson' })).toBeVisible();
    await expect(page.getByText('GeoJSON - 1 lines - 1 points - 1 polygons')).toBeVisible();

    await panel.locator('.layer-manager-color-input').fill('#ef4444');
    await panel.locator('.layer-manager-range').first().fill('8');
    await expect(panel.locator('.layer-manager-value').first()).toHaveText('8px');
    errors.assertNoErrors();
  });

  test('imports GPX from URL and exposes track metadata', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openLayers(page);

    await page.getByRole('textbox', { name: 'Layer URL' }).fill(new URL('/fixtures/city-loop.gpx', page.url()).href);
    await page.getByRole('button', { name: 'Import from URL' }).click();

    await expect(panel.locator('.layer-manager-item-name', { hasText: 'city-loop.gpx' })).toBeVisible();
    await expect(page.getByText(/GPX - 3 pts - p99/)).toBeVisible();
    await expect(panel.locator('.layer-manager-name-input')).toHaveValue('city-loop.gpx');
    await expect(panel.locator('.layer-manager-details-title')).toHaveText(/3 pts - p99/);
    errors.assertNoErrors();
  });

  test('toggles imported layer visibility on the underlying MapLibre layers', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openLayers(page);

    await page
      .getByRole('textbox', { name: 'Layer URL' })
      .fill(new URL('/fixtures/toggle-layer.geojson', page.url()).href);
    await page.getByRole('button', { name: 'Import from URL' }).click();
    const row = panel.locator('.layer-manager-item').filter({ hasText: 'toggle-layer.geojson' });
    await expect(row).toBeVisible();
    const layerId = await row.evaluate((node) => {
      const id = (node as HTMLElement).dataset.layerItemId || '';
      return `${id}-line`;
    });

    await row.locator('.layer-manager-visibility-button').click();
    await expect(row).toHaveClass(/muted/);
    await expect.poll(() => mapLayerVisibility(page, layerId)).toBe('none');

    await row.locator('.layer-manager-visibility-button').click();
    await expect.poll(() => mapLayerVisibility(page, layerId)).toBe('visible');
    errors.assertNoErrors();
  });

  test('reorders layers with keyboard controls', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await createAnnotationLayerFromUi(page, 'Layer A');
    await createAnnotationLayerFromUi(page, 'Layer B');
    const panel = await openLayers(page);

    await panel.getByRole('button', { name: 'Reorder Layer B' }).focus();
    await page.keyboard.press('Home');
    await expect(panel.locator('.layer-manager-item-name').first()).toHaveText('Layer B');
    errors.assertNoErrors();
  });
});
