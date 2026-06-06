import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, sha256Hex } from './account-auth.js';
import { preparePartyWebSocketRequest } from './room-ws-auth.js';
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

interface TokenRow {
  token_hash: string;
  user_id: string;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

interface RoomRow {
  room_id: string;
  owner_user_id: string | null;
  link_access: LinkAccess;
  archived_at: number | null;
}

interface GrantRow {
  room_id: string;
  user_id: string;
  role: RoomRole;
}

class FakeWsAuthStmt {
  private args: unknown[] = [];

  constructor(
    private db: FakeWsAuthD1Database,
    private sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM access_tokens')) {
      const [tokenHash, now] = this.args as [string, number];
      const token = [...this.db.tokens.values()].find(
        (candidate) =>
          candidate.token_hash === tokenHash &&
          candidate.revoked_at === null &&
          (candidate.expires_at === null || candidate.expires_at > now),
      );
      if (!token) return null;
      const user = this.db.users.get(token.user_id);
      if (!user) return null;
      return {
        user_id: user.user_id,
        github_id: user.github_id,
        github_login: user.github_login,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      } as T;
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

    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('UPDATE access_tokens')) {
      const [tokenHash, now] = this.args as [string, number];
      const token = [...this.db.tokens.values()].find((candidate) => candidate.token_hash === tokenHash);
      if (token) token.last_used_at = now;
      return { success: true, meta: {} } as D1Result;
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

class FakeWsAuthD1Database {
  users = new Map<string, UserRow>();
  sessions = new Map<string, SessionRow>();
  tokens = new Map<string, TokenRow>();
  rooms = new Map<string, RoomRow>();
  grants = new Map<string, GrantRow>();

  prepare(sql: string): FakeWsAuthStmt {
    return new FakeWsAuthStmt(this, sql);
  }
}

function asD1(db: FakeWsAuthD1Database): D1Database {
  return db as unknown as D1Database;
}

function envWithDb(db: FakeWsAuthD1Database): Cloudflare.Env {
  return {
    ACCOUNTS_DB: asD1(db),
    INTERNAL_AUTH_SECRET: 'secret',
    ASSETS: (() => Promise.resolve(new Response())) as unknown as Fetcher,
    ORM_BUCKET: {} as R2Bucket,
    MapCollaboration: {} as DurableObjectNamespace,
  };
}

function wsRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    headers: {
      Upgrade: 'websocket',
      ...headers,
    },
  });
}

describe('room WebSocket auth gate', () => {
  it('signs anonymous connections when link access allows viewing', async () => {
    const db = new FakeWsAuthD1Database();
    db.rooms.set('public-room', {
      room_id: 'public-room',
      owner_user_id: null,
      link_access: 'edit',
      archived_at: null,
    });

    const prepared = await preparePartyWebSocketRequest(
      wsRequest('https://example.test/parties/map/public-room?_pk=client_1&name=Guest'),
      envWithDb(db),
    );

    expect(prepared).not.toBeInstanceOf(Response);
    expect(prepared && 'role' in prepared ? prepared.role : null).toBe('edit');
    const headers = prepared && 'request' in prepared ? prepared.request.headers : new Headers();
    expect(headers.get('x-orm-auth-user-id')).toBe('anon_client_1');
    expect(headers.get('x-orm-client-id')).toBe('client_1');
    expect(headers.get('x-orm-auth-kind')).toBe('anonymous');
    expect(headers.get('x-orm-room-role')).toBe('edit');
    expect(headers.get('x-orm-auth-signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects anonymous connections to restricted rooms', async () => {
    const db = new FakeWsAuthD1Database();
    db.rooms.set('private-room', {
      room_id: 'private-room',
      owner_user_id: 'owner',
      link_access: 'restricted',
      archived_at: null,
    });

    const response = await preparePartyWebSocketRequest(
      wsRequest('https://example.test/parties/map/private-room?_pk=client_1'),
      envWithDb(db),
    );

    expect(response).toBeInstanceOf(Response);
    expect(response instanceof Response ? response.status : 0).toBe(401);
  });

  it('signs owner sessions as manage', async () => {
    const db = new FakeWsAuthD1Database();
    db.users.set('owner', {
      user_id: 'owner',
      github_id: '1',
      github_login: 'owner',
      display_name: 'Owner',
      avatar_url: 'https://avatar',
    });
    db.sessions.set('session-session-session-session-1234', {
      session_id: 'session-session-session-session-1234',
      user_id: 'owner',
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    });
    db.rooms.set('private-room', {
      room_id: 'private-room',
      owner_user_id: 'owner',
      link_access: 'restricted',
      archived_at: null,
    });

    const prepared = await preparePartyWebSocketRequest(
      wsRequest('https://example.test/parties/map/private-room?_pk=browser_1', {
        Cookie: `${SESSION_COOKIE_NAME}=session-session-session-session-1234`,
      }),
      envWithDb(db),
    );

    expect(prepared && 'role' in prepared ? prepared.role : null).toBe('manage');
    const headers = prepared && 'request' in prepared ? prepared.request.headers : new Headers();
    expect(headers.get('x-orm-auth-user-id')).toBe('owner');
    expect(headers.get('x-orm-room-role')).toBe('manage');
    expect(headers.get('x-orm-auth-kind')).toBe('user');
    expect(headers.get('x-orm-auth-user-avatar')).toBe('https://avatar');
  });

  it('authenticates PATs and keeps agent client id separate from user id', async () => {
    const db = new FakeWsAuthD1Database();
    const token = 'orm_pat_example';
    const tokenHash = await sha256Hex(token);
    db.users.set('user_1', {
      user_id: 'user_1',
      github_id: '1',
      github_login: 'octocat',
      display_name: 'Octocat',
      avatar_url: null,
    });
    db.tokens.set('token_1', {
      token_hash: tokenHash,
      user_id: 'user_1',
      last_used_at: null,
      expires_at: null,
      revoked_at: null,
    });
    db.rooms.set('room', {
      room_id: 'room',
      owner_user_id: 'owner',
      link_access: 'restricted',
      archived_at: null,
    });
    db.grants.set('room:user_1', {
      room_id: 'room',
      user_id: 'user_1',
      role: 'edit',
    });

    const prepared = await preparePartyWebSocketRequest(
      wsRequest(`https://example.test/parties/map/room?_pk=agent_1&clientType=agent&name=Snapshotter&token=${token}`),
      envWithDb(db),
    );

    expect(prepared && 'role' in prepared ? prepared.role : null).toBe('edit');
    const headers = prepared && 'request' in prepared ? prepared.request.headers : new Headers();
    expect(headers.get('x-orm-auth-user-id')).toBe('user_1');
    expect(headers.get('x-orm-client-id')).toBe('agent_1');
    expect(headers.get('x-orm-agent-id')).toBe('agent_1');
    expect(headers.get('x-orm-auth-kind')).toBe('token');
    expect(headers.get('x-orm-auth-user-name')).toBe('Octocat / Snapshotter');
    expect(db.tokens.get('token_1')?.last_used_at).toBeTypeOf('number');
  });
});
