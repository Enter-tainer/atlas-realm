import puppeteer from '@cloudflare/puppeteer';

const SCREENSHOT_WIDTH = 1200;
const SCREENSHOT_HEIGHT = 630;
const WAIT_TIMEOUT_MS = 15000;

export async function takeScreenshot(browserBinding, pageUrl) {
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT });
    await page.goto(pageUrl, { waitUntil: 'load', timeout: WAIT_TIMEOUT_MS });
    await page.waitForFunction(() => window.__MAP_READY === true, { timeout: WAIT_TIMEOUT_MS });
    const screenshot = await page.screenshot({ type: 'png' });
    return screenshot;
  } finally {
    await browser.close();
  }
}
