import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MAX_OVERLAY_CONTENT_BYTES } from './constants.js';
import { summarizeGeoJson, summarizeGpx } from './geojson-summary.js';
import { clamp, coerceBoolean, normalizeColor, normalizeId, normalizeName, randomId } from './validation.js';
import type { JsonRecord, OverlayAsset, OverlayPersistence, OverlaySummary, OverlayType } from './types.js';

export function inferOverlayType(file: string, explicit?: unknown): OverlayType {
  if (explicit === 'gpx' || explicit === 'geojson') return explicit;
  return /\.gpx$/i.test(file) ? 'gpx' : 'geojson';
}

export function idFromFilename(file: string): string {
  const stem = basename(file, extname(file))
    .toLowerCase()
    .replace(/[^0-9a-z_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalizeId(stem) ? `overlay-${stem}` : randomId('overlay');
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function buildOverlayAsset(
  file: string,
  options: JsonRecord = {},
  now = Date.now(),
): Promise<OverlayAsset> {
  const type = inferOverlayType(file, options.type);
  const fileBytes = await readFile(file);
  return buildOverlayAssetFromText(file, fileBytes.toString('utf8'), { ...options, type }, now);
}

export function buildOverlayAssetFromText(
  file: string,
  rawInput: string,
  options: JsonRecord = {},
  now = Date.now(),
): OverlayAsset {
  const type = inferOverlayType(file, options.type);
  const id = normalizeId(options.id, idFromFilename(file));
  const name = normalizeName(options.name, basename(file));
  const visible = coerceBoolean(options.visible, true) !== false;
  const color = normalizeColor(options.color, '#3b82f6');
  const opacity = clamp(options.opacity, 0.2, 1, 0.95);
  const lineWidth = clamp(options.lineWidth, 1, 12, 5);
  const persistence: OverlayPersistence = options.persistence === 'persistent' ? 'persistent' : 'ephemeral';

  let rawText = rawInput;
  let summary: OverlaySummary = {};
  if (type === 'geojson') {
    const geojson = JSON.parse(rawInput);
    rawText = JSON.stringify(geojson);
    summary = summarizeGeoJson(geojson);
  } else {
    summary = summarizeGpx(rawInput);
  }

  const rawBytes = Buffer.from(rawText, 'utf8');
  const compressed = gzipSync(rawBytes);
  if (compressed.byteLength > MAX_OVERLAY_CONTENT_BYTES) {
    throw new Error(`Overlay content is too large after gzip: ${compressed.byteLength} bytes`);
  }
  const contentHash = sha256Hex(compressed);
  const manifest = {
    id,
    type,
    name,
    visible,
    color,
    opacity,
    lineWidth,
    bounds: summary.bounds || null,
    contentHash,
    contentType: type === 'gpx' ? 'application/gpx+xml' : 'application/geo+json',
    contentEncoding: 'gzip',
    contentByteLength: compressed.byteLength,
    rawByteLength: rawBytes.byteLength,
    syncVersion: 1,
    persistence,
    createdAt: now,
    updatedAt: now,
    ...summary,
  };
  return { manifest, content: new Uint8Array(compressed) };
}
