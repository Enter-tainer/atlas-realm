import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import { annotationFeatureTypes, clickMap, openAnnotations } from './support/map-interactions';

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

test.describe('weather card annotations in a real browser', () => {
  test('collapses to a dot and one text line, then expands into the dashboard', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page, {}, { nominatim: 'success' });
    await openAnnotations(page);

    // The weather picker control also answers to "weather", so anchor the mode button exactly.
    await page.getByRole('button', { name: 'Weather', exact: true }).click();
    // Anchor low on the map: the card grows upward from its coordinate, so a
    // point in the upper half pushes its header out of the viewport.
    await clickMap(page, 0.5, 0.72);

    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();
    await editor.locator('input.annotation-input[type="text"]').fill('Shanghai Bund');
    await editor.locator('input.annotation-input[type="date"]').fill('2026-06-01');
    await editor.locator('input.annotation-input[type="number"]').fill('3');
    await editor.locator('.annotation-editor-close').click();

    // Assert the stored type while the map still sits at its starting zoom: the
    // source snapshot helper queries rendered tiles, which drop out at low zoom.
    await expect.poll(() => annotationFeatureTypes(page)).toContain('weather');

    // Collapsed there is no card at all: a dot plus one plain-text line, and the
    // line carries only the first day of the range.
    const label = page.locator('.annotation-weather-label');
    await expect(label).toBeVisible();
    await expect(label.locator('.annotation-weather-label-dot')).toBeVisible();
    await expect(label.locator('.annotation-weather-label-text')).toHaveText('28°/20° · 60% · 0mm');
    await expect(page.locator('.annotation-weather-card')).toHaveCount(0);

    // One click goes straight to the biggest form: the dashboard card.
    await label.click();
    const card = page.locator('.annotation-weather-card');
    await expect(card).toBeVisible();
    await expect(page.locator('.annotation-weather-label')).toHaveCount(0);
    await expect(card.locator('.annotation-weather-card-title')).toHaveText('Shanghai Bund');
    await expect(card.locator('.annotation-weather-card-meta')).toHaveText('2026-06-01 – 2026-06-03 · 3 days');
    await expect(card.locator('.annotation-weather-card-frame')).toHaveAttribute(
      'src',
      /weather\.mgt\.moe\/\?route=.*compact=1.*immersive=true/,
    );

    const days = card.locator('.annotation-weather-card-day');
    await expect(days).toHaveCount(3);
    // Icons are lucide SVGs, so the condition lives in the tooltip.
    await expect(days.nth(0).locator('.annotation-weather-card-day-icon svg')).toBeVisible();
    await expect(days.nth(0).locator('.annotation-weather-card-day-icon')).toHaveAttribute('title', 'Clear sky');
    await expect(days.nth(0).locator('.annotation-weather-card-day-temps')).toHaveText('28° 20°');
    await expect(days.nth(0)).toHaveAttribute('title', '6/1: Clear sky · 60% · 0mm');
    await expect(days.nth(2).locator('.annotation-weather-card-day-icon')).toHaveAttribute('title', 'Slight rain');
    await expect(days.nth(2)).toHaveAttribute('title', '6/3: Slight rain · 74% · 2.5mm');

    // A created card must stay renameable through a visible entry point.
    await card.locator('.annotation-weather-card-edit').click();
    const editPopup = page.locator('.annotation-editor');
    await expect(editPopup).toBeVisible();
    await editPopup.locator('input.annotation-input[type="text"]').fill('Shanghai Hongqiao');
    await editPopup.locator('.annotation-editor-close').click();
    await expect(card.locator('.annotation-weather-card-title')).toHaveText('Shanghai Hongqiao');

    // Expansion is the user's choice, not a zoom tier, so zooming out keeps it open.
    await page.evaluate(() => {
      (window as unknown as { _mlmap: { jumpTo: (options: { zoom: number }) => void } })._mlmap.jumpTo({
        zoom: 8,
      });
    });
    await expect(card).toBeVisible();
    await expect(page.locator('.annotation-weather-label')).toHaveCount(0);

    // The header toggles back down to the label.
    await card.locator('.annotation-weather-card-header').click();
    await expect(page.locator('.annotation-weather-card')).toHaveCount(0);
    await expect(page.locator('.annotation-weather-label-text')).toHaveText('28°/20° · 60% · 0mm');

    errors.assertNoErrors();
  });
});
