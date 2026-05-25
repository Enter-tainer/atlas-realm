import { addGpxToMap, addGeoJsonToMap, mergeBounds } from './gpx.js';

export const OVERLAY_SYNC_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

type OverlayType = 'gpx' | 'geojson';
type OverlayContentEncoding = 'gzip' | 'identity';
type OverlayBounds = [[number, number], [number, number]];
type JsonRecord = Record<string, unknown>;
export type OverlayContent = string | object;
type OverlayMapLike = Parameters<typeof addGpxToMap>[0];

export interface OverlayManifest extends JsonRecord {
  id: string;
  type: OverlayType;
  name: string;
  visible: boolean;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  bounds?: OverlayBounds | null;
  contentHash?: string;
  contentType?: string;
  contentEncoding?: OverlayContentEncoding;
  contentByteLength?: number;
  rawByteLength?: number;
  syncVersion?: number;
  persistence?: 'ephemeral' | 'persistent';
}

interface RuntimeOverlay extends Partial<OverlayManifest> {
  id: string;
  data: OverlayContent;
  rawText?: string;
  layerIds?: string[];
  sourceId?: string;
  remoteOverlayId?: string;
  syncOverlayId?: string;
}

interface BuildOverlaySyncAssetOptions {
  manifest?: Partial<OverlayManifest>;
}

export interface OverlaySyncAsset {
  envelope: {
    id: string;
    manifest: OverlayManifest & {
      contentHash: string;
      contentType: string;
      contentEncoding: OverlayContentEncoding;
      contentByteLength: number;
      rawByteLength: number;
    };
  };
  content: Uint8Array;
}

export interface OverlayBinaryMessage {
  contentHash: string;
  content: Uint8Array;
}

function normalizeString(value: unknown, fallback = '') {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function isRuntimeOverlay(value: unknown): value is RuntimeOverlay {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'data' in value);
}

function stripRuntimeOverlayFields(overlay: Partial<RuntimeOverlay | OverlayManifest>): OverlayManifest {
  const { remoteOverlayId, syncOverlayId, ...manifestWithRuntimeFields } = overlay || {};
  delete manifestWithRuntimeFields.layerIds;
  delete manifestWithRuntimeFields.sourceId;
  delete manifestWithRuntimeFields.data;
  delete manifestWithRuntimeFields.rawText;
  const manifest = manifestWithRuntimeFields;
  const id = syncOverlayId || remoteOverlayId || manifest.id;
  return {
    ...manifest,
    id: String(id || ''),
    type: manifest.type === 'gpx' ? 'gpx' : 'geojson',
    name: normalizeString(manifest.name, String(id || 'Overlay')),
    visible: manifest.visible !== false,
  };
}

function arrayBufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function concatUint8Arrays(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatUint8Arrays(chunks);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function gzipBytes(bytes: Uint8Array): Promise<{ bytes: Uint8Array; encoding: OverlayContentEncoding }> {
  if (!globalThis.CompressionStream) return { bytes, encoding: 'identity' };
  const stream = new Blob([bytesToArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: await streamToUint8Array(stream), encoding: 'gzip' };
}

async function gunzipBytes(bytes: Uint8Array, encoding: OverlayContentEncoding | string) {
  if (encoding !== 'gzip') return bytes;
  if (!globalThis.DecompressionStream) {
    throw new Error('This browser cannot decompress shared overlays');
  }
  const stream = new Blob([bytesToArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return streamToUint8Array(stream);
}

function isGzip(bytes: Uint8Array) {
  return bytes?.[0] === GZIP_MAGIC_0 && bytes?.[1] === GZIP_MAGIC_1;
}

export async function buildOverlaySyncAsset(
  overlay: unknown,
  options: BuildOverlaySyncAssetOptions = {},
): Promise<OverlaySyncAsset | null> {
  if (!isRuntimeOverlay(overlay)) return null;

  const manifest: OverlayManifest & {
    persistence: 'ephemeral' | 'persistent';
    syncVersion: number;
    createdAt: number;
    updatedAt: number;
  } = {
    ...stripRuntimeOverlayFields(overlay),
    syncVersion: 1,
    persistence: 'ephemeral' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...options.manifest,
  };
  const contentType = overlay.type === 'gpx' ? 'application/gpx+xml' : 'application/geo+json';
  const rawText =
    overlay.type === 'gpx' && typeof overlay.rawText === 'string' ? overlay.rawText : JSON.stringify(overlay.data);
  const rawBytes = TEXT_ENCODER.encode(rawText);
  const compressed = await gzipBytes(rawBytes);
  if (compressed.bytes.byteLength > OVERLAY_SYNC_MAX_COMPRESSED_BYTES) {
    throw new Error('Overlay is too large to sync');
  }
  const hash = arrayBufferToHex(await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(compressed.bytes)));

  return {
    envelope: {
      id: manifest.id,
      manifest: {
        ...manifest,
        contentHash: hash,
        contentType,
        contentEncoding: compressed.encoding,
        contentByteLength: compressed.bytes.byteLength,
        rawByteLength: rawBytes.byteLength,
      },
    },
    content: compressed.bytes,
  };
}

export function encodeOverlayBinaryMessage(contentHash: string, contentBytes: Uint8Array) {
  const hashBytes = TEXT_ENCODER.encode(contentHash);
  if (hashBytes.byteLength > 255) throw new Error('content hash is too long');
  const buffer = new Uint8Array(2 + hashBytes.byteLength + contentBytes.byteLength);
  buffer[0] = 1;
  buffer[1] = hashBytes.byteLength;
  buffer.set(hashBytes, 2);
  buffer.set(contentBytes, 2 + hashBytes.byteLength);
  return buffer;
}

export function decodeOverlayBinaryMessage(message: unknown): OverlayBinaryMessage | null {
  const bytes =
    message instanceof Uint8Array
      ? message
      : message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : ArrayBuffer.isView(message)
          ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
          : null;
  if (!bytes || bytes.byteLength < 2 || bytes[0] !== 1) return null;
  const hashLength = bytes[1];
  if (bytes.byteLength < 2 + hashLength) return null;
  return {
    contentHash: TEXT_DECODER.decode(bytes.slice(2, 2 + hashLength)),
    content: bytes.slice(2 + hashLength),
  };
}

export async function materializeOverlayContent(
  manifest: OverlayManifest,
  content: Uint8Array | ArrayBuffer,
): Promise<OverlayContent> {
  const compressed = content instanceof Uint8Array ? content : new Uint8Array(content);
  const encoding = manifest.contentEncoding || (isGzip(compressed) ? 'gzip' : 'identity');
  const rawBytes = await gunzipBytes(compressed, encoding);
  const text = TEXT_DECODER.decode(rawBytes);
  if (manifest.type === 'gpx') return text;
  return JSON.parse(text);
}

export async function addSyncedOverlayToMap(
  map: OverlayMapLike,
  manifest: OverlayManifest,
  content: Uint8Array | ArrayBuffer,
) {
  const payload = await materializeOverlayContent(manifest, content);
  const options = { name: manifest.name, remote: true };
  let overlay = null;
  if (manifest.type === 'gpx') {
    if (typeof payload !== 'string') return null;
    overlay = addGpxToMap(map, payload, options);
  } else {
    overlay = addGeoJsonToMap(map, payload, {
      ...options,
      color: manifest.color,
    });
  }
  if (!overlay) return null;
  return {
    ...overlay,
    ...stripRuntimeOverlayFields(manifest),
    id: overlay.id,
    remoteOverlayId: manifest.id,
    syncOverlayId: manifest.id,
    contentHash: manifest.contentHash,
  };
}

export function overlayManifestPatch(overlay: Partial<RuntimeOverlay | OverlayManifest>) {
  return stripRuntimeOverlayFields(overlay);
}

export function mergeOverlayBounds(overlays: Array<{ bounds?: OverlayBounds | null }>) {
  return overlays.reduce<OverlayBounds | null>((bounds, overlay) => mergeBounds(bounds, overlay.bounds) || null, null);
}
