import {
  bearerTokenFromRequest,
  completeOAuthDeviceFlow,
  createSession,
  createAccessToken,
  createOAuthDeviceFlow,
  expiredOAuthReturnCookie,
  expiredOAuthStateCookie,
  expiredSessionCookie,
  getAccessTokenUser,
  getOAuthDeviceFlow,
  getSessionUser,
  listAccessTokens,
  markOAuthDeviceFlowTerminal,
  oauthReturnCookie,
  oauthReturnToFromRequest,
  oauthStateCookie,
  oauthStateFromRequest,
  randomToken,
  recordOAuthDeviceFlowPoll,
  revokeSession,
  revokeAccessToken,
  sessionCookie,
  upsertGitHubAccount,
} from './account-auth.js';
import {
  claimPendingRoomGrants,
  claimGuestRoom,
  createRoomRegistry,
  getEffectiveRoomAccess,
  getRoomSummary,
  getUserByGithubLogin,
  listRoomGrants,
  removePendingRoomGrant,
  removeRoomGrant,
  updateRoomMetadata,
  upsertPendingRoomGrant,
  upsertRoomGrant,
} from './room-access.js';
import { canEdit, canManage, type LinkAccess, type RoomRole } from './room-permissions.js';

interface GitHubUserLookup {
  id: number | string;
  login: string;
}

interface GitHubOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface GitHubOAuthProfile {
  id?: number | string;
  login?: string;
  name?: string | null;
  avatar_url?: string | null;
}

interface AccessRefreshUpdate {
  userId: string;
  role: RoomRole | null;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { ...init, headers });
}

function redirectResponse(location: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Location', location);
  return new Response(null, { ...init, status: init.status || 302, headers });
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sanitizeRole(value: unknown): RoomRole | null {
  return value === 'view' || value === 'edit' || value === 'manage' ? value : null;
}

function sanitizeGithubLogin(value: string): string | null {
  const login = value.trim();
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(login) ? login : null;
}

function sanitizeRoomId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const roomId = value.trim();
  return /^[0-9a-zA-Z][0-9a-zA-Z_-]{0,95}$/.test(roomId) ? roomId : null;
}

function sanitizeLinkAccess(value: unknown): LinkAccess | null {
  return value === 'restricted' || value === 'view' || value === 'edit' ? value : null;
}

function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 120) : null;
}

function sanitizeTokenName(value: unknown): string {
  if (typeof value !== 'string') return 'CLI token';
  const name = value.replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, 80) : 'CLI token';
}

function sanitizeFlowId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const flowId = value.trim();
  return /^flow_[0-9a-f]{64}$/.test(flowId) ? flowId : null;
}

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getRequestUser(db: D1Database, request: Request) {
  return (await getAccessTokenUser(db, bearerTokenFromRequest(request))) || (await getSessionUser(db, request));
}

async function sendAccessRefresh(
  env: Cloudflare.Env,
  roomId: string,
  updates: AccessRefreshUpdate[],
): Promise<boolean> {
  if (!env.INTERNAL_AUTH_SECRET || updates.length === 0) return false;
  const body = JSON.stringify({ updates });
  const issuedAt = Date.now();
  const action = 'access-refresh';
  const signature = await hmacHex(env.INTERNAL_AUTH_SECRET, `${roomId}\n${action}\n${issuedAt}\n${body}`);
  const id = env.MapCollaboration.idFromName(roomId);
  const stub = env.MapCollaboration.get(id);
  const response = await stub.fetch(`https://internal.rooms/${encodeURIComponent(roomId)}/_control/access-refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-orm-control-action': action,
      'x-orm-control-issued-at': String(issuedAt),
      'x-orm-control-signature': signature,
    },
    body,
  });
  return response.ok;
}

async function sendRoomAccessRefresh(env: Cloudflare.Env, roomId: string, reason: string): Promise<boolean> {
  if (!env.INTERNAL_AUTH_SECRET) return false;
  const body = JSON.stringify({ reason, refresh: { mode: 'room' } });
  const issuedAt = Date.now();
  const action = 'access-refresh';
  const signature = await hmacHex(env.INTERNAL_AUTH_SECRET, `${roomId}\n${action}\n${issuedAt}\n${body}`);
  const id = env.MapCollaboration.idFromName(roomId);
  const stub = env.MapCollaboration.get(id);
  const response = await stub.fetch(`https://internal.rooms/${encodeURIComponent(roomId)}/_control/access-refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-orm-control-action': action,
      'x-orm-control-issued-at': String(issuedAt),
      'x-orm-control-signature': signature,
    },
    body,
  });
  return response.ok;
}

