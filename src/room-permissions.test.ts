import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ROOM_SCHEMA_SQL,
  canEdit,
  canGrantRole,
  canManage,
  canView,
  effectiveRoomRole,
  linkAccessRole,
  roleWeight,
} from './room-permissions.js';

describe('room permission helpers', () => {
  it('maps roles and link access to monotonic weights', () => {
    expect(roleWeight('none')).toBeLessThan(roleWeight('view'));
    expect(roleWeight('view')).toBeLessThan(roleWeight('edit'));
    expect(roleWeight('edit')).toBeLessThan(roleWeight('manage'));
    expect(linkAccessRole('restricted')).toBe('none');
    expect(linkAccessRole('view')).toBe('view');
    expect(linkAccessRole('edit')).toBe('edit');
  });

  it('uses highest privilege across ownership, explicit grants, and link access', () => {
    expect(effectiveRoomRole({ grantRole: 'view', linkAccess: 'edit' })).toBe('edit');
    expect(effectiveRoomRole({ grantRole: 'edit', linkAccess: 'view' })).toBe('edit');
    expect(effectiveRoomRole({ isOwner: true, grantRole: 'view', linkAccess: 'restricted' })).toBe('manage');
    expect(effectiveRoomRole({ linkAccess: 'restricted' })).toBe('none');
  });

  it('derives capability booleans from effective role', () => {
    expect(canView('view')).toBe(true);
    expect(canEdit('view')).toBe(false);
    expect(canEdit('edit')).toBe(true);
    expect(canManage('edit')).toBe(false);
    expect(canManage('manage')).toBe(true);
    expect(canView('none')).toBe(false);
  });

  it('limits manage grants to owners in v1', () => {
    expect(canGrantRole({ actorIsOwner: true, actorRole: 'manage', targetRole: 'manage' })).toBe(true);
    expect(canGrantRole({ actorIsOwner: false, actorRole: 'manage', targetRole: 'manage' })).toBe(false);
    expect(canGrantRole({ actorIsOwner: false, actorRole: 'manage', targetRole: 'edit' })).toBe(true);
    expect(canGrantRole({ actorIsOwner: false, actorRole: 'edit', targetRole: 'view' })).toBe(false);
  });

  it('keeps pending grants keyed by immutable GitHub id in the schema', () => {
    expect(ACCOUNT_ROOM_SCHEMA_SQL).toContain('github_id TEXT NOT NULL');
    expect(ACCOUNT_ROOM_SCHEMA_SQL).toContain('PRIMARY KEY (room_id, github_id)');
    expect(ACCOUNT_ROOM_SCHEMA_SQL).not.toContain('PRIMARY KEY (room_id, github_login)');
  });
});
