import { RoomSyncClient, type Draft, type SyncJournal } from './sync-client.js';
import type { BatchResult, ServerMessage } from './sync-protocol.js';
import { isRecoverableSyncError } from './sync-protocol.js';
import { isTransientConnectError, retryDelayMs, sleep, type RetryNotice } from './retry.js';
import { buildApiUrl, buildSocketUrl } from './config.js';
import { decodeFileContentMessage } from './protocol.js';
import type {
  AgentRoomConfig,
  AgentParticipant,
  AnnotationFeature,
  JsonRecord,
  Layer,
  RoomStatus,
  RoomEvent,
  RoomWaiter,
  WebSocketConstructorLike,
  WebSocketLike,
} from './types.js';

export class RoomClient {
  config: AgentRoomConfig;
  WebSocketImpl: WebSocketConstructorLike;
  events: RoomEvent[];
  waiters: Set<RoomWaiter>;
  layers: Layer[];
  annotationFeatures: AnnotationFeature[];
  peers: JsonRecord[];
  agents: AgentParticipant[];
  roomStatus: RoomStatus | null;
  socket: WebSocketLike | null;
  sync: RoomSyncClient;
  private currentRequest: string | null = null;
  private pendingRequest = Promise.resolve();
  private requests = new Map<string, { ids: Set<string>; mutation: JsonRecord }>();
  private uploadContent = new Map<string, Uint8Array>();
  private closing = false;
  private recovering: Promise<void> | null = null;
  /** Socket still completing its handshake; drops are handled by the handshake promise. */
  private handshakeSocket: WebSocketLike | null = null;

  constructor(
    config: AgentRoomConfig,
    {
      WebSocketImpl = globalThis.WebSocket as WebSocketConstructorLike | undefined,
      journal,
    }: {
      WebSocketImpl?: WebSocketConstructorLike;
      journal?: { load(): Promise<SyncJournal | undefined>; save(state: SyncJournal): Promise<void> };
    } = {},
  ) {
    this.config = config;
    this.WebSocketImpl = WebSocketImpl;
    this.events = [];
    this.waiters = new Set();
    this.layers = [];
    this.annotationFeatures = [];
    this.peers = [];
    this.agents = [];
    this.roomStatus = null;
    this.socket = null;
    this.sync = new RoomSyncClient({
      batchDelay: 0,
      load: journal ? () => journal.load() : undefined,
      save: journal ? (state) => journal.save(state) : undefined,
      send: (message) => this.sendOnSocket(message instanceof Uint8Array ? message : JSON.stringify(message)),
      publish: (layers, features) => {
        this.layers = layers as Layer[];
        this.annotationFeatures = features as AnnotationFeature[];
      },
      settled: (result, drafts) => this.settled(result, drafts),
    });
  }

