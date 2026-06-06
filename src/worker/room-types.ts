import type { RoomRole } from '../room-permissions.js';

export type JsonRecord = Record<string, unknown>;
export type LngLatTuple = readonly [number, number];
export type RoomPersistence = 'ephemeral' | 'persistent';

export interface FileContentFrame {
  contentHash: string;
  content: Uint8Array;
}

export interface UserProfile {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
}

export interface AuthContext {
  userId: string;
  role: RoomRole;
  issuedAt: number;
  clientId: string;
  agentId: string | null;
  authKind: 'anonymous' | 'user' | 'token';
  displayName: string;
  avatarUrl: string | null;
}

export interface AccessRefreshUpdate {
  userId: string;
  role: RoomRole | null;
}

export type AccessRefreshMode = 'users' | 'room';
export type ClientType = 'human' | 'agent' | 'query';

export interface AgentParticipant {
  id: string;
  user: UserProfile;
  clientType: 'agent';
  active: boolean;
  lastSeenAt: number;
  expiresAt: number;
  lastAction: string;
}

export interface CursorState {
  visible: boolean;
  lngLat: LngLatTuple | null;
}

export interface LocationState {
  enabled: boolean;
  lngLat: LngLatTuple | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  updatedAt: number | null;
}

export interface ViewState {
  terrain: boolean;
  satellite: boolean;
}

export interface ViewportState {
  center: LngLatTuple;
  zoom: number;
  bearing: number;
  pitch: number;
  corners: readonly LngLatTuple[];
}

export interface PeerState {
  user?: UserProfile;
  auth?: AuthContext;
  clientType?: ClientType;
  presenceVisible?: boolean;
  viewport?: ViewportState | null;
  cursor?: CursorState;
  location?: LocationState;
  followingId?: string | null;
  viewState?: ViewState;
  updatedAt?: number;
}

export interface ConnectionLike<State> {
  id: string;
  state?: State | null;
}
