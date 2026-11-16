import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import { clickMap, openAnnotations } from './support/map-interactions';

type ZoomableMap = {
  jumpTo(options: { zoom: number; center: [number, number] }): void;
};

const NOTE = Array(30).fill('A long note line.').join('\n\n');

test.describe('info box on a phone', () => {
  test('opens as a sheet along the bottom that collapses to its title', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    // Zoomed in, so the marker lands on the map rather than the space around the globe.
    await page.evaluate(() => {
      (window as unknown as { _mlmap: ZoomableMap })._mlmap.jumpTo({ zoom: 8, center: [121.4, 31.2] });
    });

    const panel = await openAnnotations(page);
    await page.getByRole('button', { name: 'Marker' }).click();
    await clickMap(page, 0.5, 0.2);
    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();
    await editor.locator('input.annotation-input').fill('Sheet Note');
    await editor.locator('textarea.annotation-note').fill(NOTE);
    await page.keyboard.press('Escape');
    // Escape leaves the editor and folds the panel away, so the map is clear.
    await expect(panel).toHaveAttribute('aria-hidden', 'true');

    await clickMap(page, 0.5, 0.2);

    const sheet = page.locator('.maplibregl-popup.orm-info-popup');
    await expect(sheet).toBeVisible();
    const viewport = page.viewportSize();
    const expanded = await sheet.boundingBox();
    if (!viewport || !expanded) throw new Error('no sheet box');
    expect(expanded.x).toBe(0);
    expect(expanded.width).toBe(viewport.width);
    expect(Math.round(expanded.y + expanded.height)).toBe(viewport.height);

    await page.getByRole('button', { name: 'Collapse info box' }).click();
    await expect(sheet).toHaveClass(/sheet-collapsed/);
    await expect.poll(async () => viewport.height - ((await sheet.boundingBox())?.y ?? 0)).toBeLessThan(120);

    await page.getByRole('button', { name: 'Expand info box' }).click();
    await expect(sheet).not.toHaveClass(/sheet-collapsed/);
    await expect.poll(async () => (await sheet.boundingBox())?.y ?? 0).toBeCloseTo(expanded.y, 0);

    await page.getByRole('button', { name: 'Close info box' }).click();
    await expect(sheet).toHaveCount(0);

    errors.assertNoErrors();
  });
});
