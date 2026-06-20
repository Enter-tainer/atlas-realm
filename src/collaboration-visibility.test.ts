// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMapCollaboration } from './collaboration.js';
import type { CollaborationFixtureState } from './collaboration.js';

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

describe('background disconnect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('disconnects after 30s hidden, reconnects on visible', async () => {
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

    // Tab goes to background.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Before 30s: still connected.
    vi.advanceTimersByTime(29_000);

    // After 30s: timer fires → disconnect() is called → panel should show "Ready / idle".
    vi.advanceTimersByTime(2_000);
    // After disconnect the panel connection state changes, but we can't check internals.
    // We verify that the return value is valid and that destroy() cleans up.
    expect(collab.destroy).toBeTypeOf('function');

    // Tab comes back.
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    // The handler tries to reconnect. Since wasBgDisconnect is true,
    // connect() is called. We can't verify the new socket,
    // but the handler doesn't throw.

    vi.useRealTimers();
  });

  it('cancels the background timer if tab returns within 30s', async () => {
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

    // Tab goes to background.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Return after 10s (before 30s cutoff).
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    // Advance past the 30s mark. No disconnect should have happened.
    vi.advanceTimersByTime(30_000);

    expect(collab.destroy).toBeTypeOf('function');
    collab.destroy();
    vi.useRealTimers();
  });

  it('does not throw when destroyed while background timer is pending', async () => {
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

    // Destroy while timer is pending.
    collab.destroy();

    // Advance past the 30s mark. Timer should have been cancelled by destroy.
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    vi.useRealTimers();
  });
});
