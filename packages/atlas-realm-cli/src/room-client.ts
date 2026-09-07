import { RoomSyncClient, type Draft, type SyncJournal } from './sync-client.js';
import type { BatchResult, ServerMessage } from './sync-protocol.js';
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
      send: (message) => {
        if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
        this.socket.send(message instanceof Uint8Array ? message : JSON.stringify(message));
        return true;
      },
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

    await this.ensureRoomRegistry();

    const url = buildSocketUrl(this.config);
    this.socket = new this.WebSocketImpl(url);
    this.socket.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), this.config.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.socket?.removeEventListener('open', onOpen);
        this.socket?.removeEventListener('close', onClose);
        this.socket?.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error(`WebSocket closed before opening: ${url}`));
      };
      const onError = () => {
        cleanup();
        reject(new Error(`WebSocket connection failed: ${url}`));
      };
      this.socket?.addEventListener('open', onOpen);
      this.socket?.addEventListener('close', onClose);
      this.socket?.addEventListener('error', onError);
      this.socket?.addEventListener('message', (event: MessageEvent) => this.handleMessage(event.data));
    });

    this.sync.connect(true);
    await Promise.all([
      this.waitFor((event: RoomEvent) => event.json?.type === 'presence:init', 'presence:init'),
      this.waitFor((event: RoomEvent) => event.json?.type === 'sync:snapshot', 'sync:snapshot'),
    ]);
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
            `Timed out waiting for ${label}. Submission outcome may be unknown; inspect shared state before repeating a create.`,
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
    this.socket.send(bytes);
  }

  async close(): Promise<void> {
    this.sync.dispose();
    for (const waiter of this.waiters) this.waiters.delete(waiter);
    if (this.socket && this.socket.readyState <= this.WebSocketImpl.OPEN) this.socket.close(1000, 'done');
    await this.sync.drain();
  }
}
