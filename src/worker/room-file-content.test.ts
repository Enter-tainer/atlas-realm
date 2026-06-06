import { describe, expect, it } from 'vitest';
import { decodeFileContentFrame, encodeFileContentFrame, sanitizeContentHash } from './room-file-content.js';

const HASH = 'a'.repeat(64);

describe('worker file content frames', () => {
  it('round-trips valid binary content frames', () => {
    const content = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeFileContentFrame(HASH, content);

    expect(decodeFileContentFrame(frame)).toEqual({
      contentHash: HASH,
      content,
    });
  });

  it('rejects malformed or non-sha256 content hashes', () => {
    expect(sanitizeContentHash(` ${HASH.toUpperCase()} `)).toBe(HASH);
    expect(sanitizeContentHash('not-a-hash')).toBeNull();

    const invalidHash = new TextEncoder().encode('not-a-hash');
    const frame = new Uint8Array(2 + invalidHash.byteLength + 1);
    frame[0] = 1;
    frame[1] = invalidHash.byteLength;
    frame.set(invalidHash, 2);
    frame[frame.byteLength - 1] = 7;

    expect(decodeFileContentFrame(frame)).toBeNull();
    expect(decodeFileContentFrame(new Uint8Array([2, 0]))).toBeNull();
    expect(decodeFileContentFrame(new Uint8Array([1, 10]))).toBeNull();
  });
});