  async ensureRoomRegistry(): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.accessToken) headers.Authorization = `Bearer ${this.config.accessToken}`;
    const response = await fetch(buildApiUrl(this.config, '/api/rooms'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ roomId: this.config.room }),
    });
    if (!response.ok && response.status !== 501) {
      throw new Error(`Failed to prepare room registry: HTTP ${response.status}`);
    }
  }

  async connect(): Promise<void> {
    await this.sync.loaded;
    if (this.sync.storageError) throw new Error(this.sync.storageError);
    if (typeof this.WebSocketImpl === 'undefined') {
      throw new Error('This CLI requires a Node.js runtime with a global WebSocket implementation');
    }

    await this.openSocket();

    this.sync.connect(true);
    await Promise.all([
      this.waitFor((event: RoomEvent) => event.json?.type === 'presence:init', 'presence:init'),
      this.waitFor((event: RoomEvent) => event.json?.type === 'sync:snapshot', 'sync:snapshot'),
    ]);
  }

  /**
   * Handshake with a bounded retry. Only safe because nothing is submitted
   * before the snapshot arrives: a failed handshake leaves the room untouched.
   */
  async connectWithRetry({
    attempts = 3,
    onRetry,
  }: { attempts?: number; onRetry?: (notice: RetryNotice) => void } = {}): Promise<void> {
    const total = Math.max(1, attempts);
    for (let attempt = 1; ; attempt++) {
      try {
        await this.connect();
        return;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (attempt >= total || !isTransientConnectError(normalized)) throw normalized;
        this.dropSocket('retry');
        const delayMs = retryDelayMs(attempt);
        onRetry?.({ attempt, attempts: total, delayMs, error: normalized });
        await sleep(delayMs);
      }
    }
  }

  private async openSocket(): Promise<void> {
    await this.ensureRoomRegistry();
    const url = buildSocketUrl(this.config);
    const socket = new this.WebSocketImpl(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    // Listen before waiting for `open`: the server may push frames in the same
    // tick it accepts the upgrade, and anything attached after the await would
    // miss them. Drops are only routed to recovery once the handshake is done.
    this.handshakeSocket = socket;
    socket.addEventListener('message', (event: MessageEvent) => void this.handleMessage(event.data));
    socket.addEventListener('close', () => {
      if (this.handshakeSocket !== socket) this.handleSocketDown('closed');
    });
    socket.addEventListener('error', () => {
      if (this.handshakeSocket !== socket) this.handleSocketDown('error');
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        detach();
        reject(new Error(`Timed out connecting to ${url}`));
      }, this.config.timeoutMs);
      const detach = () => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        detach();
        resolve();
      };
      const onClose = () => {
        detach();
        reject(new Error(`WebSocket closed before opening: ${url}`));
      };
      const onError = () => {
        detach();
        reject(new Error(`WebSocket connection failed: ${url}`));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onError);
    });
    this.handshakeSocket = null;
  }

  private handleSocketDown(reason: 'closed' | 'error'): void {
    if (this.closing || this.recovering) return;
    if (!this.socket) return;
    this.dropSocket(reason);
    void this.recoverConnection(reason);
  }

  private dropSocket(reason: string): void {
    this.sync.disconnect();
    const socket = this.socket;
    this.socket = null;
    // Events from the dead session must not satisfy waits registered against
    // the replacement session.
    this.events = [];
    try {
      socket?.close(1000, reason);
    } catch {
      // Already closed.
    }
  }

  /**
   * Re-open the socket and the sync session after an unexpected drop. Re-opening
   * with the existing clientId makes the server replay our last result, so an
   * in-flight submission is either settled (it landed) or re-sent (it did not).
   */
  private async recoverConnection(reason: string): Promise<void> {
    if (this.recovering || this.closing) return;
    this.recovering = (async () => {
      const attempts = 4;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (this.closing) return;
        try {
          await this.connect();
          return;
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          if (attempt === attempts || !isTransientConnectError(normalized)) break;
          await sleep(retryDelayMs(attempt));
        }
      }
      this.failPendingWaits(reason);
    })().finally(() => {
      this.recovering = null;
    });
    await this.recovering;
  }

  private failPendingWaits(reason: string): void {
    this.addEvent({ json: { type: 'connection:lost', reason } });
  }

  private sendOnSocket(message: string | Uint8Array): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== this.WebSocketImpl.OPEN) {
      if (!this.closing && !this.recovering) {
        this.dropSocket('send-failed');
        void this.recoverConnection('send-failed');
      }
      return false;
    }
    socket.send(message);
    return true;
  }

  async handleMessage(data: unknown): Promise<void> {
    const binaryFrame = decodeFileContentMessage(data);
    if (binaryFrame) {
      this.addEvent({ binary: binaryFrame });
      return;
    }

    if (typeof data !== 'string') return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }

    if (['sync:snapshot', 'sync:commit', 'sync:result', 'sync:error'].includes(json.type))
      await this.sync.receive(json as ServerMessage);
    else {
      if (json.type === 'file:content:stored') this.sync.contentStored(json.contentHash);
      this.applyJsonMessage(json);
    }
    this.addEvent({ json });
  }

  applyJsonMessage(json: JsonRecord): void {
    if (json.type === 'presence:init') {
      this.peers = Array.isArray(json.peers) ? json.peers : [];
      this.agents = Array.isArray(json.agents) ? json.agents : [];
      if (json.roomStatus) this.roomStatus = json.roomStatus;
    } else if (json.type === 'room:status' || json.type === 'room:updated') {
      this.roomStatus = json as RoomStatus;
    } else if (json.type === 'presence:join' || json.type === 'presence:update') {
      if (json.peer?.id) {
        const index = this.peers.findIndex((peer: JsonRecord) => peer.id === json.peer.id);
        if (index === -1) this.peers.push(json.peer);
        else this.peers[index] = json.peer;
      }
    } else if (json.type === 'presence:leave') {
      this.peers = this.peers.filter((peer: JsonRecord) => peer.id !== json.id);
    } else if (json.type === 'agent:participant:update' && json.agent?.id) {
      const index = this.agents.findIndex((agent: AgentParticipant) => agent.id === json.agent.id);
      if (index === -1) this.agents.unshift(json.agent);
      else this.agents[index] = json.agent;
    }
  }

  addEvent(event: RoomEvent): void {
    this.events.push(event);
    for (const waiter of [...this.waiters]) {
      if (waiter.tryResolve(event)) this.waiters.delete(waiter);
    }
  }

  private settled(result: BatchResult, drafts: Draft[]) {
    for (const [requestId, request] of this.requests) {
      if (!drafts.some((draft) => request.ids.has(draft.id))) continue;
      for (const draft of drafts) request.ids.delete(draft.id);
      if (result.status === 'rejected') {
        this.addEvent({ json: { type: 'command:rejected', requestId, reason: result.reason, seq: result.seq } });
        this.requests.delete(requestId);
      } else if (request.ids.size === 0) {
        this.publishCommandResult(requestId, request.mutation);
        this.requests.delete(requestId);
      }
    }
  }

  private publishCommandResult(requestId: string, message: JsonRecord) {
    const id = message.layer?.id || message.feature?.id || message.layerId || message.featureId;
    const actualId = this.sync.aliases[id] || id;
    let result: JsonRecord;
    if (message.type === 'layer:create')
      result = { type: 'layer:created', layer: this.layers.find((row) => row.id === actualId) };
    else if (message.type === 'layer:update' || message.type === 'layer:replace')
      result = { type: 'layer:updated', layer: this.layers.find((row) => row.id === actualId) };
    else if (message.type === 'layer:delete') result = { type: 'layer:deleted', layerId: actualId };
    else if (message.type === 'layer:reorder') result = { type: 'layer:reordered', layers: this.layers };
    else if (message.type === 'annotation-feature:delete')
      result = { type: 'annotation-feature:deleted', featureId: actualId };
    else if (message.type === 'annotation-feature:reorder')
      result = { type: 'annotation-feature:reordered', features: this.annotationFeatures };
    else
      result = {
        type: 'annotation-feature:upserted',
        feature: this.annotationFeatures.find((row) => row.id === actualId),
      };
    this.addEvent({ json: { ...result, requestId } });
  }

  async waitFor(
    predicate: (event: RoomEvent) => boolean,
    label: string,
    timeoutMs = this.config.timeoutMs,
  ): Promise<RoomEvent> {
    const requestId = this.currentRequest;
    await this.pendingRequest;
    const failure = (event: RoomEvent) =>
      event.json?.type === 'command:rejected' && event.json.requestId === requestId
        ? new Error(`Sync rejected: ${event.json.reason}. Read the current state before retrying.`)
        : event.json?.type === 'protocol:error'
          ? new Error('Sync protocol mismatch. Upgrade the CLI.')
          : event.json?.type === 'connection:lost'
            ? new Error(
                `Room connection lost (${event.json.reason}) and could not be re-established. ` +
                  `The command may or may not have been applied; read the room state before retrying.`,
              )
            : event.json?.type === 'sync:error' && !isRecoverableSyncError(event.json.reason)
              ? new Error(fatalSyncErrorMessage(event.json))
              : null;
    const matches = (event: RoomEvent) => (!requestId || event.json?.requestId === requestId) && predicate(event);
    for (const event of this.events) {
      const error = failure(event);
      if (error) throw error;
      if (matches(event)) return event;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(
          new Error(
            `Timed out waiting for ${label}. Submission outcome may be unknown; inspect shared state before repeating a create.` +
              summarizeRoomEvents(this.events) +
              (this.sync.storageError ? ` Sync state: ${this.sync.storageError}` : ''),
          ),
        );
      }, timeoutMs);
      const waiter: RoomWaiter = {
        tryResolve: (event) => {
          const error = failure(event);
          if (!error && !matches(event)) return false;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(event);
          return true;
        },
      };
      this.waiters.add(waiter);
    });
  }

  sendJson(message: JsonRecord): void {
    if (!this.socket) throw new Error('WebSocket is not connected');
    if (/^(layer|annotation-feature):/.test(message.type) && !message.type.endsWith(':request')) {
      const requestId = crypto.randomUUID();
      this.currentRequest = requestId;
      const hash = message.layer?.payload?.contentHash;
      const bytes = this.uploadContent.get(hash);
      this.pendingRequest = this.sync.enqueue(message, bytes ? { hash, bytes } : undefined).then((ids) => {
        if (ids.length) this.requests.set(requestId, { ids: new Set(ids), mutation: structuredClone(message) });
        else this.publishCommandResult(requestId, message);
      });
    } else {
      this.currentRequest = null;
      this.socket.send(JSON.stringify(message));
    }
  }

  sendBinary(bytes: Uint8Array): void {
    if (!this.socket) throw new Error('WebSocket is not connected');
    this.currentRequest = null;
    const frame = decodeFileContentMessage(bytes);
    if (frame) this.uploadContent.set(frame.contentHash, frame.content);
    this.sendOnSocket(bytes);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.sync.dispose();
    for (const waiter of this.waiters) this.waiters.delete(waiter);
    if (this.socket && this.socket.readyState <= this.WebSocketImpl.OPEN) this.socket.close(1000, 'done');
    await this.sync.drain();
  }

  /**
   * Resolve a submission whose acknowledgement never arrived. Re-opening the
   * sync session makes the server replay its last result for this client, so
   * the caller gets a definitive answer instead of "outcome may be unknown".
   */
  async resolvePendingOutcome({ timeoutMs = this.config.timeoutMs }: { timeoutMs?: number } = {}): Promise<
    | { status: 'accepted' | 'rejected'; result: BatchResult }
    | { status: 'unknown'; reason: string; result?: BatchResult }
  > {
    const outstanding = () => Boolean(this.sync.inFlight || this.sync.pending.length);
    if (outstanding() && this.socket && this.socket.readyState === this.WebSocketImpl.OPEN) {
      const seen = this.events.length;
      this.sync.requestSnapshot(true);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && outstanding()) {
        const snapshotArrived = this.events
          .slice(seen)
          .some((event) => event.json?.type === 'sync:snapshot' || event.json?.type === 'connection:lost');
        if (snapshotArrived) break;
        await sleep(25);
      }
    }
    const last = this.sync.lastOutcome;
    if (!outstanding() && last)
      return last.status === 'accepted' ? { status: 'accepted', result: last } : { status: 'rejected', result: last };
    const conflict = this.sync.conflicts.at(-1);
    return {
      status: 'unknown',
      reason: conflict?.reason || (outstanding() ? 'no-response' : 'no-submission'),
      ...(last ? { result: last } : {}),
    };
  }
}

function fatalSyncErrorMessage(json: JsonRecord): string {
  const reason = String(json.reason || 'unknown');
  const limit = json.limit ? ` (${json.limit})` : '';
  return (
    `Room sync error: ${reason}${limit}. The server stopped synchronization for this connection, ` +
    `so waiting longer cannot help. Inspect the room state before retrying.`
  );
}

/**
 * Compact histogram of the messages received so far, appended to wait timeouts
 * so a silent or misbehaving room can be told apart from a lost reply.
 */
export function summarizeRoomEvents(events: RoomEvent[], maxTypes = 8): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    const type = event.json?.type
      ? String(event.json.type) +
        (event.json.type === 'sync:error' && event.json.reason ? `(${event.json.reason})` : '')
      : event.binary
        ? 'file:content (binary)'
        : 'unknown';
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  if (!counts.size) return ' No room messages were received at all.';
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = ranked.slice(0, maxTypes);
  const hidden = ranked.length - shown.length;
  return ` Room messages received so far: ${shown.map(([type, count]) => `${type} x${count}`).join(', ')}${
    hidden > 0 ? `, … ${hidden} more types` : ''
  }.`;
}
