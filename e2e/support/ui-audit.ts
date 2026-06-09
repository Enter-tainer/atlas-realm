import { expect, type Locator, type Page } from '@playwright/test';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export async function expectLocatorInsideViewport(locator: Locator, label: string) {
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const viewport = locator.page().viewportSize();
        if (!box || !viewport) return null;
        return {
          left: box.x >= 0,
          top: box.y >= 0,
          right: box.x + box.width <= viewport.width + 1,
          bottom: box.y + box.height <= viewport.height + 1,
        };
      },
      { message: `${label} should stay inside the viewport` },
    )
    .toEqual({ left: true, top: true, right: true, bottom: true });
}

export async function expectLocatorOperable(locator: Locator, label: string, expected = true) {
  await expect
    .poll(
      async () => {
        return await locator.evaluate((node) => {
          const element = node as HTMLElement;
          const style = window.getComputedStyle(element);
          const opacity = Number(style.opacity);
          return {
            operable:
              !element.hidden &&
              element.getAttribute('aria-hidden') !== 'true' &&
              style.visibility !== 'hidden' &&
              style.pointerEvents !== 'none' &&
              Number.isFinite(opacity) &&
              opacity > 0.5,
          };
        });
      },
      { message: `${label} should ${expected ? '' : 'not '}be operable` },
    )
    .toMatchObject({ operable: expected });
}

export async function expectNoVisibleInteractiveElementOverflow(page: Page, selector = 'body') {
  const overflow = await page.locator(selector).evaluate((root) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const interactiveSelector = [
      'button',
      'input',
      'select',
      'textarea',
      'a[href]',
      '[role="button"]',
      '[role="option"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const rootElement = root instanceof Document ? root.body : root;
    const nodes = Array.from(rootElement.querySelectorAll<HTMLElement>(interactiveSelector));
    const failures: Rect[] = [];
    const intersect = (a: DOMRect, b: DOMRect) => {
      const left = Math.max(a.left, b.left);
      const top = Math.max(a.top, b.top);
      const right = Math.min(a.right, b.right);
      const bottom = Math.min(a.bottom, b.bottom);
      return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
    };
    for (const node of nodes) {
      const style = window.getComputedStyle(node);
      const hidden =
        node.hidden ||
        node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none' ||
        Number(style.opacity) === 0;
      if (hidden) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      let visibleRect = rect;
      for (let parent = node.parentElement; parent && rootElement.contains(parent); parent = parent.parentElement) {
        const parentStyle = window.getComputedStyle(parent);
        const clipsX = ['auto', 'scroll', 'hidden', 'clip'].includes(parentStyle.overflowX);
        const clipsY = ['auto', 'scroll', 'hidden', 'clip'].includes(parentStyle.overflowY);
        if (!clipsX && !clipsY) continue;
        const parentRect = parent.getBoundingClientRect();
        visibleRect = intersect(visibleRect, parentRect) as DOMRect;
        if (visibleRect.width <= 0 || visibleRect.height <= 0) break;
      }
      if (visibleRect.width <= 0 || visibleRect.height <= 0) continue;
      const outside =
        visibleRect.left < -1 ||
        visibleRect.top < -1 ||
        visibleRect.right > viewportWidth + 1 ||
        visibleRect.bottom > viewportHeight + 1;
      if (!outside) continue;
      failures.push({
        x: Number(visibleRect.left.toFixed(1)),
        y: Number(visibleRect.top.toFixed(1)),
        width: Number(visibleRect.width.toFixed(1)),
        height: Number(visibleRect.height.toFixed(1)),
        label:
          node.getAttribute('aria-label') || node.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || node.tagName,
      });
    }
    return failures;
  });
  expect(overflow, 'visible interactive elements should stay inside the viewport').toEqual([]);
}

export async function expectViewportHasNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));
  expect(overflow.scrollWidth, 'document should not horizontally overflow').toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
  expect(overflow.bodyScrollWidth, 'body should not horizontally overflow').toBeLessThanOrEqual(
    overflow.bodyClientWidth + 1,
  );
}

export async function expectCenterPointReceivesMap(page: Page) {
  const hit = await page.locator('#map').evaluate((map) => {
    const rect = map.getBoundingClientRect();
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      tagName: element?.tagName || '',
      className: typeof element?.className === 'string' ? element.className : '',
      id: element?.id || '',
      isInsideMap: Boolean(element && map.contains(element)),
    };
  });
  expect(hit.isInsideMap, `map center should hit the map, got ${JSON.stringify(hit)}`).toBe(true);
}
