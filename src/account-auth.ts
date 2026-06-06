export const SESSION_COOKIE_NAME = 'orm_session';
export const OAUTH_STATE_COOKIE_NAME = 'orm_oauth_state';
export const OAUTH_RETURN_COOKIE_NAME = 'orm_oauth_return_to';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface AccountUser {
  userId: string;
  githubId: string;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface SessionUserRow {
  user_id: string;
  github_id: string;
  github_login: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface TokenUserRow {
  user_id: string;
  github_id: string;
  github_login: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface UserIdRow {
  user_id: string;
}

export interface GitHubAccountProfile {
  githubId: string;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AccessTokenSummary {
  tokenId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

interface AccessTokenRow {
  tokenId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

export function randomToken(prefix = ''): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${token}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

function cookieValue(value: string): string {
  return encodeURIComponent(value);
}

function baseCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${cookieValue(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function sessionIdFromRequest(request: Request): string | null {
  const sessionId = parseCookieHeader(request.headers.get('Cookie')).get(SESSION_COOKIE_NAME);
  return sessionId && sessionId.length >= 32 ? sessionId : null;
}

export async function upsertGitHubAccount(
  db: D1Database,
  profile: GitHubAccountProfile,
  now: number = Date.now(),
): Promise<AccountUser> {
  const existing = await db
    .prepare(`SELECT user_id FROM users WHERE github_id = ?1 LIMIT 1`)
    .bind(profile.githubId)
    .first<UserIdRow>();
  const userId = existing?.user_id || randomToken('user_');

  if (existing) {
    await db
      .prepare(
        `
        UPDATE users
        SET github_login = ?2, display_name = ?3, avatar_url = ?4, updated_at = ?5, last_login_at = ?5
        WHERE user_id = ?1
      `,
      )
      .bind(userId, profile.githubLogin, profile.displayName, profile.avatarUrl, now)
      .run();
  } else {
    await db
      .prepare(
        `
        INSERT INTO users (
          user_id, github_id, github_login, display_name, avatar_url,
          created_at, updated_at, last_login_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
      `,
      )
      .bind(userId, profile.githubId, profile.githubLogin, profile.displayName, profile.avatarUrl, now)
      .run();
  }

  return {
    userId,
    githubId: profile.githubId,
    githubLogin: profile.githubLogin,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
  };
}

export async function createSession(
  db: D1Database,
  userId: string,
  now: number = Date.now(),
): Promise<{ sessionId: string; expiresAt: number }> {
  const sessionId = randomToken('sess_');
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare(
      `
      INSERT INTO sessions (session_id, user_id, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4)
    `,
    )
    .bind(sessionId, userId, now, expiresAt)
    .run();
  return { sessionId, expiresAt };
}

export async function revokeSession(db: D1Database, request: Request, now: number = Date.now()): Promise<boolean> {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) return false;
  await db
    .prepare(
      `
      UPDATE sessions
      SET revoked_at = ?2
      WHERE session_id = ?1 AND revoked_at IS NULL
    `,
    )
    .bind(sessionId, now)
    .run();
  return true;
}

export async function listAccessTokens(db: D1Database, userId: string): Promise<AccessTokenSummary[]> {
  const result = await db
    .prepare(
      `
      SELECT
        token_id AS tokenId,
        name,
        created_at AS createdAt,
        last_used_at AS lastUsedAt,
        expires_at AS expiresAt,
        revoked_at AS revokedAt
      FROM access_tokens
      WHERE user_id = ?1
      ORDER BY created_at DESC
    `,
    )
    .bind(userId)
    .all<AccessTokenRow>();
  return result.results || [];
}

export async function createAccessToken(
  db: D1Database,
  userId: string,
  name: string,
  now: number = Date.now(),
): Promise<{ token: string; summary: AccessTokenSummary }> {
  const token = randomToken('orm_pat_');
  const tokenId = randomToken('tok_');
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      `
      INSERT INTO access_tokens (token_id, user_id, token_hash, name, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `,
    )
    .bind(tokenId, userId, tokenHash, name, now)
    .run();
  return {
    token,
    summary: {
      tokenId,
      name,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    },
  };
}

export async function revokeAccessToken(
  db: D1Database,
  userId: string,
  tokenId: string,
  now: number = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `
      UPDATE access_tokens
      SET revoked_at = ?3
      WHERE token_id = ?1 AND user_id = ?2 AND revoked_at IS NULL
    `,
    )
    .bind(tokenId, userId, now)
    .run();
}

export function bearerTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim() || null;
  const url = new URL(request.url);
  return url.searchParams.get('token') || null;
}

export async function getAccessTokenUser(
  db: D1Database,
  token: string | null,
  now: number = Date.now(),
): Promise<AccountUser | null> {
  if (!token?.startsWith('orm_pat_')) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `
      SELECT users.user_id, users.github_id, users.github_login, users.display_name, users.avatar_url
      FROM access_tokens
      JOIN users ON users.user_id = access_tokens.user_id
      WHERE access_tokens.token_hash = ?1
        AND access_tokens.revoked_at IS NULL
        AND (access_tokens.expires_at IS NULL OR access_tokens.expires_at > ?2)
      LIMIT 1
    `,
    )
    .bind(tokenHash, now)
    .first<TokenUserRow>();
  if (!row) return null;

  await db
    .prepare(
      `
      UPDATE access_tokens
      SET last_used_at = ?2
      WHERE token_hash = ?1
    `,
    )
    .bind(tokenHash, now)
    .run();

  return {
    userId: row.user_id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export async function getSessionUser(
  db: D1Database,
  request: Request,
  now: number = Date.now(),
): Promise<AccountUser | null> {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) return null;

  const row = await db
    .prepare(
      `
      SELECT users.user_id, users.github_id, users.github_login, users.display_name, users.avatar_url
      FROM sessions
      JOIN users ON users.user_id = sessions.user_id
      WHERE sessions.session_id = ?1
        AND sessions.expires_at > ?2
        AND sessions.revoked_at IS NULL
      LIMIT 1
    `,
    )
    .bind(sessionId, now)
    .first<SessionUserRow>();

  if (!row) return null;
  return {
    userId: row.user_id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export function sessionCookie(sessionId: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function oauthStateCookie(state: string): string {
  return baseCookie(OAUTH_STATE_COOKIE_NAME, state, OAUTH_STATE_TTL_SECONDS);
}

export function oauthReturnCookie(returnTo: string): string {
  return baseCookie(OAUTH_RETURN_COOKIE_NAME, returnTo, OAUTH_STATE_TTL_SECONDS);
}

export function expiredOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function expiredOAuthReturnCookie(): string {
  return `${OAUTH_RETURN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function oauthStateFromRequest(request: Request): string | null {
  return parseCookieHeader(request.headers.get('Cookie')).get(OAUTH_STATE_COOKIE_NAME) || null;
}

export function oauthReturnToFromRequest(request: Request): string {
  const value = parseCookieHeader(request.headers.get('Cookie')).get(OAUTH_RETURN_COOKIE_NAME);
  return value && value.startsWith('/') ? value : '/';
}
