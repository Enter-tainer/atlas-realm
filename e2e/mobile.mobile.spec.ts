import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';

test.describe('mobile map shell', () => {
  test('keeps the main map controls usable on a phone viewport', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openApp(page);

    await expect(page.locator('#map canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Layers' }).click();
    await expect(page.locator('.layer-manager-panel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#map')).toHaveAttribute('data-layer-manager-panel-open', 'true');
    await expect(page.getByRole('button', { name: 'Open collaboration controls' })).toBeHidden();

    await page.getByRole('button', { name: 'Close layers' }).click();
    await expect(page.locator('.layer-manager-panel')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#map')).toHaveAttribute('data-layer-manager-panel-open', 'false');
    await expect(page.getByRole('button', { name: 'Open collaboration controls' })).toBeVisible();

    errors.assertNoErrors();
  });
});
