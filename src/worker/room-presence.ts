import { HEX_COLOR_RE, PROFILE_COLORS } from './room-constants.js';
import { clampNumber, isRecord, sanitizeText } from './json-utils.js';
import type {
  ClientType,
  ConnectionLike,
  CursorState,
  LngLatTuple,
  LocationState,
  PeerState,
  UserProfile,
  ViewportState,
  ViewState,
} from './room-types.js';

export function emptyLocation(): LocationState {
  return {
    enabled: false,
    lngLat: null,
    accuracy: null,
    heading: null,
    speed: null,
    updatedAt: null,
  };
}

export function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

export function sanitizeUser(value: unknown, fallback?: UserProfile): UserProfile {
  const base: Partial<UserProfile> = fallback || {};
  if (!isRecord(value))
    return {
      id: base.id || '',
      name: base.name || 'Guest',
      color: base.color || PROFILE_COLORS[0],
      avatarUrl: base.avatarUrl || null,
    };
  const avatarUrl = sanitizeText(value.avatarUrl, base.avatarUrl || '', 512) || null;
  return {
    id: base.id || '',
    name: sanitizeText(value.name, base.name || 'Guest', 32),
    color: sanitizeColor(value.color, base.color || PROFILE_COLORS[0]),
    avatarUrl,
  };
}

export function sanitizeClientType(value: unknown): ClientType {
  return value === 'agent' || value === 'query' ? value : 'human';
}

export function sanitizeAction(value: unknown, fallback = 'connect'): string {
  return sanitizeText(value, fallback, 80);
}

export function sanitizeLngLat(value: unknown): LngLatTuple | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lng = clampNumber(value[0], -180, 180, NaN);
  const lat = clampNumber(value[1], -85, 85, NaN);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

export function sanitizeViewport(value: unknown): ViewportState | null {
  if (!isRecord(value)) return null;
  const center = sanitizeLngLat(value.center);
  const corners = Array.isArray(value.corners) ? value.corners.slice(0, 4).map(sanitizeLngLat) : [];
  if (!center || corners.length !== 4 || corners.some((corner) => !corner)) return null;
  return {
    center,
    zoom: Number(clampNumber(value.zoom, 0, 24, 0).toFixed(3)),
    bearing: Number(clampNumber(value.bearing, -360, 360, 0).toFixed(2)),
    pitch: Number(clampNumber(value.pitch, 0, 85, 0).toFixed(2)),
    corners: corners as LngLatTuple[],
  };
}

export function sanitizeCursor(value: unknown): CursorState {
  if (!isRecord(value)) return { visible: false, lngLat: null };
  if (value.visible === false) return { visible: false, lngLat: null };
  const lngLat = sanitizeLngLat(value.lngLat);
  return lngLat ? { visible: true, lngLat } : { visible: false, lngLat: null };
}

export function sanitizeOptionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  const number = clampNumber(value, min, max, NaN);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

export function sanitizeLocation(value: unknown, fallback = emptyLocation()): LocationState {
  if (value === undefined) return fallback;
  if (!isRecord(value) || value.enabled === false) {
    return { ...emptyLocation(), updatedAt: Date.now() };
  }

  const lngLat = sanitizeLngLat(value.lngLat);
  if (!lngLat) return { ...emptyLocation(), updatedAt: Date.now() };

  return {
    enabled: true,
    lngLat,
    accuracy: sanitizeOptionalNumber(value.accuracy, 0, 50_000),
    heading: sanitizeOptionalNumber(value.heading, 0, 360),
    speed: sanitizeOptionalNumber(value.speed, 0, 200),
    updatedAt: Date.now(),
  };
}

export function sanitizeViewState(
  value: unknown,
  fallback: ViewState = { terrain: false, satellite: false },
): ViewState {
  if (!isRecord(value)) return fallback;
  return {
    terrain: Boolean(value.terrain),
    satellite: Boolean(value.satellite),
  };
}

export function publicPeer(connection: ConnectionLike<PeerState>) {
  const state = connection.state || {};
  if (!state.user || state.presenceVisible === false || state.clientType !== 'human') return null;
  return {
    id: connection.id,
    user: state.user,
    clientType: 'human',
    viewport: state.viewport || null,
    cursor: state.cursor || { visible: false, lngLat: null },
    location: state.location || emptyLocation(),
    followingId: state.followingId || null,
    viewState: state.viewState || { terrain: false, satellite: false },
    updatedAt: state.updatedAt || Date.now(),
  };
}
