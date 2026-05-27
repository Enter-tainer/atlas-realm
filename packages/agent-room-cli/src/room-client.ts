import { buildSocketUrl } from './config.js';
import { decodeOverlayBinaryMessage } from './protocol.js';
import type {
  AgentRoomConfig,
  AgentParticipant,
  DrawingDoc,
  JsonRecord,
  OverlayManifest,
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
  overlays: OverlayManifest[];
  drawingDoc: DrawingDoc | null;
  peers: JsonRecord[];
  agents: AgentParticipant[];
  socket: WebSocketLike | null;

  constructor(
    config: AgentRoomConfig,
    {
      WebSocketImpl = globalThis.WebSocket as WebSocketConstructorLike | undefined,
    }: {
      WebSocketImpl?: WebSocketConstructorLike;
    } = {},
  ) {
    this.config = config;
    this.WebSocketImpl = WebSocketImpl;
    this.events = [];
    this.waiters = new Set();
    this.overlays = [];
    this.drawingDoc = null;
    this.peers = [];
    this.agents = [];
    this.socket = null;
  }

  async connect(): Promise<void> {
    if (typeof this.WebSocketImpl === 'undefined') {
      throw new Error('This CLI requires a Node.js runtime with a global WebSocket implementation');
    }

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

    await Promise.all([
      this.waitFor((event: RoomEvent) => event.json?.type === 'presence:init', 'presence:init'),
      this.waitFor((event: RoomEvent) => event.json?.type === 'overlay:init', 'overlay:init'),
      this.waitFor((event: RoomEvent) => event.json?.type === 'drawing:snapshot', 'drawing:snapshot'),
    ]);
  }

  handleMessage(data: unknown): void {
    const binaryFrame = decodeOverlayBinaryMessage(data);
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

    this.applyJsonMessage(json);
    this.addEvent({ json });
  }

  applyJsonMessage(json: JsonRecord): void {
    if (json.type === 'presence:init') {
      this.peers = Array.isArray(json.peers) ? json.peers : [];
      this.agents = Array.isArray(json.agents) ? json.agents : [];
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
    } else if (json.type === 'overlay:init' || json.type === 'overlay:list') {
      this.overlays = Array.isArray(json.overlays) ? json.overlays : [];
    } else if (json.type === 'overlay:upserted' && json.manifest?.id) {
      const index = this.overlays.findIndex((overlay: OverlayManifest) => overlay.id === json.manifest.id);
      if (index === -1) this.overlays.unshift(json.manifest);
      else this.overlays[index] = json.manifest;
    } else if (json.type === 'overlay:patched' && json.manifest?.id) {
      const index = this.overlays.findIndex((overlay: OverlayManifest) => overlay.id === json.manifest.id);
      if (index !== -1) this.overlays[index] = json.manifest;
    } else if (json.type === 'overlay:deleted' || json.type === 'overlay:delete') {
      this.overlays = this.overlays.filter((overlay: OverlayManifest) => overlay.id !== json.overlayId);
    } else if (json.type === 'drawing:snapshot') {
      this.drawingDoc = json.doc;
    }
  }

  addEvent(event: RoomEvent): void {
    this.events.push(event);
    for (const waiter of [...this.waiters]) {
      if (waiter.tryResolve(event)) this.waiters.delete(waiter);
    }
  }

  waitFor(
    predicate: (event: RoomEvent) => boolean,
    label: string,
    timeoutMs = this.config.timeoutMs,
  ): Promise<RoomEvent> {
    for (const event of this.events) {
      try {
        if (predicate(event)) return Promise.resolve(event);
      } catch {
        // Keep waiting.
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${label}`));
      }, timeoutMs);
      const waiter: RoomWaiter = {
        tryResolve: (event: RoomEvent) => {
          try {
            if (!predicate(event)) return false;
          } catch {
            return false;
          }
          clearTimeout(timer);
          resolve(event);
          return true;
        },
      };
      this.waiters.add(waiter);
    });
  }

  sendJson(message: JsonRecord): void {
    if (!this.socket) throw new Error('WebSocket is not connected');
    this.socket.send(JSON.stringify(message));
  }

  sendBinary(bytes: Uint8Array): void {
    if (!this.socket) throw new Error('WebSocket is not connected');
    this.socket.send(bytes);
  }

  close(): void {
    for (const waiter of this.waiters) this.waiters.delete(waiter);
    if (this.socket && this.socket.readyState <= this.WebSocketImpl.OPEN) this.socket.close(1000, 'done');
  }
}
