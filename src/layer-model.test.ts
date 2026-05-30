import { describe, expect, it } from 'vitest';
import { sanitizeLayer } from './layer-model.js';

describe('layer model', () => {
  it('preserves fallback visibility when a patch omits visible', () => {
    const base = {
      id: 'layer-a',
      kind: 'annotation' as const,
      name: 'Hidden layer',
      visible: false,
      sortKey: '000010',
      payload: { version: 1 as const },
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
    };

    expect(sanitizeLayer({ ...base, visible: undefined, name: 'Renamed' }, 1001, base)).toMatchObject({
      name: 'Renamed',
      visible: false,
    });
  });
});
