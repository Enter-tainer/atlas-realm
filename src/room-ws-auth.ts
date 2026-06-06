import { bearerTokenFromRequest, getAccessTokenUser, getSessionUser, type AccountUser } from './account-auth.js';
import { getEffectiveRoomAccess } from './room-access.js';
import { canView, type RoomRole } from './room-permissions.js';

interface PartyRoute {
  party: string;
  roomId: string;
}

export interface PreparedPartyRequest {
  request: Request;
  roomId: string;
  role: RoomRole;
  user: AccountUser | null;
  clientId: string;
}

function parsePartyRoute(pathname: string): PartyRoute | null {
  const match = pathname.match(/^\/parties\/([^/]+)\/([^/]+)(?:\/.*)?$/);
  if (!match) return null;
  return {
    party: decodeURIComponent(match[1]),
    roomId: decodeURIComponent(match[2]),
  };
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

function sanitizePeerId(value: string | null, fallback: string): string {
  const id = (value || '').trim();
  return /^[0-9a-zA-Z_-]{1,96}$/.test(id) ? id : fallback;
}

function authKindFor(tokenUser: AccountUser | null, sessionUser: AccountUser | null): 'anonymous' | 'token' | 'user' {
  if (tokenUser) return 'token';
  if (sessionUser) return 'user';
  return 'anonymous';
}

function displayNameForConnection({
  user,
  url,
  authUserId,
}: {
  user: AccountUser | null;
  url: URL;
  authUserId: string;
}): string {
  const accountName = user?.displayName || user?.githubLogin || '';
  const requestedName = (url.searchParams.get('name') || '').trim();
  const isAgent = url.searchParams.get('clientType') === 'agent';
  if (user && isAgent && requestedName) return `${accountName || authUserId} / ${requestedName}`;
  return accountName || requestedName || (user ? authUserId : 'Guest');
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isPartyWebSocketRequest(request: Request): boolean {
  return isWebSocketUpgrade(request) && Boolean(parsePartyRoute(new URL(request.url).pathname));
}

export async function preparePartyWebSocketRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<PreparedPartyRequest | Response | null> {
  if (!isPartyWebSocketRequest(request)) return null;
  if (!env.ACCOUNTS_DB || !env.INTERNAL_AUTH_SECRET)
    return new Response('Room auth is not configured', { status: 503 });

  const url = new URL(request.url);
  const route = parsePartyRoute(url.pathname);
  if (!route) return null;

  const tokenUser = await getAccessTokenUser(env.ACCOUNTS_DB, bearerTokenFromRequest(request));
  const sessionUser = tokenUser ? null : await getSessionUser(env.ACCOUNTS_DB, request);
  const user = tokenUser || sessionUser;
  const authKind = authKindFor(tokenUser, sessionUser);
  const access = await getEffectiveRoomAccess(env.ACCOUNTS_DB, route.roomId, user?.userId || null);
  if (!access || !canView(access.role))
    return new Response(user ? 'Forbidden' : 'Unauthorized', { status: user ? 403 : 401 });
  const role = access.role as RoomRole;

  const rawClientId = url.searchParams.get('_pk') || url.searchParams.get('userId');
  const clientId = sanitizePeerId(rawClientId, `client_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`);
  const authUserId = user?.userId || `anon_${clientId}`;
  const displayName = displayNameForConnection({ user, url, authUserId });
  const issuedAt = Date.now();
  const headers = new Headers(request.headers);
  headers.set('x-orm-auth-user-id', authUserId);
  headers.set('x-orm-auth-user-name', displayName);
  if (user?.avatarUrl) headers.set('x-orm-auth-user-avatar', user.avatarUrl);
  else headers.delete('x-orm-auth-user-avatar');
  headers.set('x-orm-room-role', role);
  headers.set('x-orm-auth-issued-at', String(issuedAt));
  headers.set('x-orm-client-id', clientId);
  const agentId = url.searchParams.get('clientType') === 'agent' ? clientId : '';
  if (agentId) headers.set('x-orm-agent-id', agentId);
  else headers.delete('x-orm-agent-id');
  headers.set('x-orm-auth-kind', authKind);
  const signature = await hmacHex(
    env.INTERNAL_AUTH_SECRET,
    `${route.roomId}\n${authUserId}\n${role}\n${clientId}\n${agentId}\n${authKind}\n${issuedAt}`,
  );
  headers.set('x-orm-auth-signature', signature);

  return {
    request: new Request(request, { headers }),
    roomId: route.roomId,
    role,
    user,
    clientId,
  };
}
