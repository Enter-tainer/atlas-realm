import { describe, expect, it } from 'vitest';
import {
  claimPendingRoomGrants,
  ensureRoomRegistry,
  getEffectiveRoomAccess,
  getRoomAccessSnapshot,
  upsertPendingRoomGrant,
  upsertRoomGrant,
} from './room-access.js';
import type { LinkAccess, RoomRole } from './room-permissions.js';

interface UserRow {
  user_id: string;
  github_id: string;
  github_login: string;
}

interface RoomRow {
  room_id: string;
  title: string | null;
  owner_user_id: string | null;
  created_by_kind: 'guest' | 'user';
  created_by_guest_id: string | null;
  created_at: number;
  updated_at: number;
  last_active_at: number;
  persistence: 'ephemeral' | 'persistent';
  link_access: LinkAccess;
  archived_at: number | null;
}

interface GrantRow {
  room_id: string;
  user_id: string;
  role: RoomRole;
  granted_by_user_id: string;
  created_at: number;
  updated_at: number;
}

interface PendingGrantRow {
  room_id: string;
  github_id: string;
  github_login: string;
  role: RoomRole;
  granted_by_user_id: string;
  created_at: number;
  claimed_at: number | null;
}

class FakeStmt {
  private args: unknown[] = [];

  constructor(
    private db: FakeD1Database,
    private sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM rooms') && this.sql.includes('LEFT JOIN room_grants')) {
      const [roomId, userId] = this.args as [string, string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at) return null;
      const grant = this.db.grants.get(`${roomId}:${userId}`);
      return {
        owner_user_id: room.owner_user_id,
        link_access: room.link_access,
        grant_role: grant?.role || null,
      } as T;
    }
    if (this.sql.includes('FROM rooms') && this.sql.includes('NULL AS grant_role')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at) return null;
      return {
        owner_user_id: room.owner_user_id,
        link_access: room.link_access,
        grant_role: null,
      } as T;
    }
    if (this.sql.includes('FROM rooms') && this.sql.includes('SELECT owner_user_id, link_access')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at) return null;
      return {
        owner_user_id: room.owner_user_id,
        link_access: room.link_access,
      } as T;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM room_grants')) {
      const [roomId] = this.args as [string];
      return {
        results: [...this.db.grants.values()]
          .filter((row) => row.room_id === roomId)
          .map((row) => ({ user_id: row.user_id, role: row.role }) as T),
      };
    }
    if (this.sql.includes('FROM pending_room_grants')) {
      const [githubId] = this.args as [string];
      return {
        results: [...this.db.pending.values()]
          .filter((row) => row.github_id === githubId && row.claimed_at === null)
          .map((row) => ({ roomId: row.room_id, role: row.role }) as T),
      };
    }
    throw new Error(`Unexpected all SQL: ${this.sql}`);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('INSERT INTO rooms')) {
      const [roomId, title, ownerUserId, createdByKind, createdByGuestId, now, persistence, linkAccess] = this.args as [
        string,
        string | null,
        string | null,
        'guest' | 'user',
        string | null,
        number,
        'ephemeral' | 'persistent',
        LinkAccess,
      ];
      const existing = this.db.rooms.get(roomId);
      if (existing) {
        existing.updated_at = now;
        existing.last_active_at = now;
      } else {
        this.db.rooms.set(roomId, {
          room_id: roomId,
          title,
          owner_user_id: ownerUserId,
          created_by_kind: createdByKind,
          created_by_guest_id: createdByGuestId,
          created_at: now,
          updated_at: now,
          last_active_at: now,
          persistence,
          link_access: linkAccess,
          archived_at: null,
        });
      }
      return fakeD1Result();
    }
    if (this.sql.includes('INSERT INTO room_grants') && this.sql.includes('VALUES (?1, ?2, ?3, ?4, ?5, ?5)')) {
      const [roomId, userId, role, grantedByUserId, now] = this.args as [string, string, RoomRole, string, number];
      this.db.grants.set(`${roomId}:${userId}`, {
        room_id: roomId,
        user_id: userId,
        role,
        granted_by_user_id: grantedByUserId,
        created_at: now,
        updated_at: now,
      });
      return fakeD1Result();
    }
    if (this.sql.includes('INSERT INTO pending_room_grants')) {
      const [roomId, githubId, githubLogin, role, grantedByUserId, now] = this.args as [
        string,
        string,
        string,
        RoomRole,
        string,
        number,
      ];
      this.db.pending.set(`${roomId}:${githubId}`, {
        room_id: roomId,
        github_id: githubId,
        github_login: githubLogin,
        role,
        granted_by_user_id: grantedByUserId,
        created_at: now,
        claimed_at: null,
      });
      return fakeD1Result();
    }
    if (this.sql.includes('INSERT INTO room_grants') && this.sql.includes('SELECT room_id')) {
      const [roomId, userId, now, githubId] = this.args as [string, string, number, string];
      const pending = this.db.pending.get(`${roomId}:${githubId}`);
      if (pending && pending.claimed_at === null) {
        this.db.grants.set(`${roomId}:${userId}`, {
          room_id: roomId,
          user_id: userId,
          role: pending.role,
          granted_by_user_id: pending.granted_by_user_id,
          created_at: now,
          updated_at: now,
        });
      }
      return fakeD1Result();
    }
    if (this.sql.includes('UPDATE pending_room_grants')) {
      const [roomId, githubId, now] = this.args as [string, string, number];
      const pending = this.db.pending.get(`${roomId}:${githubId}`);
      if (pending && pending.claimed_at === null) pending.claimed_at = now;
      return fakeD1Result();
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

function fakeD1Result(): D1Result {
  return { success: true, meta: {} } as D1Result;
}

class FakeD1Database {
  users = new Map<string, UserRow>();
  rooms = new Map<string, RoomRow>();
  grants = new Map<string, GrantRow>();
  pending = new Map<string, PendingGrantRow>();

  prepare(sql: string): FakeStmt {
    return new FakeStmt(this, sql);
  }
}

function fakeDb(): D1Database & FakeD1Database {
  return new FakeD1Database() as D1Database & FakeD1Database;
}

describe('room access D1 helpers', () => {
  it('creates guest and user room registry rows with the expected defaults supplied by callers', async () => {
    const db = fakeDb();
    await ensureRoomRegistry(db, {
      roomId: 'guest-room',
      createdByKind: 'guest',
      persistence: 'ephemeral',
      linkAccess: 'edit',
      createdByGuestId: 'guest_1',
      now: 10,
    });
    await ensureRoomRegistry(db, {
      roomId: 'user-room',
      ownerUserId: 'user_1',
      createdByKind: 'user',
      persistence: 'persistent',
      linkAccess: 'restricted',
      now: 20,
    });

    expect(db.rooms.get('guest-room')?.persistence).toBe('ephemeral');
    expect(db.rooms.get('guest-room')?.link_access).toBe('edit');
    expect(db.rooms.get('user-room')?.persistence).toBe('persistent');
    expect(db.rooms.get('user-room')?.owner_user_id).toBe('user_1');
  });

  it('computes effective access with highest privilege across grant and link access', async () => {
    const db = fakeDb();
    await ensureRoomRegistry(db, {
      roomId: 'room',
      ownerUserId: 'owner',
      createdByKind: 'user',
      persistence: 'persistent',
      linkAccess: 'edit',
      now: 1,
    });
    db.grants.set('room:user_1', {
      room_id: 'room',
      user_id: 'user_1',
      role: 'view',
      granted_by_user_id: 'owner',
      created_at: 1,
      updated_at: 1,
    });

    await expect(getEffectiveRoomAccess(db, 'room', null)).resolves.toMatchObject({ role: 'edit' });
    await expect(getEffectiveRoomAccess(db, 'room', 'user_1')).resolves.toMatchObject({ role: 'edit' });
    await expect(getEffectiveRoomAccess(db, 'room', 'owner')).resolves.toMatchObject({ role: 'manage', isOwner: true });
  });

  it('loads a room access snapshot with all grants for room-wide refresh', async () => {
    const db = fakeDb();
    await ensureRoomRegistry(db, {
      roomId: 'room',
      ownerUserId: 'owner',
      createdByKind: 'user',
      persistence: 'persistent',
      linkAccess: 'view',
      now: 1,
    });
    db.grants.set('room:user_1', {
      room_id: 'room',
      user_id: 'user_1',
      role: 'edit',
      granted_by_user_id: 'owner',
      created_at: 1,
      updated_at: 1,
    });
    db.grants.set('other-room:user_2', {
      room_id: 'other-room',
      user_id: 'user_2',
      role: 'manage',
      granted_by_user_id: 'owner',
      created_at: 1,
      updated_at: 1,
    });

    const snapshot = await getRoomAccessSnapshot(db, 'room');

    expect(snapshot?.ownerUserId).toBe('owner');
    expect(snapshot?.linkAccess).toBe('view');
    expect(snapshot?.grantsByUserId.get('user_1')).toBe('edit');
    expect(snapshot?.grantsByUserId.has('user_2')).toBe(false);
  });

  it('allows managers to grant edit but only owners to grant manage', async () => {
    const db = fakeDb();
    await ensureRoomRegistry(db, {
      roomId: 'room',
      ownerUserId: 'owner',
      createdByKind: 'user',
      persistence: 'persistent',
      linkAccess: 'restricted',
      now: 1,
    });
    await upsertRoomGrant(db, {
      roomId: 'room',
      actorUserId: 'owner',
      targetUserId: 'manager',
      targetRole: 'manage',
      now: 2,
    });
    await upsertRoomGrant(db, {
      roomId: 'room',
      actorUserId: 'manager',
      targetUserId: 'editor',
      targetRole: 'edit',
      now: 3,
    });
    await expect(
      upsertRoomGrant(db, {
        roomId: 'room',
        actorUserId: 'manager',
        targetUserId: 'other-manager',
        targetRole: 'manage',
        now: 4,
      }),
    ).rejects.toThrow('Forbidden grant');

    expect(db.grants.get('room:editor')?.role).toBe('edit');
    expect(db.grants.get('room:other-manager')).toBeUndefined();
  });

  it('requires immutable GitHub ids for pending grants and claims by github_id only', async () => {
    const db = fakeDb();
    await ensureRoomRegistry(db, {
      roomId: 'room',
      ownerUserId: 'owner',
      createdByKind: 'user',
      persistence: 'persistent',
      linkAccess: 'restricted',
      now: 1,
    });

    await expect(
      upsertPendingRoomGrant(db, {
        roomId: 'room',
        actorUserId: 'owner',
        githubId: '',
        githubLogin: 'octocat',
        targetRole: 'edit',
        now: 2,
      }),
    ).rejects.toThrow('github_id');

    await upsertPendingRoomGrant(db, {
      roomId: 'room',
      actorUserId: 'owner',
      githubId: '123',
      githubLogin: 'octocat',
      targetRole: 'edit',
      now: 3,
    });

    await expect(claimPendingRoomGrants(db, 'user_wrong', 'renamed-login-id', 4)).resolves.toEqual([]);
    expect(db.grants.get('room:user_wrong')).toBeUndefined();

    await expect(claimPendingRoomGrants(db, 'user_1', '123', 5)).resolves.toEqual([{ roomId: 'room', role: 'edit' }]);
    expect(db.grants.get('room:user_1')?.role).toBe('edit');
    expect(db.pending.get('room:123')?.claimed_at).toBe(5);
  });
});
