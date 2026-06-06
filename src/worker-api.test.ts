import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAccountApiRequest } from './account-api.js';
import { SESSION_COOKIE_NAME } from './account-auth.js';
import type { LinkAccess, RoomRole } from './room-permissions.js';

interface UserRow {
  user_id: string;
  github_id: string;
  github_login: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
}

interface RoomRow {
  room_id: string;
  title?: string | null;
  owner_user_id: string | null;
  created_by_kind?: 'guest' | 'user';
  created_by_guest_id?: string | null;
  persistence?: 'ephemeral' | 'persistent';
  link_access: LinkAccess;
  archived_at: number | null;
  updated_at?: number;
  last_active_at?: number;
}

interface GrantRow {
  room_id: string;
  user_id: string;
  role: RoomRole;
  granted_by_user_id?: string;
  updated_at?: number;
}

interface PendingGrantRow {
  room_id: string;
  github_id: string;
  github_login: string;
  role: RoomRole;
  granted_by_user_id: string;
}

interface AccessTokenRow {
  token_id: string;
  user_id: string;
  token_hash: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

class FakeApiStmt {
  private args: unknown[] = [];

  constructor(
    private db: FakeApiD1Database,
    private sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('SELECT user_id FROM users WHERE github_id')) {
      const [githubId] = this.args as [string];
      const user = [...this.db.users.values()].find((candidate) => candidate.github_id === githubId);
      return user ? ({ user_id: user.user_id } as T) : null;
    }

    if (this.sql.includes('FROM sessions')) {
      const [sessionId, now] = this.args as [string, number];
      const session = this.db.sessions.get(sessionId);
      if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
      const user = this.db.users.get(session.user_id);
      if (!user) return null;
      return {
        user_id: user.user_id,
        github_id: user.github_id,
        github_login: user.github_login,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      } as T;
    }

    if (this.sql.includes('FROM rooms') && this.sql.includes('LEFT JOIN room_grants')) {
      const [roomId, userId] = this.args as [string, string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at !== null) return null;
      const grant = this.db.grants.get(`${roomId}:${userId}`);
      return {
        owner_user_id: room.owner_user_id,
        link_access: room.link_access,
        grant_role: grant?.role || null,
      } as T;
    }

    if (this.sql.includes('FROM users') && this.sql.includes('lower(github_login)')) {
      const [githubLogin] = this.args as [string];
      const user = [...this.db.users.values()].find(
        (candidate) => candidate.github_login.toLowerCase() === githubLogin.toLowerCase(),
      );
      if (!user) return null;
      return {
        userId: user.user_id,
        githubId: user.github_id,
        githubLogin: user.github_login,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      } as T;
    }

    if (this.sql.includes('SELECT owner_user_id FROM rooms')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at !== null) return null;
      return { owner_user_id: room.owner_user_id } as T;
    }

