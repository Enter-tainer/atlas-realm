import { FILE_CONTENT_BINARY_VERSION, MAX_FILE_CONTENT_BYTES } from './room-constants.js';
import type { FileContentFrame } from './room-types.js';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function sanitizeContentHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hash = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

export function normalizeBinaryMessage(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  return null;
}

export function decodeFileContentFrame(message: unknown): FileContentFrame | null {
  const bytes = normalizeBinaryMessage(message);
  if (!bytes || bytes.byteLength < 2 || bytes[0] !== FILE_CONTENT_BINARY_VERSION) return null;
  const hashLength = bytes[1];
  if (bytes.byteLength < 2 + hashLength) return null;
  const contentHash = sanitizeContentHash(textDecoder.decode(bytes.slice(2, 2 + hashLength)));
  if (!contentHash) return null;
  const content = bytes.slice(2 + hashLength);
  if (content.byteLength > MAX_FILE_CONTENT_BYTES) return null;
  return { contentHash, content };
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function encodeFileContentFrame(contentHash: string, content: Uint8Array | ArrayBuffer): Uint8Array {
  const hashBytes = textEncoder.encode(contentHash);
  const payload = content instanceof Uint8Array ? content : new Uint8Array(content);
  const buffer = new Uint8Array(2 + hashBytes.byteLength + payload.byteLength);
  buffer[0] = FILE_CONTENT_BINARY_VERSION;
  buffer[1] = hashBytes.byteLength;
  buffer.set(hashBytes, 2);
  buffer.set(payload, 2 + hashBytes.byteLength);
  return buffer;
}
