import { addGpxToMap, addGeoJsonToMap, mergeBounds } from './gpx.js';

export const OVERLAY_SYNC_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function stripRuntimeOverlayFields(overlay) {
  const {
    layerIds,
    sourceId,
    data,
    rawText,
    remoteOverlayId,
    syncOverlayId,
    ...manifest
  } = overlay || {};
  const id = syncOverlayId || remoteOverlayId || manifest.id;
  return {
    ...manifest,
    id,
    name: normalizeString(manifest.name, id || 'Overlay'),
    visible: manifest.visible !== false,
  };
}

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function streamToUint8Array(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatUint8Arrays(chunks);
}

async function gzipBytes(bytes) {
  if (!globalThis.CompressionStream) return { bytes, encoding: 'identity' };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: await streamToUint8Array(stream), encoding: 'gzip' };
}

async function gunzipBytes(bytes, encoding) {
  if (encoding !== 'gzip') return bytes;
  if (!globalThis.DecompressionStream) {
    throw new Error('This browser cannot decompress shared overlays');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return streamToUint8Array(stream);
}

function isGzip(bytes) {
  return bytes?.[0] === GZIP_MAGIC_0 && bytes?.[1] === GZIP_MAGIC_1;
}

export async function buildOverlaySyncAsset(overlay, options = {}) {
  if (!overlay?.id || !overlay?.data) return null;

  const manifest = {
    ...stripRuntimeOverlayFields(overlay),
    syncVersion: 1,
    persistence: 'ephemeral',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...options.manifest,
  };
  const contentType = overlay.type === 'gpx' ? 'application/gpx+xml' : 'application/geo+json';
  const rawText = overlay.type === 'gpx' && typeof overlay.rawText === 'string'
    ? overlay.rawText
    : JSON.stringify(overlay.data);
  const rawBytes = TEXT_ENCODER.encode(rawText);
  const compressed = await gzipBytes(rawBytes);
  if (compressed.bytes.byteLength > OVERLAY_SYNC_MAX_COMPRESSED_BYTES) {
    throw new Error('Overlay is too large to sync');
  }
  const hash = arrayBufferToHex(await crypto.subtle.digest('SHA-256', compressed.bytes));

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

export function encodeOverlayBinaryMessage(contentHash, contentBytes) {
  const hashBytes = TEXT_ENCODER.encode(contentHash);
  if (hashBytes.byteLength > 255) throw new Error('content hash is too long');
  const buffer = new Uint8Array(2 + hashBytes.byteLength + contentBytes.byteLength);
  buffer[0] = 1;
  buffer[1] = hashBytes.byteLength;
  buffer.set(hashBytes, 2);
  buffer.set(contentBytes, 2 + hashBytes.byteLength);
  return buffer;
}

export function decodeOverlayBinaryMessage(message) {
  const bytes = message instanceof Uint8Array
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

export async function materializeOverlayContent(manifest, content) {
  const compressed = content instanceof Uint8Array ? content : new Uint8Array(content);
  const encoding = manifest.contentEncoding || (isGzip(compressed) ? 'gzip' : 'identity');
  const rawBytes = await gunzipBytes(compressed, encoding);
  const text = TEXT_DECODER.decode(rawBytes);
  if (manifest.type === 'gpx') return text;
  return JSON.parse(text);
}

export async function addSyncedOverlayToMap(map, manifest, content) {
  const payload = await materializeOverlayContent(manifest, content);
  const options = { name: manifest.name, remote: true };
  let overlay = null;
  if (manifest.type === 'gpx') {
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

export function overlayManifestPatch(overlay) {
  return stripRuntimeOverlayFields(overlay);
}

export function mergeOverlayBounds(overlays) {
  return overlays.reduce((bounds, overlay) => mergeBounds(bounds, overlay.bounds), null);
}