    if (this.sql.includes('FROM rooms') && this.sql.includes('room_id AS roomId')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at !== null) return null;
      return {
        roomId: room.room_id,
        title: room.title || null,
        ownerUserId: room.owner_user_id,
        createdByKind: room.created_by_kind || (room.owner_user_id ? 'user' : 'guest'),
        persistence: room.persistence || (room.owner_user_id ? 'persistent' : 'ephemeral'),
        linkAccess: room.link_access,
        updatedAt: room.updated_at || 0,
        lastActiveAt: room.last_active_at || 0,
      } as T;
    }

    if (this.sql.includes('SELECT role FROM room_grants')) {
      const [roomId, userId] = this.args as [string, string];
      const grant = this.db.grants.get(`${roomId}:${userId}`);
      return grant ? ({ role: grant.role } as T) : null;
    }

    if (this.sql.includes('FROM rooms') && this.sql.includes('NULL AS grant_role')) {
      const [roomId] = this.args as [string];
      const room = this.db.rooms.get(roomId);
      if (!room || room.archived_at !== null) return null;
      return {
        owner_user_id: room.owner_user_id,
        link_access: room.link_access,
        grant_role: null,
      } as T;
    }

    throw new Error(`Unexpected SQL: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM access_tokens')) {
      const [userId] = this.args as [string];
      return {
        results: [...this.db.tokens.values()]
          .filter((token) => token.user_id === userId)
          .map(
            (token) =>
              ({
                tokenId: token.token_id,
                name: token.name,
                createdAt: token.created_at,
                lastUsedAt: token.last_used_at,
                expiresAt: token.expires_at,
                revokedAt: token.revoked_at,
              }) as T,
          ),
      };
    }

    if (this.sql.includes('FROM pending_room_grants')) {
      const [githubId] = this.args as [string];
      return {
        results: [...this.db.pending.values()]
          .filter((row) => row.github_id === githubId)
          .map((row) => ({ roomId: row.room_id, role: row.role }) as T),
      };
    }

    if (this.sql.includes('FROM room_grants') && this.sql.includes('JOIN users')) {
      const [roomId] = this.args as [string];
      return {
        results: [...this.db.grants.values()]
          .filter((grant) => grant.room_id === roomId)
          .map((grant) => {
            const user = this.db.users.get(grant.user_id);
            return {
              roomId: grant.room_id,
              userId: grant.user_id,
              role: grant.role,
              grantedByUserId: grant.granted_by_user_id || 'owner',
              githubLogin: user?.github_login || grant.user_id,
              displayName: user?.display_name || null,
              avatarUrl: user?.avatar_url || null,
              updatedAt: grant.updated_at || 0,
            } as T;
          }),
      };
    }
    throw new Error(`Unexpected SQL: ${this.sql}`);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('UPDATE users')) {
      const [userId, githubLogin, displayName, avatarUrl] = this.args as [string, string, string | null, string | null];
      const user = this.db.users.get(userId);
      if (user) {
        user.github_login = githubLogin;
        user.display_name = displayName;
        user.avatar_url = avatarUrl;
      }
      return fakeD1Result();
    }

    if (this.sql.includes('INSERT INTO users')) {
      const [userId, githubId, githubLogin, displayName, avatarUrl] = this.args as [
        string,
        string,
        string,
        string | null,
        string | null,
      ];
      this.db.users.set(userId, {
        user_id: userId,
        github_id: githubId,
        github_login: githubLogin,
        display_name: displayName,
        avatar_url: avatarUrl,
      });
      return fakeD1Result();
    }

    if (this.sql.includes('INSERT INTO sessions')) {
      const [sessionId, userId, , expiresAt] = this.args as [string, string, number, number];
      this.db.sessions.set(sessionId, {
        session_id: sessionId,
        user_id: userId,
        expires_at: expiresAt,
        revoked_at: null,
      });
      return fakeD1Result();
    }

    if (this.sql.includes('UPDATE sessions')) {
      const [sessionId, revokedAt] = this.args as [string, number];
      const session = this.db.sessions.get(sessionId);
      if (session && session.revoked_at === null) session.revoked_at = revokedAt;
      return fakeD1Result();
    }

    if (this.sql.includes('INSERT INTO access_tokens')) {
      const [tokenId, userId, tokenHash, name, now] = this.args as [string, string, string, string, number];
      this.db.tokens.set(tokenId, {
        token_id: tokenId,
        user_id: userId,
        token_hash: tokenHash,
        name,
        created_at: now,
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
      });
      return fakeD1Result();
    }

    if (this.sql.includes('UPDATE access_tokens')) {
      const [tokenId, userId, now] = this.args as [string, string, number];
      const token = this.db.tokens.get(tokenId);
      if (token && token.user_id === userId && token.revoked_at === null) token.revoked_at = now;
      return fakeD1Result();
    }

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
          persistence,
          link_access: linkAccess,
          archived_at: null,
          updated_at: now,
          last_active_at: now,
        });
      }
      return fakeD1Result();
    }

    if (this.sql.includes('UPDATE rooms') && this.sql.includes('SET title =')) {
      const [roomId, title, linkAccess, now] = this.args as [string, string | null, LinkAccess, number];
      const room = this.db.rooms.get(roomId);
      if (room) {
        room.title = title;
        room.link_access = linkAccess;
        room.updated_at = now;
      }
      return fakeD1Result();
    }

    if (this.sql.includes('UPDATE rooms') && this.sql.includes("created_by_kind = 'user'")) {
      const [roomId, ownerUserId, now] = this.args as [string, string, number];
      const room = this.db.rooms.get(roomId);
      if (room) {
        room.owner_user_id = ownerUserId;
        room.created_by_kind = 'user';
        room.persistence = 'persistent';
        room.updated_at = now;
        room.last_active_at = now;
      }
      return fakeD1Result();
    }

    if (this.sql.includes('INSERT INTO room_grants')) {
      const [roomId, userId, role, grantedByUserId, now] = this.args as [string, string, RoomRole, string, number];
      this.db.grants.set(`${roomId}:${userId}`, {
        room_id: roomId,
        user_id: userId,
        role,
        granted_by_user_id: grantedByUserId,
        updated_at: now,
      });
      return fakeD1Result();
    }

    if (this.sql.includes('INSERT INTO pending_room_grants')) {
      const [roomId, githubId, githubLogin, role, grantedByUserId] = this.args as [
        string,
        string,
        string,
        RoomRole,
        string,
      ];
      this.db.pending.set(`${roomId}:${githubId}`, {
        room_id: roomId,
        github_id: githubId,
        github_login: githubLogin,
        role,
        granted_by_user_id: grantedByUserId,
      });
      return fakeD1Result();
    }

    if (this.sql.includes('DELETE FROM room_grants')) {
      const [roomId, userId] = this.args as [string, string];
      this.db.grants.delete(`${roomId}:${userId}`);
      return fakeD1Result();
    }

    if (this.sql.includes('UPDATE pending_room_grants')) {
      return fakeD1Result();
    }

    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

class FakeApiD1Database {
  users = new Map<string, UserRow>();
  sessions = new Map<string, SessionRow>();
  rooms = new Map<string, RoomRow>();
  grants = new Map<string, GrantRow>();
  pending = new Map<string, PendingGrantRow>();
  tokens = new Map<string, AccessTokenRow>();

  prepare(sql: string): FakeApiStmt {
    return new FakeApiStmt(this, sql);
  }
}

function fakeD1Result(): D1Result {
  return { success: true, meta: {} } as D1Result;
}

class FakeRoomStub {
  requests: Request[] = [];
  response: Response = Response.json({ ok: true, refreshed: 1 });

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.requests.push(new Request(input, init));
    return this.response.clone();
  }
}

class FakeDurableObjectNamespace {
  stub = new FakeRoomStub();

  idFromName(name: string): DurableObjectId {
    return { name } as unknown as DurableObjectId;
  }

  get(): DurableObjectStub {
    return this.stub as unknown as DurableObjectStub;
  }
}

function envWithDb(db?: D1Database, namespace = new FakeDurableObjectNamespace()): Cloudflare.Env {
  return {
    ACCOUNTS_DB: db,
    ASSETS: (() => Promise.resolve(new Response())) as unknown as Fetcher,
    ORM_BUCKET: {} as R2Bucket,
    MapCollaboration: namespace as unknown as DurableObjectNamespace,
    INTERNAL_AUTH_SECRET: 'test-secret',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
  };
}

function asD1(db: FakeApiD1Database): D1Database {
  return db as unknown as D1Database;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('account API handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 501 for account APIs until the D1 binding is configured', async () => {
    const response = await handleAccountApiRequest(new Request('https://example.test/api/auth/me'), envWithDb());
    expect(response?.status).toBe(501);
    await expect(response?.json()).resolves.toEqual({ error: 'accounts-db-not-configured' });
  });

  it('returns the current user from /api/auth/me', async () => {
    const db = new FakeApiD1Database();
    db.users.set('user_1', {
      user_id: 'user_1',
      github_id: '123',
      github_login: 'octocat',
      display_name: 'Octocat',
      avatar_url: 'https://avatars.example/octocat',
    });
    db.sessions.set('session-session-session-session-1234', {
      session_id: 'session-session-session-session-1234',
      user_id: 'user_1',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/auth/me', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234` },
      }),
      envWithDb(asD1(db)),
    );

    expect(response?.status).toBe(200);
    await expect(json(response as Response)).resolves.toMatchObject({
      user: { userId: 'user_1', githubLogin: 'octocat' },
    });
  });

  it('starts GitHub OAuth with state and return cookies', async () => {
    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/auth/github/start?returnTo=/room/demo'),
      envWithDb(asD1(new FakeApiD1Database())),
    );

    expect(response?.status).toBe(302);
    const location = new URL(response?.headers.get('Location') || '');
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('github-client-id');
    expect(location.searchParams.get('state')).toMatch(/^state_/);
    expect(response?.headers.getSetCookie().join('\n')).toContain('orm_oauth_return_to=%2Froom%2Fdemo');
  });

  it('completes GitHub OAuth callback, creates a session, and redirects back', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'github-token', token_type: 'bearer' }))
        .mockResolvedValueOnce(
          Response.json({ id: 123, login: 'octocat', name: 'Octocat', avatar_url: 'https://avatar' }),
        ),
    );
    const db = new FakeApiD1Database();

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/auth/github/callback?code=abc&state=state_known', {
        headers: { Cookie: 'orm_oauth_state=state_known; orm_oauth_return_to=%2Froom%2Fdemo' },
      }),
      envWithDb(asD1(db)),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe('/room/demo');
    expect([...db.users.values()]).toHaveLength(1);
    expect([...db.users.values()][0]).toMatchObject({ github_id: '123', github_login: 'octocat' });
    expect([...db.sessions.values()]).toHaveLength(1);
    expect(response?.headers.getSetCookie().join('\n')).toContain('orm_session=sess_');
  });

  it('rejects GitHub OAuth callback with invalid state', async () => {
    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/auth/github/callback?code=abc&state=wrong', {
        headers: { Cookie: 'orm_oauth_state=expected' },
      }),
      envWithDb(asD1(new FakeApiD1Database())),
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: 'invalid-oauth-state' });
  });

  it('logs out by revoking the current session cookie', async () => {
    const db = new FakeApiD1Database();
    db.users.set('user_1', {
      user_id: 'user_1',
      github_id: '123',
      github_login: 'octocat',
      display_name: 'Octocat',
      avatar_url: null,
    });
    db.sessions.set('session-session-session-session-1234', {
      session_id: 'session-session-session-session-1234',
      user_id: 'user_1',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234` },
      }),
      envWithDb(asD1(db)),
    );

    expect(response?.status).toBe(200);
    expect(db.sessions.get('session-session-session-session-1234')?.revoked_at).toBeTypeOf('number');
    expect(response?.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('creates, lists, and revokes PAT tokens without storing raw token values', async () => {
    const db = new FakeApiD1Database();
    db.users.set('user_1', {
      user_id: 'user_1',
      github_id: '123',
      github_login: 'octocat',
      display_name: 'Octocat',
      avatar_url: null,
    });
    db.sessions.set('session-session-session-session-1234', {
      session_id: 'session-session-session-session-1234',
      user_id: 'user_1',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });

    const createResponse = await handleAccountApiRequest(
      new Request('https://example.test/api/tokens', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234` },
        body: JSON.stringify({ name: 'Agent CLI' }),
      }),
      envWithDb(asD1(db)),
    );
    expect(createResponse?.status).toBe(201);
    const created = await json(createResponse as Response);
    expect(created.token).toMatch(/^orm_pat_/);
    expect(created.accessToken).toMatchObject({ name: 'Agent CLI', revokedAt: null });

    const stored = [...db.tokens.values()][0];
    expect(stored.token_hash).not.toBe(created.token);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const listResponse = await handleAccountApiRequest(
      new Request('https://example.test/api/tokens', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234` },
      }),
      envWithDb(asD1(db)),
    );
    expect(listResponse?.status).toBe(200);
    const listed = await json(listResponse as Response);
    expect(JSON.stringify(listed)).not.toContain(String(created.token));
    expect(listed.tokens).toMatchObject([{ tokenId: stored.token_id, name: 'Agent CLI' }]);

    const deleteResponse = await handleAccountApiRequest(
      new Request(`https://example.test/api/tokens/${stored.token_id}`, {
        method: 'DELETE',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234` },
      }),
      envWithDb(asD1(db)),
    );
    expect(deleteResponse?.status).toBe(200);
    expect(db.tokens.get(stored.token_id)?.revoked_at).toBeTypeOf('number');
  });

  it('returns effective room capabilities for anonymous and signed-in users', async () => {
    const db = new FakeApiD1Database();
    db.users.set('user_1', {
      user_id: 'user_1',
      github_id: '123',
      github_login: 'octocat',
      display_name: 'Octocat',
      avatar_url: null,
    });
    db.sessions.set('session-session-session-session-1234', {
      session_id: 'session-session-session-session-1234',
      user_id: 'user_1',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('room', {
      room_id: 'room',
      owner_user_id: 'owner',
      link_access: 'edit',
      archived_at: null,
    });
    db.grants.set('room:user_1', {
      room_id: 'room',
      user_id: 'user_1',
      role: 'view',
    });

    const anonymous = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/room/access'),
      envWithDb(asD1(db)),
    );
    expect(anonymous?.status).toBe(200);
    await expect(json(anonymous as Response)).resolves.toMatchObject({
      role: 'edit',
      canView: true,
      canEdit: true,
      canManage: false,
      user: null,
    });

    const signedIn = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/room/access', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234` },
      }),
      envWithDb(asD1(db)),
    );
    expect(signedIn?.status).toBe(200);
    await expect(json(signedIn as Response)).resolves.toMatchObject({
      role: 'edit',
      canView: true,
      canEdit: true,
      canManage: false,
      user: { userId: 'user_1' },
    });
  });

  it('creates guest rooms as ephemeral editable-link rooms', async () => {
    const db = new FakeApiD1Database();
    const namespace = new FakeDurableObjectNamespace();

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms', {
        method: 'POST',
        headers: { 'x-orm-guest-id': 'guest_1' },
        body: JSON.stringify({ roomId: 'guest-room', title: 'Guest Room' }),
      }),
      envWithDb(asD1(db), namespace),
    );

    expect(response?.status).toBe(201);
    await expect(json(response as Response)).resolves.toMatchObject({
      room: {
        roomId: 'guest-room',
        title: 'Guest Room',
        ownerUserId: null,
        createdByKind: 'guest',
        persistence: 'ephemeral',
        linkAccess: 'edit',
      },
    });
    expect(namespace.stub.requests).toHaveLength(1);
    expect(namespace.stub.requests[0].url).toContain('/_control/room-persistence');
    await expect(namespace.stub.requests[0].json()).resolves.toEqual({ persistence: 'ephemeral' });
  });

  it('creates signed-in rooms as persistent restricted owner rooms', async () => {
    const db = new FakeApiD1Database();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.sessions.set('owner-session-owner-session-1234', {
      session_id: 'owner-session-owner-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=owner-session-owner-session-1234` },
        body: JSON.stringify({ roomId: 'owned-room', title: 'Owned Room' }),
      }),
      envWithDb(asD1(db)),
    );

    expect(response?.status).toBe(201);
    await expect(json(response as Response)).resolves.toMatchObject({
      room: {
        roomId: 'owned-room',
        ownerUserId: 'owner',
        createdByKind: 'user',
        persistence: 'persistent',
        linkAccess: 'restricted',
      },
    });
  });

  it('fails room creation visibly when persistence control cannot reach the DO', async () => {
    const db = new FakeApiD1Database();
    const namespace = new FakeDurableObjectNamespace();
    namespace.stub.response = Response.json({ error: 'nope' }, { status: 500 });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms', {
        method: 'POST',
        headers: { 'x-orm-guest-id': 'guest_1' },
        body: JSON.stringify({ roomId: 'guest-room' }),
      }),
      envWithDb(asD1(db), namespace),
    );

    expect(response?.status).toBe(503);
    await expect(json(response as Response)).resolves.toEqual({ error: 'room-persistence-sync-failed' });
    expect(namespace.stub.requests).toHaveLength(1);
  });

  it('claims guest rooms into persistent owned rooms and refreshes live access', async () => {
    const db = new FakeApiD1Database();
    const namespace = new FakeDurableObjectNamespace();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.sessions.set('owner-session-owner-session-1234', {
      session_id: 'owner-session-owner-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('guest-room', {
      room_id: 'guest-room',
      title: 'Guest Room',
      owner_user_id: null,
      created_by_kind: 'guest',
      created_by_guest_id: 'guest_1',
      persistence: 'ephemeral',
      link_access: 'edit',
      archived_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/guest-room/claim', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=owner-session-owner-session-1234` },
      }),
      envWithDb(asD1(db), namespace),
    );

    expect(response?.status).toBe(200);
    await expect(json(response as Response)).resolves.toMatchObject({
      room: {
        roomId: 'guest-room',
        ownerUserId: 'owner',
        createdByKind: 'user',
        persistence: 'persistent',
      },
    });
    expect(db.rooms.get('guest-room')?.persistence).toBe('persistent');
    expect(namespace.stub.requests).toHaveLength(2);
    expect(namespace.stub.requests[0].url).toContain('/_control/room-persistence');
    await expect(namespace.stub.requests[0].json()).resolves.toEqual({ persistence: 'persistent' });
    expect(namespace.stub.requests[1].headers.get('x-orm-control-action')).toBe('access-refresh');
    await expect(namespace.stub.requests[1].json()).resolves.toEqual({
      reason: 'owner-updated',
      refresh: { mode: 'room' },
    });
  });

  it('fails guest-room claim visibly when live access refresh cannot reach the DO', async () => {
    const db = new FakeApiD1Database();
    const namespace = new FakeDurableObjectNamespace();
    namespace.stub.response = Response.json({ ok: true });
    let calls = 0;
    namespace.stub.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      namespace.stub.requests.push(new Request(input, init));
      calls += 1;
      return calls === 1 ? Response.json({ ok: true }) : Response.json({ error: 'refresh failed' }, { status: 500 });
    };
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.sessions.set('owner-session-owner-session-1234', {
      session_id: 'owner-session-owner-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('guest-room', {
      room_id: 'guest-room',
      owner_user_id: null,
      created_by_kind: 'guest',
      persistence: 'ephemeral',
      link_access: 'edit',
      archived_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/guest-room/claim', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=owner-session-owner-session-1234` },
      }),
      envWithDb(asD1(db), namespace),
    );

    expect(response?.status).toBe(503);
    await expect(json(response as Response)).resolves.toEqual({ error: 'access-refresh-failed' });
    expect(namespace.stub.requests).toHaveLength(2);
  });

  it('refreshes all live connections when owners change link access', async () => {
    const db = new FakeApiD1Database();
    const namespace = new FakeDurableObjectNamespace();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.sessions.set('owner-session-owner-session-1234', {
      session_id: 'owner-session-owner-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('room', {
      room_id: 'room',
      owner_user_id: 'owner',
      link_access: 'edit',
      archived_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/room', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=owner-session-owner-session-1234` },
        body: JSON.stringify({ linkAccess: 'restricted' }),
      }),
      envWithDb(asD1(db), namespace),
    );

    expect(response?.status).toBe(200);
    expect(db.rooms.get('room')?.link_access).toBe('restricted');
    expect(namespace.stub.requests).toHaveLength(1);
    expect(namespace.stub.requests[0].headers.get('x-orm-control-action')).toBe('access-refresh');
    await expect(namespace.stub.requests[0].json()).resolves.toEqual({
      reason: 'link-access-updated',
      refresh: { mode: 'room' },
    });
  });

  it('lets owners grant existing users and sends a live access refresh', async () => {
    const db = new FakeApiD1Database();
    const namespace = new FakeDurableObjectNamespace();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.users.set('editor', {
      user_id: 'editor',
      github_id: '2',
      github_login: 'editor',
      display_name: 'Editor',
      avatar_url: null,
    });
    db.sessions.set('owner-session-owner-session-1234', {
      session_id: 'owner-session-owner-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('room', {
      room_id: 'room',
      owner_user_id: 'owner',
      link_access: 'restricted',
      archived_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/room/grants/editor', {
        method: 'PUT',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=owner-session-owner-session-1234` },
        body: JSON.stringify({ role: 'edit' }),
      }),
      envWithDb(asD1(db), namespace),
    );

    expect(response?.status).toBe(200);
    expect(db.grants.get('room:editor')?.role).toBe('edit');
    expect(namespace.stub.requests).toHaveLength(1);
    expect(namespace.stub.requests[0].headers.get('x-orm-control-action')).toBe('access-refresh');
    await expect(namespace.stub.requests[0].json()).resolves.toEqual({ updates: [{ userId: 'editor', role: 'edit' }] });
  });

  it('prevents managers from granting manage', async () => {
    const db = new FakeApiD1Database();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.users.set('manager', {
      user_id: 'manager',
      github_id: '2',
      github_login: 'manager',
      display_name: 'Manager',
      avatar_url: null,
    });
    db.users.set('target', {
      user_id: 'target',
      github_id: '3',
      github_login: 'target',
      display_name: 'Target',
      avatar_url: null,
    });
    db.sessions.set('manager-session-manager-session-1234', {
      session_id: 'manager-session-manager-session-1234',
      user_id: 'manager',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('room', {
      room_id: 'room',
      owner_user_id: 'owner',
      link_access: 'restricted',
      archived_at: null,
    });
    db.grants.set('room:manager', {
      room_id: 'room',
      user_id: 'manager',
      role: 'manage',
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/room/grants/target', {
        method: 'PUT',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=manager-session-manager-session-1234` },
        body: JSON.stringify({ role: 'manage' }),
      }),
      envWithDb(asD1(db)),
    );

    expect(response?.status).toBe(403);
    expect(db.grants.get('room:target')).toBeUndefined();
  });

  it('creates pending grants only after resolving immutable GitHub ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 42, login: 'new-user' })),
    );
    const db = new FakeApiD1Database();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: null,
    });
    db.sessions.set('owner-session-owner-session-1234', {
      session_id: 'owner-session-owner-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('room', {
      room_id: 'room',
      owner_user_id: 'owner',
      link_access: 'restricted',
      archived_at: null,
    });

    const response = await handleAccountApiRequest(
      new Request('https://example.test/api/rooms/room/grants/new-user', {
        method: 'PUT',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=owner-session-owner-session-1234` },
        body: JSON.stringify({ role: 'view' }),
      }),
      envWithDb(asD1(db)),
    );

    expect(response?.status).toBe(200);
    await expect(json(response as Response)).resolves.toMatchObject({
      grant: { githubId: '42', githubLogin: 'new-user', role: 'view', pending: true },
    });
    expect(db.pending.get('room:42')?.role).toBe('view');
  });
});
