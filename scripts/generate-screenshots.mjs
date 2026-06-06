import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(new URL('..', import.meta.url).pathname);
const distDir = join(root, 'dist/client');
const workerBuildDir = join(root, 'dist/orm_pmtiles_demo');
const workerMain = join(workerBuildDir, 'index.js');
const workerBuildConfig = join(workerBuildDir, 'wrangler.json');
const workerScreenshotConfig = join(workerBuildDir, 'wrangler.screenshots.json');
const outputDir = resolve(root, process.env.SCREENSHOT_OUTPUT_DIR || 'docs/screenshots');
const agentBrowserBin = join(root, 'node_modules/.bin/agent-browser');
const port = Number(process.env.SCREENSHOT_PORT || 4177);
const host = '127.0.0.1';
const externalBaseUrl = String(process.env.SCREENSHOT_BASE_URL || '').trim();
const useStaticServer = process.env.SCREENSHOT_SERVER === 'static';
const requestedLocale = String(process.env.SCREENSHOT_LOCALE || '').trim();
const webpQuality = Number(process.env.SCREENSHOT_WEBP_QUALITY || 82);
const screenshotLocales = requestedLocale
  ? [{ locale: requestedLocale, dir: localeOutputDir(requestedLocale) }]
  : [
      { locale: 'en-US', dir: 'en' },
      { locale: 'zh-CN', dir: 'zh-CN' },
    ];

const shots = [
  {
    mode: 'overview',
    file: 'overview-desktop.webp',
    label: 'Desktop overview',
    viewport: [1440, 960],
  },
  {
    mode: 'overview',
    file: 'overview-mobile.webp',
    label: 'Mobile overview',
    viewport: [390, 844],
  },
  {
    mode: 'layers',
    file: 'layers.webp',
    label: 'Layer manager',
    viewport: [1280, 860],
  },
  {
    mode: 'annotations',
    file: 'annotations.webp',
    label: 'Annotation tools',
    viewport: [1280, 860],
  },
  {
    mode: 'sharing',
    file: 'sharing.webp',
    label: 'Room sharing',
    viewport: [1280, 860],
  },
];

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: options.stdio || 'inherit',
      env: {
        ...process.env,
        CI: process.env.CI || '1',
        ...options.env,
      },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

function localeOutputDir(locale) {
  return /^zh\b/i.test(locale) ? 'zh-CN' : 'en';
}

function agentBrowser(locale, args) {
  return run(
    agentBrowserBin,
    ['--session', `atlas-realm-screenshots-${localeOutputDir(locale)}`, '--args', `--lang=${locale}`, ...args],
    { stdio: 'inherit' },
  );
}

function screenshotUrl(mode, locale) {
  const url = new URL(externalBaseUrl || `http://${host}:${port}/`);
  url.searchParams.set('screenshot', mode);
  url.searchParams.set('screenshotLocale', locale);
  url.searchParams.set('room', url.searchParams.get('room') || 'demo');
  url.hash = '';
  return url.href;
}

async function captureScreenshot(locale, url, output) {
  const pngOutput = `${output}.tmp.png`;
  await agentBrowser(locale, ['open', url]);
  await agentBrowser(locale, ['wait', '--fn', "document.body.dataset.screenshotReady === 'true'"]);
  await agentBrowser(locale, ['wait', '250']);
  await agentBrowser(locale, ['screenshot', pngOutput]);
  await sharp(pngOutput).webp({ quality: webpQuality }).toFile(output);
  await rm(pngOutput, { force: true });
}

