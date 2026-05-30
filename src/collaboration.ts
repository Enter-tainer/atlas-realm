import PartySocket from 'partysocket';
import {
  buildFileLayerSyncAsset,
  decodeFileContentMessage,
  encodeFileContentMessage,
  materializeFileLayerContent,
} from './file-layer-sync.js';
import type { FileLayerContent, FileLayerManifest, FileLayerSyncAsset } from './file-layer-sync.js';
import type { LayerStore } from './layer-store.js';
import type { AnnotationFeatureServerMessage, LayerServerMessage } from './layer-sync.js';
import { ANNOTATION_DEFAULT_LAYER_ID } from './annotation-model.js';
import { initialSortKey, type Layer } from './layer-model.js';
import { emitUiPanelOpen, isOtherUiPanelOpen, UI_PANEL_OPEN_EVENT } from './ui-panels.js';

const PARTY_NAME = 'map-collaboration';
const DEFAULT_ROOM = 'main';
const PROFILE_KEY = 'orm-collaboration-profile';
const SESSION_KEY = 'orm-collaboration-session';
const SEND_INTERVAL_MS = 90;
const FOLLOW_INTERVAL_MS = 140;
const STALE_PEER_MS = 45_000;
const EARTH_RADIUS_METERS = 6_378_137;
const LOCATION_ACCURACY_SEGMENTS = 48;
const SVG_NS = 'http://www.w3.org/2000/svg';
type JsonRecord = Record<string, unknown>;
type LngLatTuple = [number, number];
type PointLike = { x: number; y: number };
type EaseToOptions = {
  center: LngLatTuple;
  zoom: number;
  bearing: number;
  pitch: number;
  duration: number;
  essential: boolean;
};
type UserProfile = { userId: string; name: string; color: string };
type PeerUser = { id?: string; name: string; color: string };
type AgentParticipant = {
  id: string;
  user: PeerUser;
  clientType: 'agent';
  active: boolean;
  lastSeenAt: number;
  expiresAt: number;
  lastAction: string;
};
type CursorState = { visible: boolean; lngLat: LngLatTuple | null };
type LocationState = {
  enabled: boolean;
  lngLat: LngLatTuple | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  updatedAt: number | null;
};
type ViewportSnapshot = {
  center: LngLatTuple;
  zoom: number;
  bearing: number;
  pitch: number;
  corners: LngLatTuple[];
};
type CollaborationViewState = { terrain?: boolean; satellite?: boolean };
type Peer = {
  id: string;
  user: PeerUser;
  viewport?: ViewportSnapshot;
  cursor?: CursorState;
  location?: LocationState;
  followingId?: string | null;
  viewState?: CollaborationViewState;
  updatedAt?: number;
};
type LocalFileLayer = JsonRecord & {
  id: string;
  data?: FileLayerContent;
  syncLayerId?: string;
  remoteLayerId?: string | null;
};
type CollaborationMessage = JsonRecord & {
  type?: string;
  id?: string;
  peer?: Peer;
  peers?: Peer[];
  agent?: AgentParticipant;
  agents?: AgentParticipant[];
  manifests?: FileLayerManifest[];
  layers?: unknown[];
  features?: unknown[];
  persistence?: 'ephemeral' | 'persistent';
  contentHash?: string;
  patch?: JsonRecord;
  doc?: unknown;
  feature?: unknown;
  featureId?: string;
  layerId?: string;
  stackItems?: unknown[];
  revision?: number;
};
type CollaborationMap = {
  getContainer(): HTMLElement;
  getCanvas(): HTMLCanvasElement;
  project(lngLat: LngLatTuple): PointLike;
  unproject(point: [number, number]): { toArray(): LngLatTuple };
  getCenter(): { toArray(): LngLatTuple };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  easeTo(options: EaseToOptions): void;
  on(event: string, handler: (event: { lngLat: { toArray(): LngLatTuple } }) => void): void;
  getCollaborationViewState?: () => { terrain: boolean; satellite: boolean };
  setCollaborationViewState?: (viewState: CollaborationViewState, options?: { silent?: boolean }) => void;
};
type AttributeValue = string | number | boolean | null | undefined;

const EMPTY_LOCATION: LocationState = {
  enabled: false,
  lngLat: null,
  accuracy: null,
  heading: null,
  speed: null,
  updatedAt: null,
};

const PROFILE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5'];

export function activeAgentParticipants(agents: Iterable<AgentParticipant>, now = Date.now()): AgentParticipant[] {
  return [...agents].filter((agent) => agent.active && Number(agent.expiresAt) > now);
}

export function shouldSyncKnownLocalLayer(layer: Layer, annotationFeatureCount = 0) {
  return !(
    layer.kind === 'annotation' &&
    layer.id === ANNOTATION_DEFAULT_LAYER_ID &&
    layer.revision === 0 &&
    annotationFeatureCount === 0
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeGetStorage(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore private browsing and disabled storage.
  }
}

function randomId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
}

function getSessionId() {
  const existing = safeGetStorage(sessionStorage, SESSION_KEY);
  if (existing) return existing;
  const id = randomId('session');
  safeSetStorage(sessionStorage, SESSION_KEY, id);
  return id;
}

function getProfile(): UserProfile {
  const stored = safeGetStorage(localStorage, PROFILE_KEY);
  if (stored) {
    try {
      const profile = JSON.parse(stored) as Partial<UserProfile>;
      if (profile?.userId && profile?.name && profile?.color) {
        return {
          userId: profile.userId,
          name: profile.name,
          color: profile.color,
        };
      }
    } catch {
      // Fall through to a new local profile.
    }
  }

  const userId = randomId('user');
  const color = PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
  const profile = {
    userId,
    name: `Guest ${userId.slice(-4)}`,
    color,
  };
  safeSetStorage(localStorage, PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

function sanitizeProfileName(value: unknown, fallback = 'Guest') {
  const name = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return name || fallback;
}

function normalizeRoom(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || DEFAULT_ROOM;
}

function getInitialRoom() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('room') || params.get('collab');
  return raw ? normalizeRoom(raw) : null;
}

function updateRoomUrl(room: string) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('room', room);
  window.history.replaceState(null, '', nextUrl);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attributes: Record<string, AttributeValue> = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) el.setAttribute(name, String(value));
  }
  return el;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, AttributeValue> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) el.setAttribute(name, String(value));
  }
  return el;
}

function safeColor(color: unknown) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : PROFILE_COLORS[0];
}

