import type { OverlayBinaryFrame } from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeOverlayBinaryMessage(
  contentHash: string,
  contentBytes: Uint8Array | ArrayBufferLike,
): Uint8Array {
  const hashBytes = textEncoder.encode(contentHash);
  if (hashBytes.byteLength > 255) throw new Error('content hash is too long');
  const payload = contentBytes instanceof Uint8Array ? contentBytes : new Uint8Array(contentBytes);
  const buffer = new Uint8Array(2 + hashBytes.byteLength + payload.byteLength);
  buffer[0] = 1;
  buffer[1] = hashBytes.byteLength;
  buffer.set(hashBytes, 2);
  buffer.set(payload, 2 + hashBytes.byteLength);
  return buffer;
}

export function decodeOverlayBinaryMessage(data: unknown): OverlayBinaryFrame | null {
  const bytes = normalizeBinary(data);
  if (!bytes || bytes.byteLength < 2 || bytes[0] !== 1) return null;
  const hashLength = bytes[1];
  if (bytes.byteLength < 2 + hashLength) return null;
  return {
    contentHash: textDecoder.decode(bytes.slice(2, 2 + hashLength)),
    content: bytes.slice(2 + hashLength),
  };
}

function normalizeBinary(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
