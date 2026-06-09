import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import { searchSourceFeatureCount } from './support/map-interactions';

test.describe('POI search in a real browser', () => {
  test('renders Photon results and selects a result on the map', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);

    await page.getByRole('searchbox', { name: 'Search POI' }).fill('shanghai station');
    await expect(page.locator('.poi-search-result')).toHaveCount(2);
    await page.locator('.poi-search-result', { hasText: 'Shanghai Railway Station' }).click();

    await expect(page.locator('.poi-search-popup')).toContainText('Shanghai Railway Station');
    await expect.poll(() => searchSourceFeatureCount(page)).toBe(1);
    await expect(page.locator('.poi-search-result', { hasText: 'Shanghai Railway Station' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    errors.assertNoErrors();
  });

  test('clears the selected result, popup, and search source', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);

    await page.getByRole('searchbox', { name: 'Search POI' }).fill('temple');
    await page.locator('.poi-search-result').first().click();
    await expect.poll(() => searchSourceFeatureCount(page)).toBe(1);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.locator('.poi-search-result')).toHaveCount(0);
    await expect(page.locator('.poi-search-popup')).toHaveCount(0);
    await expect.poll(() => searchSourceFeatureCount(page)).toBe(0);
    errors.assertNoErrors();
  });

  test('does not query Photon for one-character input', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    let photonRequests = 0;
    await page.route(/https:\/\/photon\.komoot\.io\/api\/.*/, (route) => {
      photonRequests += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"features":[]}' });
    });

    await page.getByRole('searchbox', { name: 'Search POI' }).fill('s');
    await page.waitForTimeout(450);
    expect(photonRequests).toBe(0);
    await expect(page.locator('.poi-search-result')).toHaveCount(0);
    errors.assertNoErrors();
  });

  test('shows failure status when Photon returns an error', async ({ page }) => {
    await openApp(page);
    await page.route(/https:\/\/photon\.komoot\.io\/api\/.*/, (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"bad gateway"}' }),
    );

    await page.getByRole('searchbox', { name: 'Search POI' }).fill('station');
    await expect(page.locator('.poi-search-status')).toHaveText('Search failed');
    await expect(page.locator('.poi-search-result')).toHaveCount(0);
  });
});