function fileLayerManifestToLayerMessage(manifest: FileLayerManifest) {
  return {
    id: manifest.id,
    kind: 'file',
    name: manifest.name,
    visible: manifest.visible !== false,
    sortKey: typeof manifest.sortKey === 'string' ? manifest.sortKey : '000010',
    payload: {
      version: 1,
      fileType: manifest.type === 'gpx' ? 'gpx' : 'geojson',
      contentHash: manifest.contentHash,
      contentType: manifest.contentType || (manifest.type === 'gpx' ? 'application/gpx+xml' : 'application/geo+json'),
      contentEncoding: manifest.contentEncoding === 'gzip' ? 'gzip' : 'identity',
      contentByteLength: manifest.contentByteLength || 0,
      rawByteLength: manifest.rawByteLength || 0,
      bounds: manifest.bounds || null,
      style: {
        color: manifest.color || '#3b82f6',
        opacity: manifest.opacity || 0.95,
        lineWidth: manifest.lineWidth || 5,
      },
    },
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function fileLayerMessageToFileLayerManifest(layer: unknown): FileLayerManifest | null {
  if (!isRecord(layer) || layer.kind !== 'file' || !isRecord(layer.payload)) return null;
  const payload = layer.payload;
  const fileType = payload.fileType === 'gpx' ? 'gpx' : payload.fileType === 'geojson' ? 'geojson' : null;
  const id = typeof layer.id === 'string' ? layer.id : '';
  if (!id || !fileType || typeof payload.contentHash !== 'string') return null;
  const style = isRecord(payload.style) ? payload.style : {};
  return {
    id,
    type: fileType,
    name: String(layer.name || (fileType === 'gpx' ? 'GPX file layer' : 'GeoJSON file layer')),
    visible: layer.visible !== false,
    color: typeof style.color === 'string' ? style.color : '#3b82f6',
    opacity: Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 0.95,
    lineWidth: Number.isFinite(Number(style.lineWidth)) ? Number(style.lineWidth) : 5,
    bounds: Array.isArray(payload.bounds) ? (payload.bounds as FileLayerManifest['bounds']) : null,
    contentHash: payload.contentHash,
    contentType:
      typeof payload.contentType === 'string'
        ? payload.contentType
        : fileType === 'gpx'
          ? 'application/gpx+xml'
          : 'application/geo+json',
    contentEncoding: payload.contentEncoding === 'gzip' ? 'gzip' : 'identity',
    contentByteLength: Number(payload.contentByteLength) || 0,
    rawByteLength: Number(payload.rawByteLength) || 0,
    syncVersion: 1,
    persistence: 'ephemeral',
  };
}

function initials(name: unknown) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? [parts[0][0], parts[1][0]] : [parts[0]?.[0] || '?'];
  return letters.join('').toUpperCase();
}

function pointString(point: PointLike | null | undefined) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
}

function optionalNumber(value: unknown, min: number, max: number) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function normalizeLocalLocation(value: unknown): LocationState {
  const record = isRecord(value) ? value : null;
  if (!record || record.enabled === false) {
    return { ...EMPTY_LOCATION, updatedAt: Date.now() };
  }

  const lngLat = Array.isArray(record.lngLat) ? record.lngLat : [];
  const lng = Number(lngLat[0]);
  const lat = Number(lngLat[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { ...EMPTY_LOCATION, updatedAt: Date.now() };
  }

  return {
    enabled: true,
    lngLat: [Math.min(180, Math.max(-180, lng)), Math.min(85, Math.max(-85, lat))],
    accuracy: optionalNumber(record.accuracy, 0, 50_000),
    heading: optionalNumber(record.heading, 0, 360),
    speed: optionalNumber(record.speed, 0, 200),
    updatedAt: optionalNumber(record.timestamp, 0, Number.MAX_SAFE_INTEGER) || Date.now(),
  };
}

function normalizeLongitude(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function destinationLngLat(lngLat: LngLatTuple, distanceMeters: number, bearingDegrees: number): LngLatTuple {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (Number(lngLat[1]) * Math.PI) / 180;
  const lng1 = (Number(lngLat[0]) * Math.PI) / 180;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);

  const lat2 = Math.asin(sinLat1 * cosDistance + cosLat1 * sinDistance * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * sinDistance * cosLat1, cosDistance - sinLat1 * Math.sin(lat2));

  return [normalizeLongitude((lng2 * 180) / Math.PI), Math.min(85, Math.max(-85, (lat2 * 180) / Math.PI))];
}

function accuracyRingPoints(map: CollaborationMap, lngLat: LngLatTuple, accuracyMeters: number | null | undefined) {
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(accuracy) || accuracy <= 0) return null;

  const points: string[] = [];
  for (let i = 0; i < LOCATION_ACCURACY_SEGMENTS; i += 1) {
    const bearing = (i / LOCATION_ACCURACY_SEGMENTS) * 360;
    const projected = map.project(destinationLngLat(lngLat, accuracy, bearing));
    const point = pointString(projected);
    if (!point) return null;
    points.push(point);
  }
  return points.join(' ');
}

function buildViewportSnapshot(map: CollaborationMap): ViewportSnapshot {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width || 0;
  const height = canvas.clientHeight || canvas.height || 0;
  const cornerPoints: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const corners = cornerPoints.map((point) => map.unproject(point).toArray());

  return {
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    corners,
  };
}

function buildShareUrl(room: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  return url.toString();
}

function readViewState(map: CollaborationMap) {
  return map.getCollaborationViewState?.() || { terrain: false, satellite: false };
}

function applyViewState(map: CollaborationMap, viewState: CollaborationViewState | null | undefined) {
  if (!viewState) return;
  map.setCollaborationViewState?.(
    {
      terrain: Boolean(viewState.terrain),
      satellite: Boolean(viewState.satellite),
    },
    { silent: true },
  );
}