async function sendRoomPersistenceControl(
  env: Cloudflare.Env,
  roomId: string,
  persistence: 'ephemeral' | 'persistent',
): Promise<boolean> {
  if (!env.INTERNAL_AUTH_SECRET) return false;
  const body = JSON.stringify({ persistence });
  const issuedAt = Date.now();
  const action = 'room-persistence';
  const signature = await hmacHex(env.INTERNAL_AUTH_SECRET, `${roomId}\n${action}\n${issuedAt}\n${body}`);
  const id = env.MapCollaboration.idFromName(roomId);
  const stub = env.MapCollaboration.get(id);
  const response = await stub.fetch(`https://internal.rooms/${encodeURIComponent(roomId)}/_control/room-persistence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-orm-control-action': action,
      'x-orm-control-issued-at': String(issuedAt),
      'x-orm-control-signature': signature,
    },
    body,
  });
  return response.ok;
}

async function resolveGitHubUser(login: string): Promise<GitHubUserLookup | null> {
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'atlas-realm',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub lookup failed');
  const data = (await response.json()) as Partial<GitHubUserLookup>;
  if (data.id === undefined || typeof data.login !== 'string') throw new Error('Invalid GitHub lookup');
  return { id: data.id, login: data.login };
}

async function exchangeGitHubCode(env: Cloudflare.Env, code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'atlas-realm',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!response.ok) throw new Error('GitHub token exchange failed');
  const data = (await response.json()) as GitHubOAuthTokenResponse;
  if (!data.access_token || data.error) throw new Error('GitHub token exchange failed');
  return data.access_token;
}

async function startGitHubDeviceCode(env: Cloudflare.Env): Promise<GitHubDeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'atlas-realm',
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID || '',
    }),
  });
  if (!response.ok) throw new Error('GitHub device flow start failed');
  const data = (await response.json()) as GitHubDeviceCodeResponse;
  if (
    !data.device_code ||
    !data.user_code ||
    !data.verification_uri ||
    typeof data.expires_in !== 'number' ||
    data.error
  ) {
    throw new Error(data.error_description || data.error || 'Invalid GitHub device flow response');
  }
  return data;
}

async function checkGitHubDeviceToken(env: Cloudflare.Env, deviceCode: string): Promise<GitHubOAuthTokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'atlas-realm',
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID || '',
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  if (!response.ok) throw new Error('GitHub device flow poll failed');
  return (await response.json()) as GitHubOAuthTokenResponse;
}

async function fetchGitHubOAuthProfile(accessToken: string): Promise<GitHubOAuthProfile> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'atlas-realm',
    },
  });
  if (!response.ok) throw new Error('GitHub profile fetch failed');
  return (await response.json()) as GitHubOAuthProfile;
}

function refreshRole(role: RoomRole | 'none' | undefined | null): RoomRole | null {
  return role && role !== 'none' ? role : null;
}

export async function handleAccountApiRequest(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (!env.ACCOUNTS_DB) return jsonResponse({ error: 'accounts-db-not-configured' }, { status: 501 });

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await getRequestUser(env.ACCOUNTS_DB, request);
    return jsonResponse({ user });
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/github/start') {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return jsonResponse({ error: 'github-oauth-not-configured' }, { status: 501 });
    }
    const state = randomToken('state_');
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    authorize.searchParams.set('state', state);
    const headers = new Headers();
    headers.append('Set-Cookie', oauthStateCookie(state));
    headers.append('Set-Cookie', oauthReturnCookie(returnTo));
    return redirectResponse(authorize.toString(), { headers });
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/github/callback') {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return jsonResponse({ error: 'github-oauth-not-configured' }, { status: 501 });
    }
    const expectedState = oauthStateFromRequest(request);
    const actualState = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!expectedState || !actualState || expectedState !== actualState || !code) {
      return jsonResponse({ error: 'invalid-oauth-state' }, { status: 400 });
    }

    try {
      const accessToken = await exchangeGitHubCode(env, code);
      const profile = await fetchGitHubOAuthProfile(accessToken);
      if (profile.id === undefined || typeof profile.login !== 'string') throw new Error('Invalid GitHub profile');
      const user = await upsertGitHubAccount(env.ACCOUNTS_DB, {
        githubId: String(profile.id),
        githubLogin: profile.login,
        displayName: profile.name || profile.login,
        avatarUrl: profile.avatar_url || null,
      });
      await claimPendingRoomGrants(env.ACCOUNTS_DB, user.userId, user.githubId);
      const session = await createSession(env.ACCOUNTS_DB, user.userId);
      const headers = new Headers();
      headers.append('Set-Cookie', sessionCookie(session.sessionId, session.expiresAt));
      headers.append('Set-Cookie', expiredOAuthStateCookie());
      headers.append('Set-Cookie', expiredOAuthReturnCookie());
      return redirectResponse(oauthReturnToFromRequest(request), { headers });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'github-oauth-failed' }, { status: 502 });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/github/device/start') {
    if (!env.GITHUB_CLIENT_ID) {
      return jsonResponse({ error: 'github-oauth-not-configured' }, { status: 501 });
    }
    const body = parseJsonRecord(await request.text());
    const tokenName = sanitizeTokenName(body?.name);

    try {
      const device = await startGitHubDeviceCode(env);
      const intervalSeconds = Math.max(5, Math.min(60, Math.floor(device.interval || 5)));
      const expiresAt = Date.now() + Math.max(1, Math.floor(device.expires_in || 900)) * 1000;
      const flow = await createOAuthDeviceFlow(env.ACCOUNTS_DB, {
        deviceCode: device.device_code as string,
        userCode: device.user_code as string,
        verificationUri: device.verification_uri as string,
        verificationUriComplete: device.verification_uri_complete || null,
        tokenName,
        intervalSeconds,
        expiresAt,
      });
      return jsonResponse(
        {
          flowId: flow.flowId,
          userCode: flow.userCode,
          verificationUri: flow.verificationUri,
          verificationUriComplete: flow.verificationUriComplete,
          expiresAt: flow.expiresAt,
          intervalSeconds: flow.intervalSeconds,
        },
        { status: 201 },
      );
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'github-device-start-failed' },
        { status: 502 },
      );
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/github/device/poll') {
    if (!env.GITHUB_CLIENT_ID) {
      return jsonResponse({ error: 'github-oauth-not-configured' }, { status: 501 });
    }
    const body = parseJsonRecord(await request.text());
    const flowId = sanitizeFlowId(body?.flowId);
    if (!flowId) return jsonResponse({ error: 'invalid-device-flow' }, { status: 400 });

    const flow = await getOAuthDeviceFlow(env.ACCOUNTS_DB, flowId);
    if (!flow) return jsonResponse({ error: 'device-flow-not-found' }, { status: 404 });
    if (flow.status === 'complete') {
      return jsonResponse({ status: 'complete', token: null, intervalSeconds: flow.intervalSeconds });
    }
    if (flow.status === 'denied') return jsonResponse({ status: 'denied', intervalSeconds: flow.intervalSeconds });
    if (flow.status === 'expired') return jsonResponse({ status: 'expired', intervalSeconds: flow.intervalSeconds });

    const now = Date.now();
    if (flow.expiresAt <= now) {
      await markOAuthDeviceFlowTerminal(env.ACCOUNTS_DB, flow.flowId, 'expired', now);
      return jsonResponse({ status: 'expired', intervalSeconds: flow.intervalSeconds });
    }

    const retryAt = (flow.lastPollAt || 0) + flow.intervalSeconds * 1000;
    if (flow.lastPollAt && retryAt > now) {
      return jsonResponse({
        status: 'slow_down',
        intervalSeconds: flow.intervalSeconds,
        retryAfterSeconds: Math.ceil((retryAt - now) / 1000),
      });
    }

    try {
      await recordOAuthDeviceFlowPoll(env.ACCOUNTS_DB, flow.flowId, flow.intervalSeconds, now);
      const tokenResponse = await checkGitHubDeviceToken(env, flow.deviceCode);

      if (tokenResponse.error === 'authorization_pending') {
        return jsonResponse({ status: 'pending', intervalSeconds: flow.intervalSeconds });
      }

      if (tokenResponse.error === 'slow_down') {
        const intervalSeconds = Math.min(120, flow.intervalSeconds + 5);
        await recordOAuthDeviceFlowPoll(env.ACCOUNTS_DB, flow.flowId, intervalSeconds, now);
        return jsonResponse({ status: 'slow_down', intervalSeconds });
      }

      if (tokenResponse.error === 'expired_token') {
        await markOAuthDeviceFlowTerminal(env.ACCOUNTS_DB, flow.flowId, 'expired', now);
        return jsonResponse({ status: 'expired', intervalSeconds: flow.intervalSeconds });
      }

      if (tokenResponse.error === 'access_denied') {
        await markOAuthDeviceFlowTerminal(env.ACCOUNTS_DB, flow.flowId, 'denied', now);
        return jsonResponse({ status: 'denied', intervalSeconds: flow.intervalSeconds });
      }

      if (!tokenResponse.access_token || tokenResponse.error) {
        return jsonResponse(
          { error: tokenResponse.error_description || tokenResponse.error || 'github-device-poll-failed' },
          { status: 502 },
        );
      }

      const profile = await fetchGitHubOAuthProfile(tokenResponse.access_token);
      if (profile.id === undefined || typeof profile.login !== 'string') throw new Error('Invalid GitHub profile');
      const user = await upsertGitHubAccount(env.ACCOUNTS_DB, {
        githubId: String(profile.id),
        githubLogin: profile.login,
        displayName: profile.name || profile.login,
        avatarUrl: profile.avatar_url || null,
      });
      await claimPendingRoomGrants(env.ACCOUNTS_DB, user.userId, user.githubId);
      const created = await createAccessToken(env.ACCOUNTS_DB, user.userId, flow.tokenName, now);
      await completeOAuthDeviceFlow(env.ACCOUNTS_DB, flow.flowId, created.summary.tokenId, now);
      return jsonResponse({
        status: 'complete',
        token: created.token,
        accessToken: created.summary,
        user,
      });
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'github-device-poll-failed' },
        { status: 502 },
      );
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    await revokeSession(env.ACCOUNTS_DB, request);
    return jsonResponse(
      { ok: true },
      {
        headers: {
          'Set-Cookie': expiredSessionCookie(),
        },
      },
    );
  }

  if (url.pathname === '/api/tokens') {
    const user = await getSessionUser(env.ACCOUNTS_DB, request);
    if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      return jsonResponse({ tokens: await listAccessTokens(env.ACCOUNTS_DB, user.userId) });
    }

    if (request.method === 'POST') {
      const body = parseJsonRecord(await request.text());
      const created = await createAccessToken(env.ACCOUNTS_DB, user.userId, sanitizeTokenName(body?.name));
      return jsonResponse({ token: created.token, accessToken: created.summary }, { status: 201 });
    }
  }

  const tokenMatch = url.pathname.match(/^\/api\/tokens\/([^/]+)$/);
  if (tokenMatch) {
    const user = await getSessionUser(env.ACCOUNTS_DB, request);
    if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 });

    if (request.method === 'DELETE') {
      await revokeAccessToken(env.ACCOUNTS_DB, user.userId, decodeURIComponent(tokenMatch[1]));
      return jsonResponse({ ok: true });
    }
  }

  if (url.pathname === '/api/rooms') {
    if (request.method === 'POST') {
      const body = parseJsonRecord(await request.text());
      const roomId = sanitizeRoomId(body?.roomId);
      if (!roomId) return jsonResponse({ error: 'invalid-room-id' }, { status: 400 });

      const user = await getRequestUser(env.ACCOUNTS_DB, request);
      const room = await createRoomRegistry(env.ACCOUNTS_DB, {
        roomId,
        title: sanitizeTitle(body?.title),
        ownerUserId: user?.userId || null,
        createdByKind: user ? 'user' : 'guest',
        createdByGuestId: user ? null : request.headers.get('x-orm-guest-id'),
        persistence: user ? 'persistent' : 'ephemeral',
        linkAccess: user ? 'restricted' : 'edit',
      });
      if (!(await sendRoomPersistenceControl(env, room.roomId, room.persistence))) {
        return jsonResponse({ error: 'room-persistence-sync-failed' }, { status: 503 });
      }
      return jsonResponse({ room }, { status: 201 });
    }
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    if (request.method === 'GET') {
      const room = await getRoomSummary(env.ACCOUNTS_DB, roomId);
      if (!room) return jsonResponse({ error: 'room-not-found' }, { status: 404 });
      return jsonResponse({ room });
    }

    if (request.method === 'PATCH') {
      const user = await getRequestUser(env.ACCOUNTS_DB, request);
      if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
      const body = parseJsonRecord(await request.text());
      const linkAccess = body && 'linkAccess' in body ? sanitizeLinkAccess(body.linkAccess) : undefined;
      if (body && 'linkAccess' in body && !linkAccess)
        return jsonResponse({ error: 'invalid-link-access' }, { status: 400 });
      try {
        const room = await updateRoomMetadata(env.ACCOUNTS_DB, {
          roomId,
          actorUserId: user.userId,
          title: body && 'title' in body ? sanitizeTitle(body.title) : undefined,
          linkAccess,
        });
        if (linkAccess && !(await sendRoomAccessRefresh(env, room.roomId, 'link-access-updated'))) {
          return jsonResponse({ error: 'access-refresh-failed' }, { status: 503 });
        }
        return jsonResponse({ room });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : 'forbidden' }, { status: 403 });
      }
    }
  }

  const claimMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/claim$/);
  if (request.method === 'POST' && claimMatch) {
    const user = await getRequestUser(env.ACCOUNTS_DB, request);
    if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    const roomId = decodeURIComponent(claimMatch[1]);
    try {
      const room = await claimGuestRoom(env.ACCOUNTS_DB, roomId, user.userId);
      if (!(await sendRoomPersistenceControl(env, room.roomId, 'persistent'))) {
        return jsonResponse({ error: 'room-persistence-sync-failed' }, { status: 503 });
      }
      if (!(await sendRoomAccessRefresh(env, room.roomId, 'owner-updated'))) {
        return jsonResponse({ error: 'access-refresh-failed' }, { status: 503 });
      }
      return jsonResponse({ room });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'forbidden' }, { status: 403 });
    }
  }

  const accessMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/access$/);
  if (request.method === 'GET' && accessMatch) {
    const roomId = decodeURIComponent(accessMatch[1]);
    const user = await getRequestUser(env.ACCOUNTS_DB, request);
    const access = await getEffectiveRoomAccess(env.ACCOUNTS_DB, roomId, user?.userId || null);
    if (!access) return jsonResponse({ error: 'room-not-found' }, { status: 404 });
    return jsonResponse({
      role: access.role,
      canView: access.role !== 'none',
      canEdit: canEdit(access.role),
      canManage: canManage(access.role),
      room: {
        roomId: access.roomId,
        ownerUserId: access.ownerUserId,
        createdByKind: access.createdByKind,
        persistence: access.persistence,
        linkAccess: access.linkAccess,
      },
      user,
    });
  }

  const grantsCollectionMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/grants$/);
  if (grantsCollectionMatch) {
    const roomId = decodeURIComponent(grantsCollectionMatch[1]);
    const user = await getRequestUser(env.ACCOUNTS_DB, request);
    if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      try {
        return jsonResponse({ grants: await listRoomGrants(env.ACCOUNTS_DB, roomId, user.userId) });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : 'forbidden' }, { status: 403 });
      }
    }
  }

  const grantMemberMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/grants\/([^/]+)$/);
  if (grantMemberMatch) {
    const roomId = decodeURIComponent(grantMemberMatch[1]);
    const member = decodeURIComponent(grantMemberMatch[2]);
    const user = await getRequestUser(env.ACCOUNTS_DB, request);
    if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 });

    if (request.method === 'PUT') {
      const body = parseJsonRecord(await request.text());
      const role = sanitizeRole(body?.role);
      const githubLogin = sanitizeGithubLogin(member);
      if (!role || !githubLogin) return jsonResponse({ error: 'invalid-grant' }, { status: 400 });

      try {
        const existingUser = await getUserByGithubLogin(env.ACCOUNTS_DB, githubLogin);
        if (existingUser) {
          await upsertRoomGrant(env.ACCOUNTS_DB, {
            roomId,
            actorUserId: user.userId,
            targetUserId: existingUser.userId,
            targetRole: role,
          });
          const access = await getEffectiveRoomAccess(env.ACCOUNTS_DB, roomId, existingUser.userId);
          if (
            !(await sendAccessRefresh(env, roomId, [{ userId: existingUser.userId, role: refreshRole(access?.role) }]))
          ) {
            return jsonResponse({ error: 'access-refresh-failed' }, { status: 503 });
          }
          return jsonResponse({
            grant: { userId: existingUser.userId, githubLogin: existingUser.githubLogin, role, pending: false },
          });
        }

        const githubUser = await resolveGitHubUser(githubLogin);
        if (!githubUser) return jsonResponse({ error: 'github-user-not-found' }, { status: 404 });
        await upsertPendingRoomGrant(env.ACCOUNTS_DB, {
          roomId,
          actorUserId: user.userId,
          githubId: String(githubUser.id),
          githubLogin: githubUser.login,
          targetRole: role,
        });
        return jsonResponse({
          grant: { githubId: String(githubUser.id), githubLogin: githubUser.login, role, pending: true },
        });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : 'forbidden' }, { status: 403 });
      }
    }

    if (request.method === 'DELETE') {
      try {
        if (member.startsWith('github:')) {
          const githubId = member.slice('github:'.length);
          if (!githubId) return jsonResponse({ error: 'invalid-grant' }, { status: 400 });
          await removePendingRoomGrant(env.ACCOUNTS_DB, roomId, githubId, user.userId);
        } else {
          await removeRoomGrant(env.ACCOUNTS_DB, roomId, member, user.userId);
          const access = await getEffectiveRoomAccess(env.ACCOUNTS_DB, roomId, member);
          if (!(await sendAccessRefresh(env, roomId, [{ userId: member, role: refreshRole(access?.role) }]))) {
            return jsonResponse({ error: 'access-refresh-failed' }, { status: 503 });
          }
        }
        return jsonResponse({ ok: true });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : 'forbidden' }, { status: 403 });
      }
    }
  }

  return jsonResponse({ error: 'not-found' }, { status: 404 });
}
