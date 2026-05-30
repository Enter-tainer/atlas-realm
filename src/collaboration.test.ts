import { describe, expect, it } from 'vitest';
import { activeAgentParticipants, shouldSyncKnownLocalLayer } from './collaboration.js';
import { ANNOTATION_DEFAULT_LAYER_ID } from './annotation-model.js';
import type { Layer } from './layer-model.js';

const NOW = 1_700_000_000_000;

function agent(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user: { id, name: id, color: '#4f46e5' },
    clientType: 'agent' as const,
    active: true,
    lastSeenAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    lastAction: 'connect',
    ...extra,
  };
}

function annotationLayer(id: string, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    kind: 'annotation',
    name: 'Annotations',
    visible: true,
    sortKey: '000010',
    payload: { version: 1 },
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

describe('collaboration agent presence', () => {
  it('keeps only agents that are active and not expired at render time', () => {
    expect(
      activeAgentParticipants(
        [
          agent('active-agent'),
          agent('inactive-agent', { active: false }),
          agent('expired-agent', { expiresAt: NOW - 1 }),
        ],
        NOW,
      ).map((item) => item.id),
    ).toEqual(['active-agent']);
  });
});

describe('collaboration local layer sync', () => {
  it('does not upload the implicit empty default annotation layer on connect', () => {
    expect(shouldSyncKnownLocalLayer(annotationLayer(ANNOTATION_DEFAULT_LAYER_ID), 0)).toBe(false);
    expect(shouldSyncKnownLocalLayer(annotationLayer(ANNOTATION_DEFAULT_LAYER_ID), 1)).toBe(true);
    expect(shouldSyncKnownLocalLayer(annotationLayer(ANNOTATION_DEFAULT_LAYER_ID, { revision: 1 }), 0)).toBe(true);
    expect(shouldSyncKnownLocalLayer(annotationLayer('annotation-layer-a'), 0)).toBe(true);
  });
});
