import { describe, expect, it } from 'vitest';
import {
  expiredSessionCookie,
  getSessionUser,
  parseCookieHeader,
  sessionCookie,
  sessionIdFromRequest,
  SESSION_COOKIE_NAME,
} from './account-auth.js';

interface SessionRow {
  session_id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
}

interface UserRow {
  user_id: string;
  github_id: string;
  github_login: string;
  display_name: string | null;
  avatar_url: string | null;
}

class FakeAuthStmt {
  private args: unknown[] = [];

  constructor(private db: FakeAuthD1Database) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const [sessionId, now] = this.args as [string, number];
    const session = this.db.sessions.get(sessionId);
    if (!session || session.expires_at <= now || session.revoked_at !== null) return null;
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
}

class FakeAuthD1Database {
  sessions = new Map<string, SessionRow>();
  users = new Map<string, UserRow>();

  prepare(): FakeAuthStmt {
    return new FakeAuthStmt(this);
  }
}

function fakeDb(): D1Database & FakeAuthD1Database {
  return new FakeAuthD1Database() as D1Database & FakeAuthD1Database;
}

describe('account auth helpers', () => {
  it('parses cookies and extracts sufficiently strong session ids', () => {
    const strong = 's'.repeat(32);
    const cookies = parseCookieHeader(`theme=dark; ${SESSION_COOKIE_NAME}=${strong}; empty=`);
    expect(cookies.get('theme')).toBe('dark');
    expect(cookies.get(SESSION_COOKIE_NAME)).toBe(strong);

    expect(
      sessionIdFromRequest(
        new Request('https://example.test', { headers: { Cookie: `${SESSION_COOKIE_NAME}=short` } }),
      ),
    ).toBe(null);
    expect(
      sessionIdFromRequest(
        new Request('https://example.test', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${strong}` } }),
      ),
    ).toBe(strong);
  });

  it('returns the signed-in account for active sessions only', async () => {
    const db = fakeDb();
    db.users.set('user_1', {
      user_id: 'user_1',
      github_id: '123',
      github_login: 'octocat',
      display_name: 'Octocat',
      avatar_url: 'https://avatars.example/octocat',
    });
    db.sessions.set('active-session-active-session-1234', {
      session_id: 'active-session-active-session-1234',
      user_id: 'user_1',
      expires_at: 200,
      revoked_at: null,
    });
    db.sessions.set('expired-session-expired-session', {
      session_id: 'expired-session-expired-session',
      user_id: 'user_1',
      expires_at: 50,
      revoked_at: null,
    });
    db.sessions.set('revoked-session-revoked-session', {
      session_id: 'revoked-session-revoked-session',
      user_id: 'user_1',
      expires_at: 200,
      revoked_at: 20,
    });

    await expect(
      getSessionUser(
        db,
        new Request('https://example.test', {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=active-session-active-session-1234` },
        }),
        100,
      ),
    ).resolves.toMatchObject({ userId: 'user_1', githubLogin: 'octocat' });
    await expect(
      getSessionUser(
        db,
        new Request('https://example.test', {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=expired-session-expired-session` },
        }),
        100,
      ),
    ).resolves.toBeNull();
    await expect(
      getSessionUser(
        db,
        new Request('https://example.test', {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=revoked-session-revoked-session` },
        }),
        100,
      ),
    ).resolves.toBeNull();
  });

  it('serializes secure session cookies', () => {
    expect(sessionCookie('session', Date.now() + 60_000)).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(expiredSessionCookie()).toContain('Max-Age=0');
  });
});
