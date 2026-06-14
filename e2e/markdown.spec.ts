import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openApp } from './support/map-fixture';
import { clickMap, expectFeatureLabel, openAnnotations } from './support/map-interactions';

test.describe('markdown rendering in annotations', () => {
  test('renders bold and italic in text note body on map', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Text' }).click();
    await clickMap(page, 0.5, 0.5);

    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();

    await editor.locator('input.annotation-input').fill('Markdown Note');
    await editor.locator('textarea.annotation-note').fill('Hello **world** and *everyone*');

    await expectFeatureLabel(page, 'Markdown Note');

    // Verify markdown is rendered as HTML in the note body
    const noteBody = page.locator('.annotation-text-note-body');
    await expect(noteBody).toBeVisible();
    await expect(noteBody.locator('strong')).toBeVisible();
    await expect(noteBody.locator('strong')).toHaveText('world');
    await expect(noteBody.locator('em')).toBeVisible();
    await expect(noteBody.locator('em')).toHaveText('everyone');

    // Title should be plain text
    const noteTitle = page.locator('.annotation-text-note-title');
    await expect(noteTitle).toHaveText('Markdown Note');
    await expect(noteTitle.locator('strong')).not.toBeVisible();

    errors.assertNoErrors();
  });

  test('renders links with safety attributes', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Text' }).click();
    await clickMap(page, 0.5, 0.5);

    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();

    await editor.locator('input.annotation-input').fill('Link Note');
    await editor.locator('textarea.annotation-note').fill('Visit [OpenStreetMap](https://www.openstreetmap.org)');

    await expectFeatureLabel(page, 'Link Note');

    const noteBody = page.locator('.annotation-text-note-body');
    const link = noteBody.locator('a');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    await expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org');

    errors.assertNoErrors();
  });

  test('sanitizes dangerous HTML input', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Text' }).click();
    await clickMap(page, 0.5, 0.5);

    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();

    await editor.locator('input.annotation-input').fill('XSS Note');
    await editor.locator('textarea.annotation-note').fill('<script>alert("xss")</script>');

    await expectFeatureLabel(page, 'XSS Note');

    const noteBody = page.locator('.annotation-text-note-body');
    await expect(noteBody).toBeVisible();

    // Script tags should not appear in the DOM
    await expect(noteBody.locator('script')).not.toBeVisible();

    errors.assertNoErrors();
  });

  test('preserves original markdown text in edit mode', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Text' }).click();
    await clickMap(page, 0.5, 0.5);

    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();

    const originalMarkdown = '**bold** and *italic* and `code`';
    await editor.locator('input.annotation-input').fill('Edit Test');
    await editor.locator('textarea.annotation-note').fill(originalMarkdown);

    await expectFeatureLabel(page, 'Edit Test');

    // Close editor and reopen to verify markdown text is preserved
    await page.keyboard.press('Escape');
    await expect(editor).not.toBeVisible();

    // Double-click the text note to open editor again
    const note = page.locator('.annotation-text-note');
    await note.dblclick();
    await expect(editor).toBeVisible();

    // The textarea should contain the original markdown, not HTML
    const noteTextarea = editor.locator('textarea.annotation-note');
    const value = await noteTextarea.inputValue();
    expect(value).toContain('**bold**');
    expect(value).not.toContain('<strong>');

    errors.assertNoErrors();
  });

  test('renders markdown in annotation popup', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);
    await openApp(page);
    await openAnnotations(page);

    await page.getByRole('button', { name: 'Marker' }).click();
    await clickMap(page, 0.5, 0.5);

    const editor = page.locator('.annotation-editor');
    await expect(editor).toBeVisible();

    await editor.locator('input.annotation-input').fill('Popup Note');
    await editor.locator('textarea.annotation-note').fill('Learn more at **OpenStreetMap**');

    await page.keyboard.press('Escape');

    // Click on the marker point to trigger the popup
    await clickMap(page, 0.5, 0.5);

    // The popup should contain rendered markdown
    const popupParagraph = page.locator('.orm-popup-paragraphs p').last();
    await expect(popupParagraph).toBeVisible({ timeout: 5000 });
    await expect(popupParagraph.locator('strong')).toHaveText('OpenStreetMap');

    errors.assertNoErrors();
  });
});