export function installMapCollaboration(map: CollaborationMap, layerStore?: LayerStore) {
  const mapContainer = map.getContainer();
  const clientId = getSessionId();
  const profile = getProfile();
  const peers = new Map<string, Peer>();
  const agents = new Map<string, AgentParticipant>();
  const fileLayerManifests = new Map<string, FileLayerManifest>();
  const fileLayerContentBytes = new Map<string, Uint8Array>();
  const pendingFileLayerAssets = new Map<string, Map<string, FileLayerSyncAsset>>();
  const requestedFileLayerContent = new Set<string>();
  const localFileLayerIds = new Set<string>();
  const knownLocalFileLayers = new Map<string, LocalFileLayer>();
  const uploadedLocalFileLayerHashes = new Map<string, string>();

  let socket: PartySocket | null = null;
  let currentRoom = getInitialRoom();
  let localCursor: CursorState = { visible: false, lngLat: null };
  let localLocation: LocationState = { ...EMPTY_LOCATION };
  let ownConnectionId = clientId;
  let followedPeerId: string | null = null;
  let applyingRemoteView = false;
  let destroyed = false;
  let lastSentAt = 0;
  let sendTimer = 0;
  let overlayFrame = 0;
  let followTimer = 0;
  let lastFollowAt = 0;
  let shareResetTimer = 0;
  let panelExpanded = false;

  const overlay = createSvgElement('svg', {
    class: 'collab-overlay',
    'aria-hidden': 'true',
  });
  const viewportLayer = createSvgElement('g', { class: 'collab-overlay-viewports' });
  const locationLayer = createSvgElement('g', { class: 'collab-overlay-locations' });
  const cursorLayer = createSvgElement('g', { class: 'collab-overlay-cursors' });
  overlay.appendChild(viewportLayer);
  overlay.appendChild(locationLayer);
  overlay.appendChild(cursorLayer);

  const panel = createElement('section', 'collab-panel', {
    'aria-label': 'Map collaboration',
  });
  const compactToggle = createElement('button', 'collab-compact-toggle', {
    type: 'button',
    'aria-label': 'Open collaboration controls',
    title: 'Open collaboration controls',
  });
  const compactAvatars = createElement('span', 'collab-compact-avatars', {
    'aria-hidden': 'true',
  });
  const compactSummary = createElement('span', 'collab-compact-summary');
  const compactTitle = createElement('span', 'collab-compact-title');
  const compactMeta = createElement('span', 'collab-compact-meta');
  compactSummary.appendChild(compactTitle);
  compactSummary.appendChild(compactMeta);
  compactToggle.appendChild(compactAvatars);
  compactToggle.appendChild(compactSummary);

  const panelBody = createElement('div', 'collab-panel-body');

  const roomForm = createElement('form', 'collab-room-form');
  const nameField = createElement('label', 'collab-field collab-name-field');
  const nameLabel = createElement('span', 'collab-field-label');
  nameLabel.textContent = 'Display name';
  const nameHint = createElement('span', 'collab-field-hint');
  nameHint.textContent = 'Shown next to your cursor and viewport';

  const nameInput = createElement('input', 'collab-name-input', {
    type: 'text',
    maxlength: '32',
    spellcheck: 'false',
    autocomplete: 'nickname',
    'aria-label': 'Your name',
    placeholder: 'How others see you',
  });
  nameInput.value = profile.name;
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);
  nameField.appendChild(nameHint);

  const roomField = createElement('label', 'collab-field collab-room-field');
  const roomLabel = createElement('span', 'collab-field-label');
  roomLabel.textContent = 'Shared room';
  const roomHint = createElement('span', 'collab-field-hint');
  roomHint.textContent = 'Anyone with the same room link joins the same live session';

  const roomInput = createElement('input', 'collab-room-input', {
    type: 'text',
    spellcheck: 'false',
    autocapitalize: 'none',
    autocomplete: 'off',
    'aria-label': 'Room',
    placeholder: 'main',
  });
  roomInput.value = currentRoom || '';
  roomField.appendChild(roomLabel);
  roomField.appendChild(roomInput);
  roomField.appendChild(roomHint);

  const actionGroup = createElement('div', 'collab-action-group');

  const joinButton = createElement('button', 'collab-button collab-button-primary collab-join-button', {
    type: 'submit',
  });
  joinButton.textContent = 'Start sharing';

  const shareButton = createElement('button', 'collab-button collab-button-secondary collab-share-button', {
    type: 'button',
  });
  shareButton.textContent = 'Copy invite link';
  shareButton.hidden = true;
  actionGroup.appendChild(joinButton);
  actionGroup.appendChild(shareButton);

  const presenceBar = createElement('div', 'collab-presence-bar');
  const presenceSummary = createElement('span', 'collab-presence-summary');
  const avatars = createElement('div', 'collab-avatars', { 'aria-label': 'People in room' });
  presenceBar.appendChild(presenceSummary);
  presenceBar.appendChild(avatars);

  const followBar = createElement('div', 'collab-follow-bar');
  const followLabel = createElement('span', 'collab-follow-label');
  const stopFollowButton = createElement('button', 'collab-follow-stop', { type: 'button' });
  stopFollowButton.textContent = 'Stop following';
  followBar.appendChild(followLabel);
  followBar.appendChild(stopFollowButton);

  roomForm.appendChild(nameField);
  roomForm.appendChild(roomField);
  roomForm.appendChild(actionGroup);
  panelBody.appendChild(roomForm);
  panelBody.appendChild(presenceBar);
  panelBody.appendChild(followBar);
  panel.appendChild(compactToggle);
  panel.appendChild(panelBody);

  function isMobileViewport() {
    return window.innerWidth <= 760;
  }

  function renderCompactSummary() {
    const state = panel.dataset.connection || 'idle';
    const otherCount = peers.size;

    if (state === 'live') {
      compactTitle.textContent = 'Sharing';
      compactMeta.textContent =
        otherCount === 0 ? `#${currentRoom}` : `#${currentRoom} · ${otherCount} other${otherCount === 1 ? '' : 's'}`;
    } else if (state === 'connecting') {
      compactTitle.textContent = 'Connecting';
      compactMeta.textContent = `#${currentRoom}`;
    } else if (state === 'offline') {
      compactTitle.textContent = 'Offline';
      compactMeta.textContent = 'Open to retry';
    } else {
      compactTitle.textContent = 'Collaborate';
      compactMeta.textContent = 'Open to set name and room';
    }

    const toggleLabel = panelExpanded ? 'Close collaboration controls' : 'Open collaboration controls';
    compactToggle.title = toggleLabel;
    compactToggle.setAttribute('aria-label', toggleLabel);
  }

  function renderPresenceSummary() {
    if (!socket) {
      presenceSummary.textContent = 'Start sharing to invite others';
      avatars.setAttribute('aria-label', 'Collaboration is offline');
      return;
    }

    const totalPeople = peers.size + 1;
    const activeAgents = activeAgentParticipants(agents.values()).length;
    const agentText =
      activeAgents === 0 ? '' : activeAgents === 1 ? ' · 1 agent active' : ` · ${activeAgents} agents active`;
    presenceSummary.textContent =
      peers.size === 0
        ? `No one else is here yet${agentText}`
        : peers.size === 1
          ? `1 other person is here${agentText}`
          : `${peers.size} other people are here${agentText}`;
    avatars.setAttribute(
      'aria-label',
      activeAgents ? `${totalPeople} people and ${activeAgents} agents in room` : `${totalPeople} people in room`,
    );
  }

  function renderLocalProfile() {
    renderCompactAvatars();
    renderCompactSummary();
  }

  function persistProfile() {
    safeSetStorage(localStorage, PROFILE_KEY, JSON.stringify(profile));
  }

  function updateProfileName(value: unknown) {
    const nextName = sanitizeProfileName(value, profile.name);
    nameInput.value = nextName;
    if (profile.name === nextName) return;
    profile.name = nextName;
    persistProfile();
    renderLocalProfile();
    scheduleSend(true);
  }

  function updateActionState() {
    const state = panel.dataset.connection;
    const nextRoom = normalizeRoom(roomInput.value);
    const canCopyLink = state === 'live' && nextRoom === currentRoom;

    joinButton.disabled = state === 'connecting';
    if (state === 'connecting') {
      joinButton.textContent = 'Connecting...';
    } else if (state === 'live' && nextRoom === currentRoom) {
      joinButton.textContent = 'Stop sharing';
    } else if (state === 'live') {
      joinButton.textContent = 'Switch room';
    } else if (state === 'offline') {
      joinButton.textContent = 'Retry connection';
    } else {
      joinButton.textContent = 'Start sharing';
    }

    shareButton.hidden = !canCopyLink;
    shareButton.disabled = !canCopyLink;
  }

  function setPanelExpanded(expanded: boolean) {
    panelExpanded = Boolean(expanded);
    if (panelExpanded) emitUiPanelOpen(mapContainer, 'collaboration');
    panel.dataset.expanded = panelExpanded ? 'true' : 'false';
    compactToggle.setAttribute('aria-expanded', String(panelExpanded));
    renderCompactSummary();
  }

  function setStatus(text: string, state: string) {
    panel.dataset.connection = state;
    updateActionState();
    renderPresenceSummary();
    renderCompactAvatars();
    renderCompactSummary();
  }

  function createAvatarNode(peer: Peer, className = 'collab-avatar') {
    const avatar = createElement('button', className, {
      type: 'button',
      title: `Follow ${peer.user.name}`,
      'aria-label': `Follow ${peer.user.name}`,
    });
    avatar.style.setProperty('--peer-color', safeColor(peer.user.color));
    avatar.textContent = initials(peer.user.name);
    avatar.classList.toggle('following', peer.id === followedPeerId);
    avatar.addEventListener('click', () => {
      if (followedPeerId === peer.id) stopFollowing();
      else followPeer(peer.id, true);
    });
    return avatar;
  }

  function renderCompactAvatars() {
    compactAvatars.replaceChildren();

    const local = createElement('span', 'collab-compact-avatar');
    local.style.setProperty('--peer-color', safeColor(profile.color));
    local.textContent = initials(profile.name);
    compactAvatars.appendChild(local);

    for (const peer of [...peers.values()].slice(0, 3)) {
      const avatar = createElement('span', 'collab-compact-avatar');
      avatar.style.setProperty('--peer-color', safeColor(peer.user.color));
      avatar.textContent = initials(peer.user.name);
      avatar.classList.toggle('following', peer.id === followedPeerId);
      compactAvatars.appendChild(avatar);
    }
    for (const agent of activeAgentParticipants(agents.values()).slice(0, Math.max(0, 3 - peers.size))) {
      const avatar = createElement('span', 'collab-compact-avatar collab-agent-avatar');
      avatar.style.setProperty('--peer-color', safeColor(agent.user.color));
      avatar.textContent = initials(agent.user.name);
      compactAvatars.appendChild(avatar);
    }
  }

  function renderPeople() {
    avatars.replaceChildren();
    const activeAgents = activeAgentParticipants(agents.values());

    if (!socket) {
      const empty = createElement('span', 'collab-empty');
      empty.textContent = 'Offline';
      avatars.appendChild(empty);
    } else if (peers.size === 0 && activeAgents.length === 0) {
      const empty = createElement('span', 'collab-empty');
      empty.textContent = 'Just you';
      avatars.appendChild(empty);
    } else {
      for (const peer of peers.values()) avatars.appendChild(createAvatarNode(peer));
      for (const agent of activeAgents) {
        const avatar = createElement('span', 'collab-avatar collab-agent-avatar', {
          title: `${agent.user.name} · agent active`,
          'aria-label': `${agent.user.name}, agent active`,
        });
        avatar.style.setProperty('--peer-color', safeColor(agent.user.color));
        avatar.textContent = initials(agent.user.name);
        avatars.appendChild(avatar);
      }
    }

    const followedPeer = followedPeerId ? peers.get(followedPeerId) : null;
    followBar.classList.toggle('visible', Boolean(followedPeer));
    followLabel.textContent = followedPeer ? `Following ${followedPeer.user.name}` : '';
    renderPresenceSummary();
    renderCompactAvatars();
    renderCompactSummary();
  }

  function scheduleOverlayRender() {
    if (overlayFrame || destroyed) return;
    overlayFrame = requestAnimationFrame(renderOverlay);
  }

  function renderOverlay() {
    overlayFrame = 0;
    const now = Date.now();
    const viewportNodes: SVGElement[] = [];
    const locationNodes: SVGElement[] = [];
    const cursorNodes: SVGElement[] = [];

    for (const peer of peers.values()) {
      const color = safeColor(peer.user?.color);
      const staleClass = now - (peer.updatedAt || 0) > STALE_PEER_MS ? ' collab-peer-stale' : '';
      const shouldShowViewport = peer.id !== followedPeerId && !peer.followingId;

      if (shouldShowViewport && peer.viewport?.corners?.length === 4) {
        const points = peer.viewport.corners.map((lngLat: LngLatTuple) => pointString(map.project(lngLat)));
        if (points.every(Boolean)) {
          const polygon = createSvgElement('polygon', {
            class: `collab-viewport${staleClass}`,
            points: points.join(' '),
          });
          polygon.style.setProperty('--peer-color', color);
          viewportNodes.push(polygon);

          const center = map.project(peer.viewport.center);
          if (Number.isFinite(center.x) && Number.isFinite(center.y)) {
            const label = createSvgElement('text', {
              class: `collab-viewport-label${staleClass}`,
              x: center.x + 10,
              y: center.y - 10,
            });
            label.style.setProperty('--peer-color', color);
            label.textContent = peer.user.name;
            viewportNodes.push(label);
          }
        }
      }

      if (peer.cursor?.visible && peer.cursor.lngLat) {
        const point = map.project(peer.cursor.lngLat);
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
          const group = createSvgElement('g', {
            class: `collab-cursor${staleClass}`,
            transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`,
          });
          group.style.setProperty('--peer-color', color);
          group.appendChild(
            createSvgElement('path', {
              class: 'collab-cursor-pointer',
              d: 'M0 0 L0 20 L5 15 L8 23 L12 21 L9 13 L17 13 Z',
            }),
          );
          const label = createSvgElement('text', {
            class: 'collab-cursor-label',
            x: 18,
            y: 16,
          });
          label.textContent = peer.user.name;
          group.appendChild(label);
          cursorNodes.push(group);
        }
      }

      if (peer.location?.enabled && peer.location.lngLat) {
        const point = map.project(peer.location.lngLat);
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
          const accuracyPoints = accuracyRingPoints(map, peer.location.lngLat, peer.location.accuracy);
          if (accuracyPoints) {
            const accuracy = createSvgElement('polygon', {
              class: `collab-location-accuracy${staleClass}`,
              points: accuracyPoints,
            });
            accuracy.style.setProperty('--peer-color', color);
            locationNodes.push(accuracy);
          }

          const group = createSvgElement('g', {
            class: `collab-location${staleClass}`,
            transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`,
          });
          group.style.setProperty('--peer-color', color);
          if (Number.isFinite(Number(peer.location.heading))) {
            group.appendChild(
              createSvgElement('path', {
                class: 'collab-location-heading',
                d: 'M0 -24 L5 -10 L0 -13 L-5 -10 Z',
                transform: `rotate(${Number(peer.location.heading).toFixed(1)})`,
              }),
            );
          }
          group.appendChild(
            createSvgElement('circle', {
              class: 'collab-location-dot',
              cx: 0,
              cy: 0,
              r: 6,
            }),
          );
          const label = createSvgElement('text', {
            class: 'collab-location-label',
            x: 12,
            y: 4,
          });
          label.textContent = peer.user.name;
          group.appendChild(label);
          locationNodes.push(group);
        }
      }
    }

    viewportLayer.replaceChildren(...viewportNodes);
    locationLayer.replaceChildren(...locationNodes);
    cursorLayer.replaceChildren(...cursorNodes);
  }

  function sendUpdate() {
    sendTimer = 0;
    if (!socket || destroyed) return;
    lastSentAt = Date.now();
    socket.send(
      JSON.stringify({
        type: 'client:update',
        user: {
          id: profile.userId,
          name: profile.name,
          color: profile.color,
        },
        viewport: buildViewportSnapshot(map),
        cursor: localCursor,
        location: localLocation,
        followingId: followedPeerId,
        viewState: readViewState(map),
      }),
    );
  }

  function sendFileLayerMessage(message: JsonRecord) {
    if (!socket || socket.readyState !== WebSocket.OPEN || destroyed) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function sendLayerMessage(message: JsonRecord) {
    if (!socket || socket.readyState !== WebSocket.OPEN || destroyed) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function dispatchRemoteFileLayerList(
    manifests: FileLayerManifest[],
    persistence: 'ephemeral' | 'persistent' = 'ephemeral',
  ) {
    mapContainer.dispatchEvent(
      new CustomEvent('layer-sync:remote-list', {
        detail: { fileLayers: manifests, persistence },
      }),
    );
  }

  function dispatchRemoteFileLayerDelete(fileLayerId: string) {
    mapContainer.dispatchEvent(
      new CustomEvent('layer-sync:remote-delete', {
        detail: { layerId: fileLayerId },
      }),
    );
  }

  function rememberFileLayerManifests(manifests: FileLayerManifest[]) {
    fileLayerManifests.clear();
    for (const manifest of manifests || []) {
      if (manifest?.id && manifest?.contentHash) fileLayerManifests.set(manifest.id, manifest);
    }
  }

  function requestMissingFileLayerContent(manifests: FileLayerManifest[]) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    for (const manifest of manifests || []) {
      const hash = manifest?.contentHash;
      if (!hash || fileLayerContentBytes.has(hash) || requestedFileLayerContent.has(hash)) continue;
      requestedFileLayerContent.add(hash);
      sendFileLayerMessage({
        type: 'file:content:request',
        contentHash: hash,
      });
    }
  }

  async function dispatchRemoteFileLayerAdd(manifest: FileLayerManifest, contentBytes: Uint8Array) {
    if (!manifest || !contentBytes || localFileLayerIds.has(manifest.id)) return;
    try {
      const content = await materializeFileLayerContent(manifest, contentBytes);
      mapContainer.dispatchEvent(
        new CustomEvent('layer-sync:remote-add', {
          detail: { manifest, content },
        }),
      );
    } catch (error) {
      console.error('Failed to materialize shared file layer:', error);
    }
  }

  function applyFileLayerManifestList(
    manifests: FileLayerManifest[],
    persistence: 'ephemeral' | 'persistent' = 'ephemeral',
  ) {
    rememberFileLayerManifests(manifests);
    dispatchRemoteFileLayerList(manifests, persistence);
    for (const manifest of manifests) {
      if (manifest?.contentHash && fileLayerContentBytes.has(manifest.contentHash)) {
        dispatchRemoteFileLayerAdd(manifest, fileLayerContentBytes.get(manifest.contentHash));
      }
    }
    requestMissingFileLayerContent(manifests);
  }

  async function handleFileContentMessage(data: unknown) {
    const frame = decodeFileContentMessage(data);
    if (!frame) return;
    fileLayerContentBytes.set(frame.contentHash, frame.content);
    requestedFileLayerContent.delete(frame.contentHash);
    for (const manifest of fileLayerManifests.values()) {
      if (manifest.contentHash === frame.contentHash) {
        await dispatchRemoteFileLayerAdd(manifest, frame.content);
      }
    }
  }

  async function syncLocalFileLayer(fileLayer: LocalFileLayer | undefined) {
    if (!fileLayer?.id || !fileLayer?.data) return;
    knownLocalFileLayers.set(fileLayer.syncLayerId || fileLayer.remoteLayerId || fileLayer.id, fileLayer);
    if (!socket || socket.readyState !== WebSocket.OPEN || destroyed) return;
    try {
      const asset = await buildFileLayerSyncAsset(fileLayer);
      if (!asset || !socket || socket.readyState !== WebSocket.OPEN || destroyed) return;
      const fileLayerId = asset.envelope.manifest.id;
      const previousHash = uploadedLocalFileLayerHashes.get(fileLayerId);
      if (previousHash === asset.envelope.manifest.contentHash) {
        sendFileLayerMessage({
          type: 'layer:create',
          layer: fileLayerManifestToLayerMessage(asset.envelope.manifest),
        });
        return;
      }
      localFileLayerIds.add(fileLayerId);
      fileLayerManifests.set(fileLayerId, asset.envelope.manifest);
      const pendingForHash = pendingFileLayerAssets.get(asset.envelope.manifest.contentHash) || new Map();
      pendingForHash.set(fileLayerId, asset);
      pendingFileLayerAssets.set(asset.envelope.manifest.contentHash, pendingForHash);
      fileLayerContentBytes.set(asset.envelope.manifest.contentHash, asset.content);
      uploadedLocalFileLayerHashes.set(fileLayerId, asset.envelope.manifest.contentHash);
      socket.send(encodeFileContentMessage(asset.envelope.manifest.contentHash, asset.content));
    } catch (error) {
      console.error('Failed to sync file layer:', error);
    }
  }

  async function syncKnownLocalFileLayers() {
    for (const fileLayer of knownLocalFileLayers.values()) {
      if (!fileLayer.remoteLayerId) await syncLocalFileLayer(fileLayer);
    }
  }

  function syncKnownLocalLayers() {
    if (!layerStore) return;
    sendLayerMessage({ type: 'layer:list:request' });
    sendLayerMessage({ type: 'annotation-feature:list:request' });
    for (const layer of layerStore.getLayers?.() || []) {
      const featureCount = layer.kind === 'annotation' ? (layerStore.getAnnotationFeatureCount?.(layer.id) ?? 0) : 0;
      if (!shouldSyncKnownLocalLayer(layer, featureCount)) continue;
      sendLayerMessage({ type: 'layer:create', layer });
    }
    for (const feature of layerStore.getAnnotationFeatures?.() || []) {
      sendLayerMessage({ type: 'annotation-feature:upsert', feature });
    }
  }

  function completePendingFileLayerUpload(contentHash: string | undefined) {
    const assets = pendingFileLayerAssets.get(contentHash);
    if (!assets) return;
    pendingFileLayerAssets.delete(contentHash);
    for (const asset of assets.values()) {
      sendFileLayerMessage({
        type: 'layer:create',
        layer: fileLayerManifestToLayerMessage(asset.envelope.manifest),
      });
    }
  }

  function patchPendingFileLayerAsset(fileLayerId: string, patch: JsonRecord) {
    const localFileLayer = knownLocalFileLayers.get(fileLayerId);
    if (localFileLayer) Object.assign(localFileLayer, patch);
    for (const assets of pendingFileLayerAssets.values()) {
      const asset = assets.get(fileLayerId);
      if (!asset) continue;
      if (asset.envelope.manifest.id !== fileLayerId) continue;
      asset.envelope.manifest = {
        ...asset.envelope.manifest,
        ...patch,
        id: asset.envelope.manifest.id,
        type: asset.envelope.manifest.type,
        contentHash: asset.envelope.manifest.contentHash,
        updatedAt: Date.now(),
      };
      fileLayerManifests.set(fileLayerId, asset.envelope.manifest);
    }
  }

  function resendPendingFileLayerContent(contentHash: string | undefined) {
    const asset = pendingFileLayerAssets.get(contentHash)?.values().next().value;
    if (!asset || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeFileContentMessage(contentHash, asset.content));
  }

  function scheduleSend(immediate = false) {
    if (!socket || destroyed) return;
    const elapsed = Date.now() - lastSentAt;
    if (immediate || elapsed >= SEND_INTERVAL_MS) {
      if (sendTimer) {
        clearTimeout(sendTimer);
        sendTimer = 0;
      }
      sendUpdate();
      return;
    }
    if (!sendTimer) {
      sendTimer = window.setTimeout(sendUpdate, SEND_INTERVAL_MS - elapsed);
    }
  }

  function stopFollowing() {
    if (!followedPeerId) return;
    followedPeerId = null;
    renderPeople();
    scheduleOverlayRender();
    scheduleSend(true);
  }

  function applyFollow(peer: Peer | undefined, immediate = false) {
    if (!peer?.viewport) return;
    const viewport = peer.viewport;
    const duration = immediate ? 260 : 180;
    applyingRemoteView = true;
    applyViewState(map, peer.viewState);
    map.easeTo({
      center: viewport.center,
      zoom: viewport.zoom,
      bearing: viewport.bearing,
      pitch: viewport.pitch,
      duration,
      essential: true,
    });
    window.setTimeout(() => {
      applyingRemoteView = false;
    }, duration + 80);
  }

  function scheduleFollow(peer: Peer | undefined) {
    if (!peer || peer.id !== followedPeerId) return;
    const elapsed = Date.now() - lastFollowAt;
    if (elapsed >= FOLLOW_INTERVAL_MS) {
      lastFollowAt = Date.now();
      applyFollow(peer);
      return;
    }
    if (!followTimer) {
      followTimer = window.setTimeout(() => {
        followTimer = 0;
        lastFollowAt = Date.now();
        applyFollow(followedPeerId ? peers.get(followedPeerId) : undefined);
      }, FOLLOW_INTERVAL_MS - elapsed);
    }
  }

  function followPeer(peerId: string, immediate = false) {
    const peer = peers.get(peerId);
    if (!peer) return;
    followedPeerId = peerId;
    renderPeople();
    scheduleOverlayRender();
    scheduleSend(true);
    applyFollow(peer, immediate);
  }

  function upsertPeer(peer: Peer | undefined) {
    if (!peer?.id || peer.id === ownConnectionId) return;
    peers.set(peer.id, peer);
    renderPeople();
    scheduleOverlayRender();
    if (peer.id === followedPeerId) scheduleFollow(peer);
  }

  function setAgents(items: AgentParticipant[] | undefined) {
    agents.clear();
    for (const agent of items || []) {
      if (agent?.id) agents.set(agent.id, agent);
    }
    renderPeople();
  }

  function upsertAgent(agent: AgentParticipant | undefined) {
    if (!agent?.id) return;
    agents.set(agent.id, agent);
    renderPeople();
  }

  async function handleMessage(event: MessageEvent) {
    if (typeof event.data !== 'string') {
      await handleFileContentMessage(event.data);
      return;
    }

    let message: CollaborationMessage;
    try {
      message = JSON.parse(event.data) as CollaborationMessage;
    } catch {
      return;
    }

    if (message.type === 'presence:init') {
      ownConnectionId = message.id || ownConnectionId;
      peers.clear();
      for (const peer of message.peers || []) upsertPeer(peer);
      setAgents(message.agents);
      if (followedPeerId && !peers.has(followedPeerId)) followedPeerId = null;
      renderPeople();
      scheduleOverlayRender();
      scheduleSend(true);
      return;
    }

    if (message.type === 'file:content:stored') {
      completePendingFileLayerUpload(message.contentHash);
      return;
    }

    if (message.type === 'file:content:needed') {
      resendPendingFileLayerContent(message.contentHash);
      return;
    }

    if (
      message.type === 'layer:list' ||
      message.type === 'layer:created' ||
      message.type === 'layer:updated' ||
      message.type === 'layer:deleted' ||
      message.type === 'layer:reordered'
    ) {
      layerStore?.applyLayerServerMessage(message as LayerServerMessage);
      if (message.type === 'layer:list') {
        applyFileLayerManifestList((message.layers || []).map(fileLayerMessageToFileLayerManifest).filter(Boolean));
      } else if (message.type === 'layer:created' || message.type === 'layer:updated') {
        const manifest = fileLayerMessageToFileLayerManifest(message.layer);
        if (manifest) {
          fileLayerManifests.set(manifest.id, manifest);
          applyFileLayerManifestList(Array.from(fileLayerManifests.values()));
          const content = fileLayerContentBytes.get(manifest.contentHash || '');
          if (content) await dispatchRemoteFileLayerAdd(manifest, content);
        }
      } else if (message.type === 'layer:deleted' && message.layerId) {
        fileLayerManifests.delete(message.layerId);
        dispatchRemoteFileLayerDelete(message.layerId);
      } else if (message.type === 'layer:reordered') {
        applyFileLayerManifestList((message.layers || []).map(fileLayerMessageToFileLayerManifest).filter(Boolean));
      }
      return;
    }

    if (
      message.type === 'annotation-feature:list' ||
      message.type === 'annotation-feature:upserted' ||
      message.type === 'annotation-feature:deleted' ||
      message.type === 'annotation-feature:reordered' ||
      message.type === 'annotation-feature:rejected'
    ) {
      layerStore?.applyAnnotationFeatureServerMessage(message as AnnotationFeatureServerMessage);
      return;
    }

    if (message.type === 'presence:join' || message.type === 'presence:update') {
      upsertPeer(message.peer);
      return;
    }

    if (message.type === 'agent:participant:update') {
      upsertAgent(message.agent);
      return;
    }

    if (message.type === 'presence:leave') {
      peers.delete(message.id);
      if (followedPeerId === message.id) {
        followedPeerId = null;
        scheduleSend(true);
      }
      renderPeople();
      scheduleOverlayRender();
    }
  }

  function connect(roomValue: string) {
    const room = normalizeRoom(roomValue);
    currentRoom = room;
    roomInput.value = room;
    updateRoomUrl(room);
    peers.clear();
    fileLayerManifests.clear();
    requestedFileLayerContent.clear();
    followedPeerId = null;
    renderPeople();
    scheduleOverlayRender();

    if (socket) {
      socket.close(1000, 'room change');
      socket = null;
    }

    const nextSocket = new PartySocket({
      host: window.location.host,
      party: PARTY_NAME,
      room,
      id: clientId,
      protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
      query: () => ({
        userId: profile.userId,
        name: profile.name,
        color: profile.color,
      }),
      maxEnqueuedMessages: 32,
      maxReconnectionDelay: 5_000,
    });
    nextSocket.binaryType = 'arraybuffer';
    socket = nextSocket;
    setStatus('Connecting', 'connecting');

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return;
      setStatus('Live', 'live');
      if (isMobileViewport()) setPanelExpanded(false);
      syncKnownLocalFileLayers();
      syncKnownLocalLayers();
      scheduleSend(true);
    });
    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) return;
      setStatus('Offline', 'offline');
    });
    nextSocket.addEventListener('error', () => {
      if (socket !== nextSocket) return;
      setStatus('Offline', 'offline');
    });
    nextSocket.addEventListener('message', (event: MessageEvent) => {
      if (socket !== nextSocket) return;
      handleMessage(event).catch((error) => {
        console.error('Failed to handle collaboration message:', error);
      });
    });
  }

  function disconnect() {
    if (socket) {
      const closing = socket;
      socket = null;
      closing.close(1000, 'disconnect');
    }
    clearTimeout(sendTimer);
    clearTimeout(followTimer);
    sendTimer = 0;
    followTimer = 0;
    peers.clear();
    fileLayerManifests.clear();
    fileLayerContentBytes.clear();
    pendingFileLayerAssets.clear();
    requestedFileLayerContent.clear();
    localFileLayerIds.clear();
    uploadedLocalFileLayerHashes.clear();
    followedPeerId = null;
    localCursor = { visible: false, lngLat: null };
    ownConnectionId = clientId;
    viewportLayer.replaceChildren();
    locationLayer.replaceChildren();
    cursorLayer.replaceChildren();
    setPanelExpanded(false);
    setStatus('Ready', 'idle');
    renderPeople();
  }

  roomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    updateProfileName(nameInput.value);
    const nextRoom = normalizeRoom(roomInput.value);
    if (panel.dataset.connection === 'live' && nextRoom === currentRoom) {
      disconnect();
      return;
    }
    const shouldConnect = !socket || socket.readyState > WebSocket.OPEN || nextRoom !== currentRoom;
    if (!shouldConnect) {
      roomInput.value = nextRoom;
      scheduleSend(true);
      return;
    }
    connect(nextRoom);
  });
  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (destroyed || !panelExpanded) return;
    if (event.target instanceof Node && !panel.contains(event.target)) setPanelExpanded(false);
  };
  compactToggle.addEventListener('click', () => setPanelExpanded(!panelExpanded));
  document.addEventListener('pointerdown', handleDocumentPointerDown, { passive: true });

  nameInput.addEventListener('change', () => updateProfileName(nameInput.value));
  nameInput.addEventListener('blur', () => updateProfileName(nameInput.value));
  nameInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      nameInput.value = profile.name;
      nameInput.blur();
    }
  });
  roomInput.addEventListener('input', updateActionState);

  shareButton.addEventListener('click', async () => {
    const room = normalizeRoom(roomInput.value);
    currentRoom = room;
    roomInput.value = room;
    updateRoomUrl(room);
    renderCompactSummary();
    const url = buildShareUrl(room);
    clearTimeout(shareResetTimer);
    try {
      await navigator.clipboard.writeText(url);
      shareButton.textContent = 'Link copied';
    } catch {
      shareButton.textContent = 'Copy failed';
    }
    shareResetTimer = window.setTimeout(() => {
      shareButton.textContent = 'Copy invite link';
    }, 1_300);
  });

  stopFollowButton.addEventListener('click', stopFollowing);
  mapContainer.addEventListener('collaboration:viewstatechange', () => {
    if (!applyingRemoteView && followedPeerId) stopFollowing();
    scheduleSend(true);
  });
  const handleLocationChange = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    localLocation = normalizeLocalLocation(detail);
    scheduleSend(true);
  };
  const handleUiPanelOpen = (event: Event) => {
    if (isOtherUiPanelOpen(event, 'collaboration')) setPanelExpanded(false);
  };
  const handleLocalFileLayerUpsert = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    syncLocalFileLayer(detail?.layer);
  };
  const handleLocalFileLayerPatch = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    const fileLayerId = typeof detail?.layerId === 'string' ? detail.layerId : '';
    const patch = isRecord(detail?.patch) ? detail.patch : null;
    if (!fileLayerId || !patch) return;
    patchPendingFileLayerAsset(fileLayerId, patch);
    const stylePatch: JsonRecord = {};
    if (typeof patch.color === 'string') stylePatch.color = patch.color;
    if (typeof patch.opacity === 'number') stylePatch.opacity = patch.opacity;
    if (typeof patch.lineWidth === 'number') stylePatch.lineWidth = patch.lineWidth;
    sendFileLayerMessage({
      type: 'layer:update',
      layerId: fileLayerId,
      patch: {
        name: typeof patch.name === 'string' ? patch.name : undefined,
        visible: typeof patch.visible === 'boolean' ? patch.visible : undefined,
        payload: Object.keys(stylePatch).length > 0 ? { style: stylePatch } : undefined,
      },
    });
  };
  const handleLocalFileLayerReorder = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    const stackItems = Array.isArray(detail?.stackItems) ? detail.stackItems : [];
    if (pendingFileLayerAssets.size > 0) {
      const order = new Map(
        stackItems
          .map((item: JsonRecord, index: number) => {
            const layerId = typeof item?.layerId === 'string' ? item.layerId : '';
            return layerId ? [layerId, index] : null;
          })
          .filter(Boolean) as Array<[string, number]>,
      );
      for (const assets of pendingFileLayerAssets.values()) {
        for (const asset of assets.values()) {
          const id = asset.envelope.manifest.id;
          if (!order.has(id)) continue;
          const orderIndex = order.get(id);
          asset.envelope.manifest = {
            ...asset.envelope.manifest,
            pendingOrderIndex: orderIndex,
            sortKey: typeof orderIndex === 'number' ? initialSortKey(orderIndex) : asset.envelope.manifest.sortKey,
            updatedAt: Date.now(),
          };
          fileLayerManifests.set(id, asset.envelope.manifest);
        }
      }
    }
    const updates =
      stackItems.length > 0
        ? stackItems
            .map((item: JsonRecord, index: number) => {
              const layerId =
                item?.kind === 'file'
                  ? typeof item.layerId === 'string'
                    ? item.layerId
                    : ''
                  : item?.kind === 'annotation' && typeof item.layerId === 'string'
                    ? item.layerId
                    : '';
              return layerId ? { layerId, sortKey: initialSortKey(index) } : null;
            })
            .filter(Boolean)
        : [];
    if (updates.length === 0) return;
    sendFileLayerMessage({ type: 'layer:reorder', updates });
  };
  const handleLocalFileLayerDelete = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    const fileLayerId = typeof detail?.layerId === 'string' ? detail.layerId : '';
    if (!fileLayerId) return;
    localFileLayerIds.delete(fileLayerId);
    knownLocalFileLayers.delete(fileLayerId);
    uploadedLocalFileLayerHashes.delete(fileLayerId);
    for (const [id, manifest] of fileLayerManifests) {
      if (manifest.id === fileLayerId) fileLayerManifests.delete(id);
    }
    sendFileLayerMessage({
      type: 'layer:delete',
      layerId: fileLayerId,
    });
  };
  mapContainer.addEventListener('collaboration:locationchange', handleLocationChange);
  mapContainer.addEventListener(UI_PANEL_OPEN_EVENT, handleUiPanelOpen);
  mapContainer.addEventListener('layer-sync:local-upsert', handleLocalFileLayerUpsert);
  mapContainer.addEventListener('layer-sync:local-patch', handleLocalFileLayerPatch);
  mapContainer.addEventListener('layer-sync:local-reorder', handleLocalFileLayerReorder);
  mapContainer.addEventListener('layer-sync:local-delete', handleLocalFileLayerDelete);

  const unsubscribeLayerStore = layerStore?.subscribe((event) => {
    if (event.remote) return;
    if (event.type === 'layer:upsert') {
      sendLayerMessage({ type: 'layer:create', layer: event.layer });
    } else if (event.type === 'layer:update') {
      sendLayerMessage({
        type: 'layer:update',
        layerId: event.layer.id,
        patch: {
          name: event.layer.name,
          visible: event.layer.visible,
          sortKey: event.layer.sortKey,
          payload: event.layer.kind === 'file' ? event.layer.payload : undefined,
        },
      });
    } else if (event.type === 'layer:delete') {
      sendLayerMessage({ type: 'layer:delete', layerId: event.layerId });
    } else if (event.type === 'layer:reorder') {
      sendLayerMessage({
        type: 'layer:reorder',
        updates: event.layers.map((layer) => ({ layerId: layer.id, sortKey: layer.sortKey })),
      });
    } else if (event.type === 'feature:upsert') {
      sendLayerMessage({ type: 'annotation-feature:upsert', feature: event.feature });
    } else if (event.type === 'feature:delete') {
      sendLayerMessage({ type: 'annotation-feature:delete', featureId: event.featureId });
    } else if (event.type === 'feature:reorder') {
      sendLayerMessage({
        type: 'annotation-feature:reorder',
        updates: event.features.map((feature) => ({ featureId: feature.id, sortKey: feature.sortKey })),
      });
    }
  });

  for (const eventName of ['mousedown', 'dblclick', 'wheel', 'touchstart']) {
    panel.addEventListener(eventName, (event: Event) => event.stopPropagation(), { passive: eventName !== 'wheel' });
  }

  map.on('move', () => {
    scheduleOverlayRender();
    scheduleSend();
  });
  map.on('moveend', () => scheduleSend(true));
  map.on('render', scheduleOverlayRender);
  map.on('mousemove', (event: { lngLat: { toArray(): LngLatTuple } }) => {
    localCursor = {
      visible: true,
      lngLat: event.lngLat.toArray(),
    };
    scheduleSend();
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    localCursor = { visible: false, lngLat: null };
    scheduleSend(true);
  });

  for (const eventName of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
    map.on(eventName, () => {
      if (!applyingRemoteView && followedPeerId) stopFollowing();
    });
  }

  mapContainer.appendChild(overlay);
  mapContainer.appendChild(panel);
  setPanelExpanded(false);
  setStatus('Ready', 'idle');
  renderPeople();
  if (currentRoom) connect(currentRoom);

  return {
    destroy() {
      destroyed = true;
      clearTimeout(sendTimer);
      clearTimeout(followTimer);
      clearTimeout(shareResetTimer);
      if (overlayFrame) cancelAnimationFrame(overlayFrame);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      mapContainer.removeEventListener('collaboration:locationchange', handleLocationChange);
      mapContainer.removeEventListener(UI_PANEL_OPEN_EVENT, handleUiPanelOpen);
      mapContainer.removeEventListener('layer-sync:local-upsert', handleLocalFileLayerUpsert);
      mapContainer.removeEventListener('layer-sync:local-patch', handleLocalFileLayerPatch);
      mapContainer.removeEventListener('layer-sync:local-reorder', handleLocalFileLayerReorder);
      mapContainer.removeEventListener('layer-sync:local-delete', handleLocalFileLayerDelete);
      unsubscribeLayerStore?.();
      socket?.close(1000, 'destroy');
      overlay.remove();
      panel.remove();
    },
  };
}
