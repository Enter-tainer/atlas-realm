import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import { clickMap, openLayers, openRouting } from './support/map-interactions';

test.describe('OSRM routing in a real browser', () => {
  test('validates coordinate input before routing', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openRouting(page);

    await panel.locator('.routing-input').nth(1).fill('not a coordinate');
    await panel.locator('.routing-input').nth(1).press('Enter');
    await expect(panel.locator('.routing-status')).toHaveText('From needs lng, lat');
    await expect(panel.getByRole('button', { name: 'Add route' })).toBeDisabled();
    errors.assertNoErrors();
  });

  test('adds a routed GeoJSON layer from typed From and To points', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openRouting(page);

    await panel.locator('.routing-input').nth(1).fill('121.450000, 31.220000');
    await panel.locator('.routing-input').nth(1).press('Enter');
    await panel.locator('.routing-input').nth(2).fill('121.480000, 31.230000');
    await panel.locator('.routing-input').nth(2).press('Enter');
    await expect(panel.getByRole('button', { name: 'Add route' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Add route' }).click();

    await expect(panel.locator('.routing-status')).toContainText('Added route');
    await openLayers(page);
    await expect(page.locator('.layer-manager-item-name', { hasText: 'OSRM route' })).toBeVisible();
    errors.assertNoErrors();
  });

  test('clears picked route points and disables route creation', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openRouting(page);

    await panel.getByRole('button', { name: 'Pick From' }).click();
    await clickMap(page, 0.44, 0.52);
    await clickMap(page, 0.58, 0.48);
    await expect(panel.locator('.routing-summary')).toHaveText('Ready');
    await expect(panel.getByRole('button', { name: 'Clear' })).toBeEnabled();

    await panel.getByRole('button', { name: 'Clear' }).click();
    await expect(panel.locator('.routing-summary')).toHaveText('OSRM driving');
    await expect(panel.getByRole('button', { name: 'Add route' })).toBeDisabled();
    await expect(panel.locator('.routing-input').nth(1)).toHaveValue('');
    await expect(panel.locator('.routing-input').nth(2)).toHaveValue('');
    errors.assertNoErrors();
  });

  test('uses map picking to collect From then To points', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openRouting(page);

    await panel.getByRole('button', { name: 'Pick From' }).click();
    await expect(page.locator('#map')).toHaveAttribute('data-routing-picker-active', 'true');
    await expect(panel.locator('.routing-summary')).toHaveText('Pick From');

    await clickMap(page, 0.42, 0.52);
    await expect(page.locator('#map')).toHaveAttribute('data-routing-picker-active', 'true');
    await expect(panel.locator('.routing-summary')).toHaveText('Pick To');

    await clickMap(page, 0.62, 0.46);
    await expect(page.locator('#map')).toHaveAttribute('data-routing-picker-active', 'false');
    await expect(panel.locator('.routing-summary')).toHaveText('Ready');
    await expect(panel.getByRole('button', { name: 'Add route' })).toBeEnabled();
    errors.assertNoErrors();
  });
});