async function waitForHttp(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

async function serveFile(pathname) {
  if (pathname.startsWith('/tiles/')) {
    // Keep screenshots honest: this static server does not fake PMTiles.
    return {
      status: 404,
      bytes: Buffer.from('Tile archive is not available in the screenshot server.'),
      contentType: 'text/plain; charset=utf-8',
    };
  }

  const safePath = pathname
    .split('\u0000')
    .join('')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '..')
    .join('/');
  const target = join(distDir, safePath || 'index.html');
  try {
    return { status: 200, bytes: await readFile(target), path: target };
  } catch {
    return { status: 200, bytes: await readFile(join(distDir, 'index.html')), path: join(distDir, 'index.html') };
  }
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${host}:${port}`);
      const served = await serveFile(url.pathname);
      response.writeHead(served.status, {
        'Content-Type': served.contentType || contentTypes[extname(served.path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(served.bytes);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Server error');
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(port, host, () =>
      resolvePromise({
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      }),
    );
  });
}

async function writeScreenshotWorkerConfig() {
  const builtConfig = JSON.parse(await readFile(workerBuildConfig, 'utf8'));
  const screenshotConfig = {
    name: builtConfig.name || 'atlas-realm',
    main: 'index.js',
    compatibility_date: builtConfig.compatibility_date,
    compatibility_flags: builtConfig.compatibility_flags,
    rules: builtConfig.rules,
    assets: builtConfig.assets,
    durable_objects: builtConfig.durable_objects,
    migrations: builtConfig.migrations,
    r2_buckets: (builtConfig.r2_buckets || []).map((bucket) =>
      bucket.binding === 'ORM_BUCKET' ? { ...bucket, remote: true } : bucket,
    ),
    d1_databases: builtConfig.d1_databases,
    observability: builtConfig.observability,
    no_bundle: true,
  };
  await writeFile(workerScreenshotConfig, `${JSON.stringify(screenshotConfig, null, 2)}\n`);
  return workerScreenshotConfig;
}

async function startWorkerServer() {
  const configPath = await writeScreenshotWorkerConfig();
  const args = [
    'exec',
    'wrangler',
    'dev',
    '--config',
    configPath,
    '--ip',
    host,
    '--port',
    String(port),
    '--log-level',
    'error',
    '--show-interactive-dev-session=false',
  ];
  const child = spawn('pnpm', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CI: process.env.CI || '1',
    },
  });

  const logs = [];
  const workerExitError = (code) => {
    const text = logs.join('');
    if (/must be logged in|wrangler login/i.test(text)) {
      return new Error(
        [
          'Wrangler remote preview needs Cloudflare authentication to read the remote ORM R2 bucket.',
          'Run `wrangler login`, provide a Cloudflare API token, or use `SCREENSHOT_BASE_URL` to point at an already running app.',
          'For UI-only layout checks without ORM tiles, run with `SCREENSHOT_SERVER=static`.',
          text.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
    return new Error(`wrangler dev exited with ${code}\n${text}`);
  };
  const remember = (chunk) => {
    const text = chunk.toString();
    if (text.trim()) logs.push(text);
    while (logs.length > 20) logs.shift();
  };
  child.stdout.on('data', remember);
  child.stderr.on('data', remember);

  let exited = false;
  let exitCode = null;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  await Promise.race([
    waitForHttp(`http://${host}:${port}/`),
    new Promise((_, reject) => {
      child.on('exit', (code) => reject(workerExitError(code)));
      child.on('error', reject);
    }),
  ]);

  if (exited) throw workerExitError(exitCode);

  return {
    close: () =>
      new Promise((resolvePromise) => {
        child.once('exit', () => resolvePromise());
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolvePromise();
        }, 3_000).unref();
      }),
  };
}

async function main() {
  const skipBuild = process.argv.includes('--no-build');
  if (!externalBaseUrl && !skipBuild) {
    await run('pnpm', ['build'], { env: { SCREENSHOT_FIXTURES: '1' } });
  }
  if (!externalBaseUrl && !existsSync(distDir)) {
    throw new Error(`Missing build output: ${distDir}. Run pnpm build or omit --no-build.`);
  }
  if (!externalBaseUrl && !useStaticServer && !existsSync(workerMain)) {
    throw new Error(`Missing Worker build output: ${workerMain}. Run pnpm build or omit --no-build.`);
  }

  await mkdir(outputDir, { recursive: true });
  const server = externalBaseUrl ? null : useStaticServer ? await startServer() : await startWorkerServer();

  try {
    for (const { locale, dir } of screenshotLocales) {
      const localeOutputDirPath = join(outputDir, dir);
      await mkdir(localeOutputDirPath, { recursive: true });
      await agentBrowser(locale, ['close']).catch(() => {});
      await agentBrowser(locale, ['set', 'media', 'light', 'reduced-motion']);

      for (const shot of shots) {
        await agentBrowser(locale, ['set', 'viewport', String(shot.viewport[0]), String(shot.viewport[1])]);
        const url = screenshotUrl(shot.mode, locale);
        const output = join(localeOutputDirPath, shot.file);
        console.log(`Capturing ${shot.label} (${locale}): ${output}`);
        await captureScreenshot(locale, url, output);
      }
    }
  } finally {
    for (const { locale } of screenshotLocales) await agentBrowser(locale, ['close']).catch(() => {});
    if (server) await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
