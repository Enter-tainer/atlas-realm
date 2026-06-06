import { describe, expect, it } from 'vitest';
import { verifyAuthHeaders, verifyControlRequest } from './room-auth.js';

const SECRET = 'test-secret';
const ROOM = 'room-a';
const textEncoder = new TextEncoder();

async function hmacHex(payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authRequest({
  room = ROOM,
  userId = 'user-a',
  role = 'edit',
  clientId = 'client-a',
  agentId = '',
  authKind = 'user',
  issuedAt = Date.now(),
}: {
  room?: string;
  userId?: string;
  role?: 'view' | 'edit' | 'manage';
  clientId?: string;
  agentId?: string;
  authKind?: 'anonymous' | 'user' | 'token';
  issuedAt?: number;
} = {}) {
  const payload = `${room}\n${userId}\n${role}\n${clientId}\n${agentId}\n${authKind}\n${issuedAt}`;
  return new Request('https://example.test/room', {
    headers: {
      'x-orm-auth-user-id': userId,
      'x-orm-room-role': role,
      'x-orm-client-id': clientId,
      'x-orm-agent-id': agentId,
      'x-orm-auth-kind': authKind,
      'x-orm-auth-issued-at': String(issuedAt),
      'x-orm-auth-user-name': 'Alice',
      'x-orm-auth-signature': await hmacHex(payload),
    },
  });
}

async function controlRequest({
  room = ROOM,
  action = 'access-refresh',
  issuedAt = Date.now(),
  body = '{"ok":true}',
}: {
  room?: string;
  action?: string;
  issuedAt?: number;
  body?: string;
} = {}) {
  const payload = `${room}\n${action}\n${issuedAt}\n${body}`;
  return new Request('https://example.test/_control/access-refresh', {
    method: 'POST',
    headers: {
      'x-orm-control-action': action,
      'x-orm-control-issued-at': String(issuedAt),
      'x-orm-control-signature': await hmacHex(payload),
    },
    body,
  });
}

describe('worker room auth', () => {
  it('verifies signed room auth headers', async () => {
    const auth = await verifyAuthHeaders(await authRequest(), ROOM, SECRET);

    expect(auth).toMatchObject({
      userId: 'user-a',
      role: 'edit',
      clientId: 'client-a',
      authKind: 'user',
      displayName: 'Alice',
    });
  });

  it('rejects stale or room-mismatched auth headers', async () => {
    await expect(
      verifyAuthHeaders(await authRequest({ issuedAt: Date.now() - 120_000 }), ROOM, SECRET),
    ).rejects.toThrow('Unauthorized room connection');
    await expect(verifyAuthHeaders(await authRequest({ room: 'other-room' }), ROOM, SECRET)).rejects.toThrow(
      'Unauthorized room connection',
    );
  });

  it('verifies signed control requests', async () => {
    const body = '{"refresh":{"mode":"room"}}';
    const request = await controlRequest({ body });

    await expect(verifyControlRequest(request, ROOM, SECRET, body)).resolves.toBe('access-refresh');
  });

  it('rejects stale or body-mismatched control requests', async () => {
    const staleBody = '{}';
    await expect(
      verifyControlRequest(
        await controlRequest({ issuedAt: Date.now() - 120_000, body: staleBody }),
        ROOM,
        SECRET,
        staleBody,
      ),
    ).rejects.toThrow('Unauthorized control request');

    await expect(
      verifyControlRequest(await controlRequest({ body: '{"a":1}' }), ROOM, SECRET, '{"a":2}'),
    ).rejects.toThrow('Unauthorized control request');
  });
});
