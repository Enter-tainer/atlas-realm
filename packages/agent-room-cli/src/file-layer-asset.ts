import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MAX_FILE_CONTENT_BYTES } from './constants.js';
import { summarizeGeoJson, summarizeGpx } from './geojson-summary.js';
import { clamp, coerceBoolean, normalizeColor, normalizeId, normalizeName, randomId } from './validation.js';
import type { FileLayerType, JsonRecord, FileLayerAsset, FileLayerSummary } from './types.js';

export function inferFileLayerType(file: string, explicit?: unknown): FileLayerType {
  if (explicit === 'gpx' || explicit === 'geojson') return explicit;
  return /\.gpx$/i.test(file) ? 'gpx' : 'geojson';
}

export function idFromFilename(file: string): string {
  const stem = basename(file, extname(file))
    .toLowerCase()
    .replace(/[^0-9a-z_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalizeId(stem) ? `file-${stem}` : randomId('file');
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function buildFileLayerAsset(
  file: string,
  options: JsonRecord = {},
  now = Date.now(),
): Promise<FileLayerAsset> {
  const type = inferFileLayerType(file, options.type);
  const fileBytes = await readFile(file);
  return buildFileLayerAssetFromText(file, fileBytes.toString('utf8'), { ...options, type }, now);
}

export function buildFileLayerAssetFromText(
  file: string,
  rawInput: string,
  options: JsonRecord = {},
  now = Date.now(),
): FileLayerAsset {
  const type = inferFileLayerType(file, options.type);
  const id = normalizeId(options.id, idFromFilename(file));
  const name = normalizeName(options.name, basename(file));
  const visible = coerceBoolean(options.visible, true) !== false;
  const color = normalizeColor(options.color, '#3b82f6');
  const opacity = clamp(options.opacity, 0.2, 1, 0.95);
  const lineWidth = clamp(options.lineWidth, 1, 12, 5);

  let rawText = rawInput;
  let summary: FileLayerSummary = {};
  if (type === 'geojson') {
    const geojson = JSON.parse(rawInput);
    rawText = JSON.stringify(geojson);
    summary = summarizeGeoJson(geojson);
  } else {
    summary = summarizeGpx(rawInput);
  }

  const rawBytes = Buffer.from(rawText, 'utf8');
  const compressed = gzipSync(rawBytes);
  if (compressed.byteLength > MAX_FILE_CONTENT_BYTES) {
    throw new Error(`File layer content is too large after gzip: ${compressed.byteLength} bytes`);
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
    createdAt: now,
    updatedAt: now,
    ...summary,
  };
  return { manifest, content: new Uint8Array(compressed) };
}
