import { isBot, toCacheKey, parseMapPath } from './og-utils.js';
import { ensureTable, getCachedImage, setCachedImage } from './og-cache.js';
import { takeScreenshot } from './og-screenshot.js';
import { ogHtml } from './og-html.js';

const OG_CACHE_VERSION = 'v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parsed = parseMapPath(url.pathname);

    // /og-image/:zoom/:lat/:lng.png → 返回截图
    if (parsed?.type === 'og-image') {
      return handleOgImage(parsed, url, env, ctx);
    }

    // /:zoom/:lat/:lng + bot → 返回 OG HTML
    if (parsed?.type === 'map' && isBot(request.headers.get('user-agent'))) {
      const cacheKey = toCacheKey(parsed.zoom, parsed.lat, parsed.lng);
      const baseUrl = url.origin;
      return new Response(ogHtml(baseUrl, parsed.zoom, parsed.lat, parsed.lng, cacheKey), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // 其他请求 → SPA
    return env.ASSETS.fetch(request);
  },
};

async function handleOgImage(parsed, url, env, ctx) {
  const cacheKey = toCacheKey(parsed.zoom, parsed.lat, parsed.lng);

  try {
    await ensureTable(env.DB);

    // 查缓存
    const cached = await getCachedImage(env.DB, cacheKey, OG_CACHE_VERSION);
    if (cached) {
      return new Response(cached, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
        },
      });
    }

    // 截图
    const screenshotUrl = `${url.origin}/${cacheKey}`;
    const image = await takeScreenshot(env.BROWSER, screenshotUrl);

    // 存缓存（用 waitUntil 确保即使客户端断开也会保存）
    const cachePromise = setCachedImage(env.DB, cacheKey, image, OG_CACHE_VERSION);
    ctx.waitUntil(cachePromise);

    return new Response(image, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('OG image error:', err);
    return new Response('Screenshot failed', { status: 500 });
  }
}
