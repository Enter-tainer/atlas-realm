import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import { clickMap } from './support/map-interactions';

test.describe('weather point picker in a real browser', () => {
  test('resolves a picked map point and loads the compact weather dashboard', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page, {}, { nominatim: 'success' });

    const weatherButton = page.getByRole('button', { name: 'Pick a point for weather' });
    await weatherButton.click();
    await expect(page.locator('#map')).toHaveAttribute('data-weather-picker-active', 'true');

    await clickMap(page, 0.52, 0.48);
    await expect(page.locator('.weather-panel')).toBeVisible();
    await expect(page.locator('.weather-panel-meta')).toHaveText('E2E Weather Point, Fuzhou Road, Shanghai, China');

    const openLink = page.locator('.weather-panel-open');
    await expect(openLink).toHaveAttribute('href', /weather\.mgt\.moe\/\?route=.*compact=1/);
    await expect(openLink).toHaveAttribute('href', /E2E\+Weather\+Point/);
    await expect(page.locator('.weather-panel-frame')).toHaveAttribute('src', /weather\.mgt\.moe\/\?route=/);
    await expect(page.locator('.maplibregl-marker')).toBeVisible();
    await expect(weatherButton).toHaveAttribute('aria-pressed', 'true');
    errors.assertNoErrors();
  });

  test('shows an address lookup failure and clears the picker on close', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);

    await page.getByRole('button', { name: 'Pick a point for weather' }).click();
    await clickMap(page, 0.5, 0.5);

    await expect(page.locator('.weather-panel')).toBeVisible();
    await expect(page.locator('.weather-panel-status')).toHaveText('Address lookup failed');
    await expect(page.locator('.weather-panel-open')).toBeHidden();
    await expect(page.locator('.weather-panel-frame')).toBeHidden();

    await page.getByRole('button', { name: 'Close weather' }).click();
    await expect(page.locator('#map')).toHaveAttribute('data-weather-picker-active', 'false');
    await expect(page.locator('.weather-panel')).not.toHaveClass(/weather-panel-visible/);
    await expect(page.locator('.weather-panel-meta')).toHaveText('No point selected');
    await expect(page.locator('.weather-panel-open')).toBeHidden();
    await expect(page.locator('.weather-panel-frame')).toBeHidden();
    await expect(page.locator('.maplibregl-marker')).toHaveCount(0);
    errors.assertNoErrors();
  });
});
