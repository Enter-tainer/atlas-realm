import { parseJsonRecord } from './json-utils.js';
import type { RoomPersistence } from './room-types.js';

export interface RoomControlContext {
  _verifyControlRequest(request: Request, body: string): Promise<string>;
  _applyAccessRefreshPayload(payload: Record<string, unknown> | null): Promise<number | null>;
  _setRoomPersistence(persistence: RoomPersistence): Promise<unknown>;
}

export async function handleRoomControlRequest(room: RoomControlContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/_control/access-refresh')) {
    const body = await request.text();
    try {
      const action = await room._verifyControlRequest(request, body);
      if (action !== 'access-refresh') return new Response('Unknown control action', { status: 404 });
      const payload = parseJsonRecord(body);
      const refreshed = await room._applyAccessRefreshPayload(payload);
      if (refreshed === null) return new Response('Invalid access refresh', { status: 400 });
      return Response.json({ ok: true, refreshed });
    } catch {
      return new Response('Unauthorized control request', { status: 403 });
    }
  }
  if (url.pathname.endsWith('/_control/room-persistence')) {
    const body = await request.text();
    try {
      const action = await room._verifyControlRequest(request, body);
      if (action !== 'room-persistence') return new Response('Unknown control action', { status: 404 });
      const payload = parseJsonRecord(body);
      const persistence =
        payload?.persistence === 'persistent'
          ? 'persistent'
          : payload?.persistence === 'ephemeral'
            ? 'ephemeral'
            : null;
      if (!persistence) return new Response('Invalid room persistence', { status: 400 });
      const status = await room._setRoomPersistence(persistence);
      return Response.json({ ok: true, status });
    } catch {
      return new Response('Unauthorized control request', { status: 403 });
    }
  }
  return new Response('Map collaboration room is ready.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
