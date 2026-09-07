import { describe, expect, it } from 'vitest';
import { activeAgentParticipants, anonymousGuestName, collaborationCanEditForAccess } from './collaboration.js';

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

describe('collaboration guest names', () => {
  it('assigns stable anonymous names per room and guest seed', () => {
    const first = anonymousGuestName('trip-planning', 'guest-a');
    const again = anonymousGuestName('trip-planning', 'guest-a');
    const otherGuest = anonymousGuestName('trip-planning', 'guest-b');

    expect(first).toBe(again);
    expect(first).toMatch(/^Anonymous [A-Z][a-z]+$/);
    expect(otherGuest).toMatch(/^Anonymous [A-Z][a-z]+$/);
  });
});

describe('collaboration access capabilities', () => {
  it('does not expose editing once access is loaded without view permission', () => {
    expect(collaborationCanEditForAccess({ canView: false, canEdit: false }, false)).toBe(true);
    expect(collaborationCanEditForAccess({ canView: false, canEdit: true }, true)).toBe(false);
    expect(collaborationCanEditForAccess({ canView: true, canEdit: false }, true)).toBe(false);
    expect(collaborationCanEditForAccess({ canView: true, canEdit: true }, true)).toBe(true);
  });
});
