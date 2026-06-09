import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import {
  annotationFeatureTypes,
  annotationKinds,
  clickMap,
  expectFeatureLabel,
  expectFeatureMissing,
  openAnnotations,
} from './support/map-interactions';

test.describe('annotation tools in a real browser', () => {
  test('creates, edits, and deletes a marker annotation', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Marker' }).click();
    await clickMap(page, 0.5, 0.5);
    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();
    await editor.locator('input.annotation-input').fill('Marker inspection');
    await editor.locator('textarea.annotation-note').fill('Checked in browser');
    await expectFeatureLabel(page, 'Marker inspection');
    await expect.poll(() => annotationKinds(page)).toContain('annotation_point');

    await editor.locator('.annotation-danger').click();
    await expectFeatureMissing(page, 'Marker inspection');
    errors.assertNoErrors();
  });

  test('creates a text note with a rendered text marker', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Text' }).click();
    await clickMap(page, 0.48, 0.48);
    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();
    await editor.locator('input.annotation-input').fill('Platform note');
    await editor.locator('textarea.annotation-note').fill('Long dwell time observed');

    await expectFeatureLabel(page, 'Platform note');
    await expect(page.locator('.annotation-text-note')).toBeVisible();
    await expect.poll(() => annotationFeatureTypes(page)).toContain('text');
    errors.assertNoErrors();
  });

  test('builds a line draft, supports undo, and commits the line', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openAnnotations(page);

    await page.getByRole('button', { name: 'Line' }).click();
    await clickMap(page, 0.42, 0.52);
    await expect(panel.locator('.annotation-summary')).toHaveText('1 draft point');
    await expect(panel.getByRole('button', { name: 'Done' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel.locator('.annotation-status')).toHaveText('Line discarded');

    await clickMap(page, 0.55, 0.47);
    await expect(panel.locator('.annotation-summary')).toHaveText('1 draft point');
    await clickMap(page, 0.6, 0.45);
    await expect(panel.locator('.annotation-summary')).toHaveText('2 draft points');
    await expect(panel.getByRole('button', { name: 'Done' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Undo' }).click();
    await expect(panel.locator('.annotation-summary')).toHaveText('1 draft point');
    await clickMap(page, 0.6, 0.45);
    await panel.getByRole('button', { name: 'Done' }).click();

    await expect(panel.locator('.annotation-status')).toHaveText('Line added');
    await expect.poll(() => annotationFeatureTypes(page)).toContain('path');
    await expect.poll(() => annotationKinds(page)).toContain('annotation_path');
    errors.assertNoErrors();
  });

  test('commits an area draft with polygon styling controls', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openAnnotations(page);

    await page.getByRole('button', { name: 'Area' }).click();
    await expect(page.getByText('Fill')).toBeVisible();
    await clickMap(page, 0.44, 0.56);
    await clickMap(page, 0.58, 0.52);
    await clickMap(page, 0.54, 0.42);
    await expect(panel.getByRole('button', { name: 'Done' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Done' }).click();

    await expect(panel.locator('.annotation-status')).toHaveText('Area added');
    await expect.poll(() => annotationFeatureTypes(page)).toContain('polygon');
    await expect.poll(() => annotationKinds(page)).toContain('annotation_polygon');
    errors.assertNoErrors();
  });

  test('cancels an unfinished draft with Undo', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openAnnotations(page);

    await page.getByRole('button', { name: 'Line' }).click();
    await clickMap(page, 0.4, 0.5);
    await expect(panel.locator('.annotation-summary')).toHaveText('1 draft point');
    await panel.getByRole('button', { name: 'Undo' }).click();
    await expect(panel.locator('.annotation-summary')).toHaveText('0 features');
    await expect.poll(() => annotationFeatureTypes(page)).not.toContain('path');
    errors.assertNoErrors();
  });

  test('creates a routed annotation from two map clicks', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    const panel = await openAnnotations(page);

    await page.getByRole('button', { name: 'Route' }).click();
    await clickMap(page, 0.45, 0.52);
    await clickMap(page, 0.63, 0.46);

    await expect(panel.locator('.annotation-status')).toContainText('Route added');
    await expect.poll(() => annotationFeatureTypes(page)).toContain('route');
    await expect.poll(() => annotationKinds(page)).toContain('annotation_route');
    errors.assertNoErrors();
  });
});
