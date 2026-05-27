export type JsonRecord = Record<string, any>;
export type LngLatTuple = [number, number];
export type OverlayType = 'geojson' | 'gpx';
export type OverlayPersistence = 'ephemeral' | 'persistent';

export interface AgentRoomConfig {
  host: string;
  room: string;
  party: string;
  clientId: string;
  agentName: string;
  agentColor: string;
  clientType: 'agent' | 'query';
  timeoutMs: number;
}

export interface OverlaySummary extends JsonRecord {
  bounds?: [LngLatTuple, LngLatTuple] | null;
  lines?: number;
  points?: number;
  polygons?: number;
  features?: number;
}

export interface OverlayManifest extends JsonRecord {
  id: string;
  type: OverlayType;
  name: string;
  visible: boolean;
  color: string;
  opacity: number;
  lineWidth: number;
  bounds: [LngLatTuple, LngLatTuple] | null;
  contentHash: string;
  contentType: string;
  contentEncoding: string;
  contentByteLength: number;
  rawByteLength: number;
  syncVersion: number;
  persistence: OverlayPersistence;
  createdAt: number;
  updatedAt: number;
}

export interface OverlayAsset {
  manifest: OverlayManifest;
  content: Uint8Array;
}

export interface DrawingFeature extends JsonRecord {
  id: string;
  type: string;
  layerId: string;
}

export interface DrawingLayer extends JsonRecord {
  id: string;
  name: string;
  visible?: boolean;
}

export interface DrawingDoc extends JsonRecord {
  layers?: Record<string, DrawingLayer>;
  layerOrder?: string[];
  features?: Record<string, DrawingFeature>;
  featureOrder?: string[];
}

export interface AgentParticipant extends JsonRecord {
  id: string;
  user: {
    id: string;
    name: string;
    color: string;
  };
  clientType: 'agent';
  active: boolean;
  lastSeenAt: number;
  expiresAt: number;
  lastAction: string;
}

export interface OverlayBinaryFrame {
  contentHash: string;
  content: Uint8Array;
}

export interface RoomEvent {
  json?: JsonRecord;
  binary?: OverlayBinaryFrame;
}

export interface RoomWaiter {
  tryResolve(event: RoomEvent): boolean;
}

export interface RoomClientLike {
  config: AgentRoomConfig;
  overlays: OverlayManifest[];
  drawingDoc: DrawingDoc | null;
  peers: JsonRecord[];
  agents: AgentParticipant[];
  sendJson(message: JsonRecord): void;
  sendBinary(bytes: Uint8Array): void;
  waitFor(predicate: (event: RoomEvent) => boolean, label: string, timeoutMs?: number): Promise<RoomEvent>;
}

export type HumanFormatter = (data: JsonRecord) => string;

export interface CommandResponse {
  result: JsonRecord;
  human?: HumanFormatter;
}

export interface Command extends JsonRecord {
  subject?: string;
  action?: string;
  id?: string;
  ids?: string[];
  file?: string;
  type?: string;
  featureType?: string;
  layerAction?: string;
}

export interface WebSocketLike {
  binaryType?: BinaryType;
  readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketConstructorLike {
  readonly OPEN: number;
  new (url: string): WebSocketLike;
}
