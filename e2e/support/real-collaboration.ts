import { expect, type Page } from '@playwright/test';
import { openRealCollaborationRoom } from './map-interactions';

export type JsonRecord = Record<string, unknown>;
export type RealRoomClient = {
  send(message: JsonRecord): Promise<void>;
  messages(): Promise<JsonRecord[]>;
  waitFor(type: string, predicate?: (message: JsonRecord) => boolean, timeoutMs?: number): Promise<JsonRecord>;
  close(): Promise<void>;
};

export function uniqueRoomName(prefix: string, testTitle: string) {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const maxSlugLength = Math.max(8, 64 - prefix.length - suffix.length - 2);
  const slug = testTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxSlugLength);
  return `${prefix}-${slug}-${suffix}`.slice(0, 64);
}

export function sortKey(index: number) {
  return String(Math.max(0, index) * 10 + 10).padStart(6, '0');
}

export function annotationLayer(id: string, name: string, index = 0): JsonRecord {
  const now = Date.now();
  return {
    id,
    kind: 'annotation',
    name,
    visible: true,
    sortKey: sortKey(index),
    payload: { version: 1 },
    revision: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'e2e',
  };
}

export function pointFeature({
  id,
  layerId,
  label,
  index = 0,
  lng = 121.456,
  lat = 31.226,
  note = '',
}: {
  id: string;
  layerId: string;
  label: string;
  index?: number;
  lng?: number;
  lat?: number;
  note?: string;
}): JsonRecord {
  const now = Date.now();
  return {
    id,
    layerId,
    featureType: 'point',
    sortKey: sortKey(index),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'e2e',
    payload: {
      id,
      layerId,
      type: 'point',
      label,
      note,
      color: '#2563eb',
      coordinate: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
      createdAt: now,
      updatedAt: now,
      updatedBy: 'e2e',
    },
  };
}

export function longTextFeature({
  id,
  layerId,
  label,
  note,
  index = 0,
}: {
  id: string;
  layerId: string;
  label: string;
  note: string;
  index?: number;
}): JsonRecord {
  const now = Date.now();
  return {
    id,
    layerId,
    featureType: 'text',
    sortKey: sortKey(index),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'e2e',
    payload: {
      id,
      layerId,
      type: 'text',
      label,
      note,
      color: '#db2777',
      coordinate: [121.462, 31.224],
      width: 900,
      height: 20,
      createdAt: now,
      updatedAt: now,
      updatedBy: 'e2e',
    },
  };
}

export async function ensureRealRoom(page: Page, room: string) {
  const response = await page.request.post('/api/rooms', {
    data: { roomId: room },
  });
  expect(response.status(), 'real room should be created through the local worker').toBeLessThan(300);
}

export async function openRealRoom(page: Page, room: string) {
  await ensureRealRoom(page, room);
  await openRealCollaborationRoom(page, room);
}

export async function createProtocolClient(
  page: Page,
  room: string,
  name = 'Protocol Client',
): Promise<RealRoomClient> {
  await ensureRealRoom(page, room);
  await page.evaluate(
    ({ room, name }) => {
      type ClientWindow = Window &
        typeof globalThis & {
          __e2eRoomClients?: Record<
            string,
            {
              ws: WebSocket;
              messages: JsonRecord[];
            }
          >;
        };
      const targetWindow = window as ClientWindow;
      targetWindow.__e2eRoomClients ||= {};
      const url = new URL(`/parties/map-collaboration/${encodeURIComponent(room)}`, window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('clientType', 'human');
      url.searchParams.set('headless', 'true');
      url.searchParams.set('userId', `e2e-${Math.random().toString(36).slice(2)}`);
      url.searchParams.set('name', name);
      url.searchParams.set('color', '#0f766e');
      const ws = new WebSocket(url.href);
      const messages: JsonRecord[] = [];
      targetWindow.__e2eRoomClients[room] = { ws, messages };
      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        try {
          messages.push(JSON.parse(event.data) as JsonRecord);
        } catch {
          // Ignore non-JSON protocol frames.
        }
      });
    },
    { room, name },
  );
  await page.waitForFunction((room) => {
    const client = (window as typeof window & { __e2eRoomClients?: Record<string, { ws: WebSocket }> })
      .__e2eRoomClients?.[String(room)];
    return client?.ws.readyState === WebSocket.OPEN;
  }, room);

  return {
    async send(message: JsonRecord) {
      await page.evaluate(
        ({ room, message }) => {
          const client = (window as typeof window & { __e2eRoomClients?: Record<string, { ws: WebSocket }> })
            .__e2eRoomClients?.[room];
          if (!client || client.ws.readyState !== WebSocket.OPEN) throw new Error(`Room client not open: ${room}`);
          client.ws.send(JSON.stringify(message));
        },
        { room, message },
      );
    },
    async messages() {
      return await page.evaluate((room) => {
        return (
          (window as typeof window & { __e2eRoomClients?: Record<string, { messages: JsonRecord[] }> })
            .__e2eRoomClients?.[String(room)]?.messages || []
        );
      }, room);
    },
    async waitFor(type: string, predicate?: (message: JsonRecord) => boolean, timeoutMs = 10_000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const match = (await this.messages()).find(
          (message) => message.type === type && (!predicate || predicate(message)),
        );
        if (match) return match;
        await page.waitForTimeout(50);
      }
      throw new Error(`Timed out waiting for ${type}`);
    },
    async close() {
      await page.evaluate((room) => {
        const clients = (window as typeof window & { __e2eRoomClients?: Record<string, { ws: WebSocket }> })
          .__e2eRoomClients;
        const client = clients?.[String(room)];
        client?.ws.close(1000, 'e2e close');
        if (clients) delete clients[String(room)];
      }, room);
    },
  };
}

export async function sendBurst(client: RealRoomClient, messages: JsonRecord[]) {
  for (const message of messages) await client.send(message);
}
