import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const host = process.env.SCREENSHOT_FIXTURE_HOST || 'https://map.mgt.moe';
const room = process.env.SCREENSHOT_FIXTURE_ROOM || 'shanghai-citywalk';
const outputPath = resolve(root, process.env.SCREENSHOT_FIXTURE_OUTPUT || 'src/screenshot-fixture-data.ts');
const routeIds = ['walk-wukang-anfu', 'metro-line10', 'walk-nanjing-bund'];

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, CI: process.env.CI || '1' },
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

function parseSnapshot(output) {
  const lines = output.split(/\n/);
  const compactLine = lines.find((line) => line.trim().startsWith('{"ok"'));
  if (compactLine) return JSON.parse(compactLine);
  const start = output.indexOf('{');
  if (start < 0) throw new Error('Room snapshot did not include JSON output.');
  return JSON.parse(output.slice(start));
}

function annotationList(snapshot) {
  const byId = new Map();
  for (const annotation of snapshot.annotations || []) byId.set(annotation.id, annotation);
  for (const content of snapshot.layerContents || []) {
    for (const annotation of content.annotations || []) byId.set(annotation.id, annotation);
  }
  return byId;
}

function exportedName(id) {
  return `${id.replace(/-/g, '_').toUpperCase()}_POINTS`;
}

function coordArray(name, points) {
  const rows = points.map(([lng, lat]) => `  [${lng}, ${lat}],`).join('\n');
  return `export const ${name}: [number, number][] = [\n${rows}\n];`;
}

async function main() {
  const output = await run('pnpm', [
    'atlas:realm',
    '--host',
    host,
    '--room',
    room,
    '--client-id',
    'screenshot-fixture-refresh',
    '--client-type',
    'query',
    '--timeout',
    '30000',
    'snapshot',
    '--content',
    '--json',
  ]);
  const snapshot = parseSnapshot(output);
  const annotations = annotationList(snapshot);
  const sections = [
    '// Generated from the shanghai-citywalk room snapshot.',
    '// Run `pnpm screenshots:fixture` after updating the remote room.',
  ];

  for (const id of routeIds) {
    const annotation = annotations.get(id);
    const points = annotation?.payload?.points;
    if (!Array.isArray(points) || points.length < 2) throw new Error(`Missing route points for ${id}.`);
    sections.push(coordArray(exportedName(id), points));
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${sections.join('\n\n')}\n`);
  console.log(`Updated ${join('.', outputPath.slice(root.length))}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
