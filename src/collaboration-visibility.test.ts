// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationFixtureState } from './collaboration.js';
import { LayerStore } from './layer-store.js';
import type { AnnotationFeature, Layer } from './layer-model.js';

const mockSockets: MockPartySocket[] = [];

class MockPartySocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: unknown[] = [];
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });

  constructor(public options: Record<string, unknown>) {
    super();
    mockSockets.push(this);
  }

  send(message: unknown) {
    this.sent.push(message);
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  message(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }));
  }

  closeFromServer() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
  }
}

vi.mock('partysocket', () => ({
  default: MockPartySocket,
}));

function mockMap() {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const listeners = new Map<string, Set<(ev: { lngLat: { toArray(): [number, number] } }) => void>>();

  return {
    el: container,
    fire(event: string, data: { lngLat: { toArray(): [number, number] } }) {
      const handlers = listeners.get(event);
      if (handlers) for (const fn of handlers) fn(data);
    },
    getContainer: () => container,
    getCanvas: () => canvas,
    project: vi.fn(() => ({ x: 100, y: 200 })),
    unproject: vi.fn(() => ({ toArray: (): [number, number] => [0, 0] })),
    getCenter: vi.fn(() => ({ toArray: (): [number, number] => [121.5, 31.2] })),
    getZoom: vi.fn(() => 10),
    getBearing: vi.fn(() => 0),
    getPitch: vi.fn(() => 0),
    easeTo: vi.fn(),
    on(event: string, handler: (ev: { lngLat: { toArray(): [number, number] } }) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
  };
}

const NOW = 1_700_000_000_000;

function annotationLayer(id: string, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    kind: 'annotation',
    name: id,
    visible: true,
    sortKey: '000020',
    payload: { version: 1 },
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function annotationFeature(id: string, layerId: string, extra: Partial<AnnotationFeature> = {}): AnnotationFeature {
  return {
    id,
    layerId,
    featureType: 'path',
    payload: {
      id,
      type: 'path',
      layerId,
      points: [
        [121.5, 31.2],
        [121.6, 31.3],
      ],
      directed: true,
      width: 4,
      lineStyle: 'solid',
      opacity: 0.9,
      label: id,
      note: '',
      color: '#2563eb',
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: 'user-a',
    },
    sortKey: '000010',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
    ...extra,
  };
}

function sentJson(socket: MockPartySocket, type?: string) {
  return socket.sent
    .filter((message): message is string => typeof message === 'string')
    .map((message) => {
      try {
        return JSON.parse(message) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((message) => !type || message.type === type);
}

describe('background disconnect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockSockets.length = 0;
    vi.unstubAllGlobals();
  });

  it('disconnects after 30s hidden, reconnects on visible', async () => {
    const { installMapCollaboration } = await import('./collaboration.js');
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });

    const map = mockMap();

    const fixture: CollaborationFixtureState = {
      roomId: 'test-room',
      currentUser: null,
      roomAccess: {
        role: 'edit',
        canView: true,
        canEdit: true,
        canManage: false,
        linkAccess: 'restricted',
        room: { ownerUserId: null, createdByKind: 'guest', persistence: 'ephemeral' },
      },
      peers: [],
      agents: [],
      connectionState: 'live',
      connectionLabel: 'Live',
    };

    const collab = installMapCollaboration(map, undefined, {
      fixture,
    });

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(29_000);
    expect(map.el.querySelector('.collab-panel')?.getAttribute('data-connection')).toBe('live');

    vi.advanceTimersByTime(2_000);
    expect(map.el.querySelector('.collab-panel')?.getAttribute('data-connection')).toBe('idle');
    expect(collab.destroy).toBeTypeOf('function');

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.useRealTimers();
  });

  it('cancels the background timer if tab returns within 30s', async () => {
    const { installMapCollaboration } = await import('./collaboration.js');
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });

    const map = mockMap();
    const fixture: CollaborationFixtureState = {
      roomId: 'test-room',
      currentUser: null,
      roomAccess: {
        role: 'edit',
        canView: true,
        canEdit: true,
        canManage: false,
        linkAccess: 'restricted',
        room: { ownerUserId: null, createdByKind: 'guest', persistence: 'ephemeral' },
      },
      peers: [],
      agents: [],
      connectionState: 'live',
      connectionLabel: 'Live',
    };

    const collab = installMapCollaboration(map, undefined, {
      fixture,
    });

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(map.el.querySelector('.collab-panel')?.getAttribute('data-connection')).toBe('live');

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(30_000);

    expect(map.el.querySelector('.collab-panel')?.getAttribute('data-connection')).toBe('live');
    expect(collab.destroy).toBeTypeOf('function');
    collab.destroy();
    vi.useRealTimers();
  });

  it('does not throw when destroyed while background timer is pending', async () => {
    const { installMapCollaboration } = await import('./collaboration.js');
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });

    const map = mockMap();
    const fixture: CollaborationFixtureState = {
      roomId: 'test-room',
      currentUser: null,
      roomAccess: {
        role: 'edit',
        canView: true,
        canEdit: true,
        canManage: false,
        linkAccess: 'restricted',
        room: { ownerUserId: null, createdByKind: 'guest', persistence: 'ephemeral' },
      },
      peers: [],
      agents: [],
      connectionState: 'live',
      connectionLabel: 'Live',
    };

    const collab = installMapCollaboration(map, undefined, {
      fixture,
    });

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    collab.destroy();

    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    vi.useRealTimers();
  });

  it('keeps an active PartySocket during a short hide and reconnects only after the background timeout', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return Response.json({ user: null });
        if (url === '/api/rooms') return Response.json({ room: { roomId: 'test-room' } }, { status: 201 });
        if (url === '/api/rooms/test-room/access') {
          return Response.json({
            role: 'edit',
            canView: true,
            canEdit: true,
            canManage: false,
            room: { linkAccess: 'edit', ownerUserId: null, createdByKind: 'guest', persistence: 'ephemeral' },
          });
        }
        return Response.json({});
      }),
    );

    window.history.replaceState(null, '', '/?room=test-room');
    const { installMapCollaboration } = await import('./collaboration.js');
    const collab = installMapCollaboration(mockMap());
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockSockets).toHaveLength(1);
    mockSockets[0].open();
    expect(mockSockets[0].sent).toContain(JSON.stringify({ type: 'layer:list:request' }));

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10_000);
    expect(mockSockets[0].close).not.toHaveBeenCalled();
    expect(mockSockets).toHaveLength(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(30_000);
    expect(mockSockets[0].close).not.toHaveBeenCalled();
    expect(mockSockets).toHaveLength(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(31_000);
    expect(mockSockets[0].close).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    expect(mockSockets).toHaveLength(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockSockets).toHaveLength(2);
    collab.destroy();
    vi.useRealTimers();
  });

  it('stops PartySocket background autoreconnect if the hidden socket closes before the timeout', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return Response.json({ user: null });
        if (url === '/api/rooms') return Response.json({ room: { roomId: 'test-room' } }, { status: 201 });
        if (url === '/api/rooms/test-room/access') {
          return Response.json({
            role: 'edit',
            canView: true,
            canEdit: true,
            canManage: false,
            room: { linkAccess: 'edit', ownerUserId: null, createdByKind: 'guest', persistence: 'ephemeral' },
          });
        }
        return Response.json({});
      }),
    );

    window.history.replaceState(null, '', '/?room=test-room');
    const { installMapCollaboration } = await import('./collaboration.js');
    const collab = installMapCollaboration(mockMap());
    await vi.runAllTimersAsync();
    await Promise.resolve();

    mockSockets[0].open();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    mockSockets[0].closeFromServer();

    expect(mockSockets[0].close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(mockSockets).toHaveLength(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockSockets).toHaveLength(2);
    collab.destroy();
    vi.useRealTimers();
  });

  it('diffs initial sync against the local snapshot captured before server lists apply', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return Response.json({ user: null });
        if (url === '/api/rooms') return Response.json({ room: { roomId: 'test-room' } }, { status: 201 });
        if (url === '/api/rooms/test-room/access') {
          return Response.json({
            role: 'edit',
            canView: true,
            canEdit: true,
            canManage: false,
            room: { linkAccess: 'edit', ownerUserId: null, createdByKind: 'guest', persistence: 'ephemeral' },
          });
        }
        return Response.json({});
      }),
    );

    const localLayer = annotationLayer('day-1', { name: 'Local day', revision: 2 });
    const localFeature = annotationFeature('path-a', 'day-1', { revision: 2 });
    const layerStore = new LayerStore({ layers: [localLayer], features: [localFeature] });
    window.history.replaceState(null, '', '/?room=test-room');

    const { installMapCollaboration } = await import('./collaboration.js');
    const collab = installMapCollaboration(mockMap(), layerStore);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockSockets).toHaveLength(1);
    mockSockets[0].open();
    expect(sentJson(mockSockets[0], 'layer:create')).toHaveLength(0);
    expect(sentJson(mockSockets[0], 'annotation-feature:upsert')).toHaveLength(0);

    mockSockets[0].message({
      type: 'layer:list',
      layers: [annotationLayer('day-1', { name: 'Server day', revision: 1 })],
    });
    mockSockets[0].message({
      type: 'annotation-feature:list',
      features: [annotationFeature('path-a', 'day-1', { revision: 1 })],
    });

    expect(layerStore.getLayer('day-1')?.name).toBe('Server day');
    expect(sentJson(mockSockets[0], 'layer:create').at(-1)?.layer).toMatchObject({
      id: 'day-1',
      name: 'Local day',
      revision: 2,
    });
    expect(sentJson(mockSockets[0], 'annotation-feature:upsert').at(-1)?.feature).toMatchObject({
      id: 'path-a',
      revision: 2,
    });

    collab.destroy();
    vi.useRealTimers();
  });
});
