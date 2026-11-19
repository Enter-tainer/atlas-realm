import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomClient } from '../src/room-client.js';
import { createConfig } from '../src/config.js';
import { isTransientConnectError, retryDelayMs } from '../src/retry.js';

const clients: RoomClient[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  for (const client of clients.splice(0)) client.sync.dispose();
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

const layer = {
  id: 'annotation-default',
  kind: 'annotation',
  name: 'Annotations',
  visible: true,
  sortKey: '000010',
  revision: 0,
  fieldVersions: {},
  payload: { version: 1 },
};

/**
 * A WebSocket stand-in that can be told to drop, so connection lifecycle
 * behavior is exercised instead of only the happy path.
 */
class FlakySocket {
  static OPEN = 1;
  static instances: FlakySocket[] = [];
  static failOpens = 0;
  /** When false, submissions are recorded but never acknowledged. */
  static autoAck = true;
  binaryType = 'arraybuffer';
  readyState = 0;
  listeners = new Map<string, Array<(event: unknown) => void>>();
  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    FlakySocket.instances.push(this);
    const shouldFail = FlakySocket.failOpens > 0;
    if (shouldFail) FlakySocket.failOpens--;
    setTimeout(() => {
      if (shouldFail) {
        this.dispatch('error', {});
        this.dispatch('close', {});
        return;
      }
      this.readyState = FlakySocket.OPEN;
      this.dispatch('open', {});
      // Handshake frames land in a later task: the client attaches its message
      // listener only after `open` resolves.
      setTimeout(() => {
        if (this.readyState !== FlakySocket.OPEN) return;
        this.receive({
          type: 'presence:init',
          peers: [],
          agents: [],
          roomStatus: { type: 'room:status', room: 'test', persistence: 'ephemeral' },
        });
        this.receive({
          type: 'sync:snapshot',
          protocol: 2,
          epoch: 'test',
          commitVersion: 1,
          clientId: 'stream-1',
          lastProcessedSeq: 0,
          lastResult: null,
          layers: [layer],
          features: [],
        });
      }, 0);
    }, 0);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((item) => item !== listener),
    );
  }

  send(data: unknown) {
    this.sent.push(String(data));
    const message = JSON.parse(String(data));
    if (message.type !== 'sync:submit' || !FlakySocket.autoAck) return;
    // Acknowledge after a tick so callers are genuinely waiting.
    setTimeout(() => {
      this.receive({
        type: 'sync:result',
        epoch: 'test',
        clientId: 'stream-1',
        result: { seq: message.seq, status: 'accepted', commitVersion: 2, ids: {}, versions: {} },
        delta: {
          layers: [layer],
          features: [],
          deletedLayers: [],
          deletedFeatures: [],
        },
      });
    }, 0);
  }

  submitted(): boolean {
    return this.sent.some((entry) => entry.includes('"type":"sync:submit"'));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  receive(json: Record<string, unknown>) {
    this.dispatch('message', { data: JSON.stringify(json) });
  }

  dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  /** Simulate the network dropping the socket without a close frame first. */
  drop() {
    this.readyState = 3;
    this.dispatch('close', {});
  }
}

function makeClient() {
  FlakySocket.instances = [];
  FlakySocket.failOpens = 0;
  FlakySocket.autoAck = true;
  globalThis.fetch = async () => Response.json({});
  const client = new RoomClient(createConfig({ host: 'http://localhost:4178', room: 'test', clientId: 'agent' }), {
    WebSocketImpl: FlakySocket as never,
  });
  clients.push(client);
  return client;
}

describe('connection lifecycle', () => {
  it('retries the handshake after a transient open failure', async () => {
    const client = makeClient();
    FlakySocket.failOpens = 1;
    const notices: number[] = [];
    await client.connectWithRetry({ onRetry: (notice) => notices.push(notice.attempt) });
    expect(notices).toEqual([1]);
    expect(FlakySocket.instances).toHaveLength(2);
    expect(client.sync.ready).toBe(true);
  });

  it('does not retry a non-transient handshake failure', async () => {
    const client = makeClient();
    FlakySocket.failOpens = 3;
    const notices: number[] = [];
    await expect(client.connectWithRetry({ attempts: 3, onRetry: (n) => notices.push(n.attempt) })).rejects.toThrow(
      /WebSocket/,
    );
    expect(notices).toEqual([1, 2]);
  });

  it('reconnects after a mid-command drop and still acknowledges the submission', async () => {
    const client = makeClient();
    await client.connectWithRetry();
    // Hold the acknowledgement so the drop happens with the submit in flight.
    FlakySocket.autoAck = false;
    const ack = client.waitFor((event) => event.json?.type === 'layer:updated', 'layer update');
    client.sendJson({ type: 'layer:update', layerId: 'annotation-default', patch: { name: 'Renamed' } });
    await vi.waitFor(() => expect(FlakySocket.instances[0].submitted()).toBe(true));

    // The socket dies before the ack: the client must not hang on its timeout.
    FlakySocket.instances[0].drop();
    // The replacement socket acknowledges the re-sent submission.
    FlakySocket.autoAck = true;
    await vi.waitFor(() => expect(FlakySocket.instances).toHaveLength(2), { timeout: 5_000 });
    await expect(ack).resolves.toBeTruthy();
  });

  it('fails pending waits with a connection error when reconnection never succeeds', async () => {
    const client = makeClient();
    await client.connectWithRetry();
    const wait = client.waitFor((event) => event.json?.type === 'layer:updated', 'layer update', 15_000);
    // Every replacement socket refuses to open.
    FlakySocket.failOpens = 100;
    FlakySocket.instances[0].drop();
    await expect(wait).rejects.toThrow(/Room connection lost/);
  });

  it('treats a not-open socket send as a recoverable connection failure', async () => {
    const client = makeClient();
    await client.connectWithRetry();
    const ack = client.waitFor((event) => event.json?.type === 'layer:updated', 'layer update');
    // Simulate a half-open socket: readyState is no longer OPEN but no close event fired.
    FlakySocket.instances[0].readyState = 3;
    client.sendJson({ type: 'layer:update', layerId: 'annotation-default', patch: { name: 'Renamed' } });
    await vi.waitFor(() => expect(FlakySocket.instances.length).toBeGreaterThan(1), { timeout: 5_000 });
    await expect(ack).resolves.toBeTruthy();
  });
});

describe('transient error classification', () => {
  it('retries transport and handshake failures', () => {
    const fetchFailed = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(isTransientConnectError(fetchFailed)).toBe(true);
    expect(isTransientConnectError(new Error('WebSocket closed before opening: ws://x'))).toBe(true);
    expect(isTransientConnectError(new Error('Timed out waiting for sync:snapshot.'))).toBe(true);
    expect(isTransientConnectError(new Error('Failed to prepare room registry: HTTP 503'))).toBe(true);
    expect(isTransientConnectError(new Error('Failed to prepare room registry: HTTP 429'))).toBe(true);
  });

  it('never retries a definitive answer', () => {
    expect(isTransientConnectError(new Error('Failed to prepare room registry: HTTP 403'))).toBe(false);
    expect(isTransientConnectError(new Error('Room sync error: client_limit'))).toBe(false);
    expect(isTransientConnectError(new Error('Annotation not found: "x"'))).toBe(false);
    expect(isTransientConnectError(new Error('Confirmation required'))).toBe(false);
  });

  it('backs off with a cap', () => {
    expect(retryDelayMs(1)).toBe(250);
    expect(retryDelayMs(2)).toBe(500);
    expect(retryDelayMs(10)).toBe(2_000);
  });
});
