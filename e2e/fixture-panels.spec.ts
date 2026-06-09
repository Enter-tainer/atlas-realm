import { expect, test } from '@playwright/test';
import { installBrowserErrorWatch, openFixture } from './support/map-fixture';
import { expectLocatorInsideViewport, expectNoVisibleInteractiveElementOverflow } from './support/ui-audit';

test.describe('fixture-backed panel rendering', () => {
  test('renders real layer manager rows and selected layer details', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openFixture(page, 'layers');

    const panel = page.locator('.layer-manager-panel');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(
      panel.locator('.layer-manager-item-name', { hasText: 'Routes: Wukang Road, metro, Bund' }),
    ).toBeVisible();
    await expect(
      panel.locator('.layer-manager-item-name', { hasText: 'Stops: meetup, coffee, photos, dinner' }),
    ).toBeVisible();
    await expect(
      panel.locator('.layer-manager-item-name', { hasText: 'Landmarks and historic buildings' }),
    ).toBeVisible();
    await expect(page.locator('.layer-manager-item')).toHaveCount(3);
    await expect(page.locator('.layer-manager-details')).toBeVisible();

    errors.assertNoErrors();
  });

  test('renders annotation editing controls in a real browser', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openFixture(page, 'annotations');

    const panel = page.locator('.annotation-panel');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(page.getByRole('button', { name: 'Area' })).toHaveClass(/active/);
    await expect(page.locator('.annotation-layer-field select')).toHaveValue('citywalk');
    await expect(page.getByText('Routing endpoint')).toBeHidden();
    await expect(page.locator('#map')).toHaveAttribute('data-annotation-picker-active', 'true');

    await page.getByRole('button', { name: 'Select' }).click();
    await expect(page.locator('#map')).toHaveAttribute('data-annotation-picker-active', 'false');

    errors.assertNoErrors();
  });

  test('renders the canned sharing surface fixture', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openFixture(page, 'sharing');

    await expect(page.locator('.collab-panel')).toHaveAttribute('data-expanded', 'true');
    await expect(page.locator('.collab-room-context-name')).toHaveText('#shanghai-citywalk');
    await expect(page.getByText('Persistent room')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close sharing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'General access' })).toHaveValue('edit');
    await expect(page.getByText('mei-citywalk')).toBeVisible();
    await expect(page.getByText('lin-camera')).toBeVisible();
    await expect(page.locator('.collab-grant-row', { hasText: 'alex-rail' })).toHaveAttribute('data-pending', 'true');
    await expect(page.locator('.collab-grant-row', { hasText: 'alex-rail' }).getByText('Pending')).toBeVisible();

    errors.assertNoErrors();
  });

  test('keeps long sharing member lists scrollable inside the panel', async ({ page }) => {
    const errors = await installBrowserErrorWatch(page);

    await openFixture(page, 'sharing', { grants: 'long' });

    const panel = page.locator('.collab-panel');
    const grantsList = page.locator('.collab-grants-list');
    const lastMember = page.locator('.collab-grant-row', { hasText: 'member-rail-36' });
    await expect(page.locator('.collab-grant-row')).toHaveCount(36);
    await expect(page.getByText('member-rail-01')).toBeVisible();
    await expect.poll(async () => grantsList.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect
      .poll(async () =>
        lastMember.evaluate((node) => {
          const row = node.getBoundingClientRect();
          const list = node.parentElement?.getBoundingClientRect();
          return Boolean(list && row.top >= list.top && row.bottom <= list.bottom);
        }),
      )
      .toBe(false);

    await grantsList.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(async () =>
        lastMember.evaluate((node) => {
          const row = node.getBoundingClientRect();
          const list = node.parentElement?.getBoundingClientRect();
          return Boolean(list && row.top >= list.top && row.bottom <= list.bottom);
        }),
      )
      .toBe(true);
    await expectLocatorInsideViewport(panel, 'long sharing panel');
    await expectNoVisibleInteractiveElementOverflow(page, '#map');

    errors.assertNoErrors();
  });
});
