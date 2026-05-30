import { buildSocketUrl } from './config.js';
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

function compareRows(
  a: { id: string; sortKey?: string; createdAt?: number },
  b: { id: string; sortKey?: string; createdAt?: number },
) {
  return (
    String(a.sortKey || '').localeCompare(String(b.sortKey || '')) ||
    Number(a.createdAt || 0) - Number(b.createdAt || 0) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
}

function sortLayers(layers: Layer[]) {
  return layers.slice().sort(compareRows);
}

function sortAnnotationFeatures(features: AnnotationFeature[]) {
  return features.slice().sort(compareRows);
}

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
    this.layers = [];
    this.annotationFeatures = [];
    this.peers = [];
    this.agents = [];
    this.roomStatus = null;
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
      this.waitFor((event: RoomEvent) => event.json?.type === 'layer:list', 'layer:list'),
      this.waitFor((event: RoomEvent) => event.json?.type === 'annotation-feature:list', 'annotation-feature:list'),
    ]);
  }

  handleMessage(data: unknown): void {
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

    this.applyJsonMessage(json);
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
    } else if (json.type === 'layer:list') {
      this.layers = sortLayers(Array.isArray(json.layers) ? json.layers : []);
    } else if ((json.type === 'layer:created' || json.type === 'layer:updated') && json.layer?.id) {
      this.upsertLayer(json.layer);
    } else if (json.type === 'layer:deleted' && json.layerId) {
      this.layers = this.layers.filter((layer: Layer) => layer.id !== json.layerId);
      this.annotationFeatures = this.annotationFeatures.filter(
        (feature: AnnotationFeature) => feature.layerId !== json.layerId,
      );
    } else if (json.type === 'layer:reordered') {
      this.layers = sortLayers(Array.isArray(json.layers) ? json.layers : this.layers);
    } else if (json.type === 'annotation-feature:list') {
      const features = Array.isArray(json.features) ? json.features : [];
      if (typeof json.layerId === 'string') {
        this.annotationFeatures = sortAnnotationFeatures([
          ...this.annotationFeatures.filter((feature: AnnotationFeature) => feature.layerId !== json.layerId),
          ...features,
        ]);
      } else {
        this.annotationFeatures = sortAnnotationFeatures(features);
      }
    } else if (json.type === 'annotation-feature:upserted' && json.feature?.id) {
      this.upsertAnnotationFeature(json.feature);
    } else if (json.type === 'annotation-feature:deleted' && json.featureId) {
      this.annotationFeatures = this.annotationFeatures.filter(
        (feature: AnnotationFeature) => feature.id !== json.featureId,
      );
    } else if (json.type === 'annotation-feature:reordered') {
      this.annotationFeatures = sortAnnotationFeatures(
        Array.isArray(json.features) ? json.features : this.annotationFeatures,
      );
    }
  }

  upsertLayer(layer: Layer): void {
    const index = this.layers.findIndex((item: Layer) => item.id === layer.id);
    if (index === -1) this.layers.push(layer);
    else this.layers[index] = layer;
    this.layers = sortLayers(this.layers);
  }

  upsertAnnotationFeature(feature: AnnotationFeature): void {
    const index = this.annotationFeatures.findIndex((item: AnnotationFeature) => item.id === feature.id);
    if (index === -1) this.annotationFeatures.push(feature);
    else this.annotationFeatures[index] = feature;
    this.annotationFeatures = sortAnnotationFeatures(this.annotationFeatures);
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
