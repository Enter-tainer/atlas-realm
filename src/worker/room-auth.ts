import { AUTH_HEADER_MAX_AGE_MS } from './room-constants.js';
import { isRecord, sanitizeText } from './json-utils.js';
import type { AccessRefreshMode, AccessRefreshUpdate, AuthContext } from './room-types.js';
import type { RoomRole } from '../room-permissions.js';

const textEncoder = new TextEncoder();

export function sanitizePeerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[0-9a-zA-Z_-]{1,96}$/.test(id) ? id : null;
}

export function sanitizeRoomRole(value: unknown): RoomRole | null {
  return value === 'view' || value === 'edit' || value === 'manage' ? value : null;
}

export function sanitizeAuthKind(value: unknown): AuthContext['authKind'] | null {
  return value === 'anonymous' || value === 'user' || value === 'token' ? value : null;
}

export function sanitizeAccessRefreshMode(value: unknown): AccessRefreshMode | null {
  return value === 'users' || value === 'room' ? value : null;
}

export function sanitizeAccessRefreshUpdate(value: unknown): AccessRefreshUpdate | null {
  if (!isRecord(value)) return null;
  const userId = sanitizePeerId(value.userId);
  const role = value.role === null || value.role === 'none' ? null : sanitizeRoomRole(value.role);
  if (!userId || (role === null && value.role !== null && value.role !== 'none')) return null;
  return { userId, role };
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload)));
}

export async function verifyAuthHeaders(
  request: Request,
  roomName: string,
  secret: string | undefined,
): Promise<AuthContext | null> {
  if (!secret) return null;

  const userId = sanitizePeerId(request.headers.get('x-orm-auth-user-id'));
  const role = sanitizeRoomRole(request.headers.get('x-orm-room-role'));
  const clientId = sanitizePeerId(request.headers.get('x-orm-client-id'));
  const agentId = sanitizePeerId(request.headers.get('x-orm-agent-id')) || '';
  const authKind = sanitizeAuthKind(request.headers.get('x-orm-auth-kind'));
  const issuedAt = Number(request.headers.get('x-orm-auth-issued-at'));
  const signature = String(request.headers.get('x-orm-auth-signature') || '').toLowerCase();
  if (!userId || !role || !clientId || !authKind || !Number.isFinite(issuedAt) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new Error('Unauthorized room connection');
  }

  const now = Date.now();
  if (Math.abs(now - issuedAt) > AUTH_HEADER_MAX_AGE_MS) {
    throw new Error('Unauthorized room connection');
  }

  const payload = `${roomName}\n${userId}\n${role}\n${clientId}\n${agentId}\n${authKind}\n${issuedAt}`;
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEqualHex(expected, signature)) {
    throw new Error('Unauthorized room connection');
  }

  const displayName = sanitizeText(request.headers.get('x-orm-auth-user-name'), userId, 80);
  const avatarUrl = sanitizeText(request.headers.get('x-orm-auth-user-avatar'), '', 512) || null;
  return {
    userId,
    role,
    issuedAt,
    clientId,
    agentId: agentId || null,
    authKind,
    displayName,
    avatarUrl,
  };
}

export async function verifyControlRequest(
  request: Request,
  roomName: string,
  secret: string | undefined,
  body: string,
): Promise<string> {
  if (!secret) throw new Error('Unauthorized control request');

  const action = sanitizeText(request.headers.get('x-orm-control-action'), '', 80);
  const issuedAt = Number(request.headers.get('x-orm-control-issued-at'));
  const signature = String(request.headers.get('x-orm-control-signature') || '').toLowerCase();
  if (!action || !Number.isFinite(issuedAt) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new Error('Unauthorized control request');
  }
  if (Math.abs(Date.now() - issuedAt) > AUTH_HEADER_MAX_AGE_MS) {
    throw new Error('Unauthorized control request');
  }

  const payload = `${roomName}\n${action}\n${issuedAt}\n${body}`;
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEqualHex(expected, signature)) {
    throw new Error('Unauthorized control request');
  }
  return action;
}
