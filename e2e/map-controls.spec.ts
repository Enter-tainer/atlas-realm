import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, mapState, openApp } from './support/map-fixture';

test.describe('map shell', () => {
  test('boots a real MapLibre map and exposes the primary controls', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openApp(page);

    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Layers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Annotations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Routing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pick a point for weather' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open collaboration controls' })).toBeVisible();

    const state = await mapState(page);
    expect(state.hasMap).toBe(true);
    expect(state.styleLoaded).toBe(true);
    expect(state.styleLayerCount).toBeGreaterThan(5);

    errors.assertNoErrors();
  });

  test('keeps overlay panels mutually exclusive and closeable', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openApp(page);

    const layersButton = page.locator('.maplibregl-ctrl-layers');
    const annotationsButton = page.locator('.maplibregl-ctrl-annotation');
    const routingButton = page.getByRole('button', { name: 'Routing' });

    await layersButton.click();
    await expect(page.locator('.layer-manager-panel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('.annotation-panel')).toHaveAttribute('aria-hidden', 'true');

    await annotationsButton.click();
    await expect(page.locator('.annotation-panel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('.layer-manager-panel')).toHaveAttribute('aria-hidden', 'true');

    await routingButton.click();
    await expect(page.locator('.routing-panel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('.annotation-panel')).toHaveAttribute('aria-hidden', 'true');

    await page.getByRole('button', { name: 'Close routing' }).click();
    await expect(page.locator('.routing-panel')).toHaveAttribute('aria-hidden', 'true');

    errors.assertNoErrors();
  });

  test('syncs terrain and satellite buttons with MapLibre view state', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openApp(page);

    const terrainButton = page.getByRole('button', { name: '3D Terrain' });
    const satelliteButton = page.getByRole('button', { name: 'Satellite Imagery' });

    await terrainButton.click();
    await expect
      .poll(() => mapState(page))
      .toMatchObject({
        terrain: true,
        viewState: { terrain: true, satellite: false },
      });
    await expect(terrainButton).toHaveClass(/maplibregl-ctrl-terrain-enabled/);

    await satelliteButton.click();
    await expect
      .poll(() => mapState(page))
      .toMatchObject({
        satelliteVisibility: 'visible',
        viewState: { terrain: true, satellite: true },
      });
    await expect(satelliteButton).toHaveClass(/maplibregl-ctrl-satellite-enabled/);

    await satelliteButton.click();
    await expect
      .poll(() => mapState(page))
      .toMatchObject({
        satelliteVisibility: 'none',
        viewState: { terrain: true, satellite: false },
      });

    errors.assertNoErrors();
  });
});
