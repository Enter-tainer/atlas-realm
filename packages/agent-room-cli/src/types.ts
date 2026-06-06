export type JsonRecord = Record<string, any>;
export type LngLatTuple = [number, number];
export type FileLayerType = 'geojson' | 'gpx';
export type ContentEncoding = 'gzip' | 'identity';
export type RoomPersistence = 'ephemeral' | 'persistent';

export interface AgentRoomConfig {
  host: string;
  room: string;
  party: string;
  clientId: string;
  agentName: string;
  agentColor: string;
  accessToken: string;
  clientType: 'agent' | 'query';
  timeoutMs: number;
}

export interface FileLayerSummary extends JsonRecord {
  bounds?: [LngLatTuple, LngLatTuple] | null;
  lines?: number;
  points?: number;
  polygons?: number;
  features?: number;
}

export interface FileLayerManifest extends JsonRecord {
  id: string;
  type: FileLayerType;
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
  createdAt: number;
  updatedAt: number;
}

export interface FileLayerAsset {
  manifest: FileLayerManifest;
  content: Uint8Array;
}

export interface AnnotationFeaturePayload extends JsonRecord {
  id: string;
  type: string;
  layerId: string;
}

export interface AnnotationLayerPayload extends JsonRecord {
  version: 1;
}

export interface FileLayerPayload extends JsonRecord {
  version: 1;
  fileType: FileLayerType;
  contentHash: string;
  contentType: string;
  contentEncoding: ContentEncoding;
  contentByteLength: number;
  rawByteLength: number;
  bounds: [LngLatTuple, LngLatTuple] | null;
  style: {
    color: string;
    opacity: number;
    lineWidth: number;
  };
}

export interface Layer extends JsonRecord {
  id: string;
  kind: 'annotation' | 'file';
  name: string;
  visible: boolean;
  sortKey: string;
  payload: AnnotationLayerPayload | FileLayerPayload;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
}

export interface AnnotationFeature extends JsonRecord {
  id: string;
  layerId: string;
  featureType: AnnotationFeaturePayload['type'];
  payload: AnnotationFeaturePayload;
  sortKey: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
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

export interface RoomStatus extends JsonRecord {
  room: string;
  persistence: RoomPersistence;
  lastActiveAt?: number;
  expiresAt?: number | null;
}

export interface FileContentFrame {
  contentHash: string;
  content: Uint8Array;
}

export interface RoomEvent {
  json?: JsonRecord;
  binary?: FileContentFrame;
}

export interface RoomWaiter {
  tryResolve(event: RoomEvent): boolean;
}

export interface RoomClientLike {
  config: AgentRoomConfig;
  layers: Layer[];
  annotationFeatures: AnnotationFeature[];
  peers: JsonRecord[];
  agents: AgentParticipant[];
  roomStatus?: RoomStatus | null;
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
  layerId?: string;
  content?: boolean;
  out?: string;
  persistence?: RoomPersistence;
  hideLayer?: boolean;
  lineStyle?: string;
  opacity?: number;
  fillOpacity?: number;
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
