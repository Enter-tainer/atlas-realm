import { describe, expect, it } from 'vitest';
import { activeAgentParticipants } from './collaboration.js';

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
