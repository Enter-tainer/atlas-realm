import PartySocket from 'partysocket';

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
const EMPTY_LOCATION = {
  enabled: false,
  lngLat: null,
  accuracy: null,
  heading: null,
  speed: null,
  updatedAt: null,
};

const PROFILE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#be123c',
  '#4f46e5',
];

function safeGetStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore private browsing and disabled storage.
  }
}

function randomId(prefix) {
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

function getProfile() {
  const stored = safeGetStorage(localStorage, PROFILE_KEY);
  if (stored) {
    try {
      const profile = JSON.parse(stored);
      if (profile?.userId && profile?.name && profile?.color) return profile;
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

function sanitizeProfileName(value, fallback = 'Guest') {
  const name = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return name || fallback;
}

function normalizeRoom(value) {
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

function updateRoomUrl(room) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('room', room);
  window.history.replaceState(null, '', nextUrl);
}

function createElement(tag, className, attributes = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) el.setAttribute(name, value);
  }
  return el;
}

function createSvgElement(tag, attributes = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) el.setAttribute(name, String(value));
  }
  return el;
}

function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : PROFILE_COLORS[0];
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0][0], parts[1][0]] : [parts[0]?.[0] || '?'];
  return letters.join('').toUpperCase();
}

function pointString(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function normalizeLocalLocation(value) {
  if (!value || value.enabled === false) {
    return { ...EMPTY_LOCATION, updatedAt: Date.now() };
  }

  const lng = Number(value.lngLat?.[0]);
  const lat = Number(value.lngLat?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { ...EMPTY_LOCATION, updatedAt: Date.now() };
  }

  return {
    enabled: true,
    lngLat: [
      Math.min(180, Math.max(-180, lng)),
      Math.min(85, Math.max(-85, lat)),
    ],
    accuracy: optionalNumber(value.accuracy, 0, 50_000),
    heading: optionalNumber(value.heading, 0, 360),
    speed: optionalNumber(value.speed, 0, 200),
    updatedAt: optionalNumber(value.timestamp, 0, Number.MAX_SAFE_INTEGER) || Date.now(),
  };
}

function normalizeLongitude(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function destinationLngLat(lngLat, distanceMeters, bearingDegrees) {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (Number(lngLat[1]) * Math.PI) / 180;
  const lng1 = (Number(lngLat[0]) * Math.PI) / 180;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);

  const lat2 = Math.asin((sinLat1 * cosDistance) + (cosLat1 * sinDistance * Math.cos(bearing)));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * sinDistance * cosLat1,
    cosDistance - (sinLat1 * Math.sin(lat2)),
  );

  return [
    normalizeLongitude((lng2 * 180) / Math.PI),
    Math.min(85, Math.max(-85, (lat2 * 180) / Math.PI)),
  ];
}

function accuracyRingPoints(map, lngLat, accuracyMeters) {
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(accuracy) || accuracy <= 0) return null;

  const points = [];
  for (let i = 0; i < LOCATION_ACCURACY_SEGMENTS; i += 1) {
    const bearing = (i / LOCATION_ACCURACY_SEGMENTS) * 360;
    const projected = map.project(destinationLngLat(lngLat, accuracy, bearing));
    const point = pointString(projected);
    if (!point) return null;
    points.push(point);
  }
  return points.join(' ');
}

function buildViewportSnapshot(map) {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width || 0;
  const height = canvas.clientHeight || canvas.height || 0;
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map((point) => map.unproject(point).toArray());

  return {
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    corners,
  };
}

function buildShareUrl(room) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  return url.toString();
}

function readViewState(map) {
  return map.getCollaborationViewState?.() || { terrain: false, satellite: false };
}

function applyViewState(map, viewState) {
  if (!viewState || typeof viewState !== 'object') return;
  map.setCollaborationViewState?.({
    terrain: Boolean(viewState.terrain),
    satellite: Boolean(viewState.satellite),
  }, { silent: true });
}

export function installMapCollaboration(map) {
  const mapContainer = map.getContainer();
  const clientId = getSessionId();
  const profile = getProfile();
  const peers = new Map();

  let socket = null;
  let currentRoom = getInitialRoom();
  let localCursor = { visible: false, lngLat: null };
  let localLocation = { ...EMPTY_LOCATION };
  let ownConnectionId = clientId;
  let followedPeerId = null;
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
  overlay.append(viewportLayer, locationLayer, cursorLayer);

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
  compactSummary.append(compactTitle, compactMeta);
  compactToggle.append(compactAvatars, compactSummary);

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
  nameField.append(nameLabel, nameInput, nameHint);

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
  roomField.append(roomLabel, roomInput, roomHint);

  const actionGroup = createElement('div', 'collab-action-group');

  const joinButton = createElement('button', 'collab-button collab-button-primary collab-join-button', { type: 'submit' });
  joinButton.textContent = 'Start sharing';

  const shareButton = createElement('button', 'collab-button collab-button-secondary collab-share-button', { type: 'button' });
  shareButton.textContent = 'Copy invite link';
  shareButton.hidden = true;
  actionGroup.append(joinButton, shareButton);

  const presenceBar = createElement('div', 'collab-presence-bar');
  const presenceSummary = createElement('span', 'collab-presence-summary');
  const avatars = createElement('div', 'collab-avatars', { 'aria-label': 'People in room' });
  presenceBar.append(presenceSummary, avatars);

  const followBar = createElement('div', 'collab-follow-bar');
  const followLabel = createElement('span', 'collab-follow-label');
  const stopFollowButton = createElement('button', 'collab-follow-stop', { type: 'button' });
  stopFollowButton.textContent = 'Stop following';
  followBar.append(followLabel, stopFollowButton);

  roomForm.append(nameField, roomField, actionGroup);
  panelBody.append(roomForm, presenceBar, followBar);
  panel.append(compactToggle, panelBody);

  function isMobileViewport() {
    return window.innerWidth <= 760;
  }

  function renderCompactSummary() {
    const state = panel.dataset.connection || 'idle';
    const otherCount = peers.size;

    if (state === 'live') {
      compactTitle.textContent = 'Sharing';
      compactMeta.textContent = otherCount === 0
        ? `#${currentRoom}`
        : `#${currentRoom} · ${otherCount} other${otherCount === 1 ? '' : 's'}`;
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

    const toggleLabel = panelExpanded
      ? 'Close collaboration controls'
      : 'Open collaboration controls';
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
    presenceSummary.textContent = peers.size === 0
      ? 'No one else is here yet'
      : peers.size === 1
        ? '1 other person is here'
        : `${peers.size} other people are here`;
    avatars.setAttribute('aria-label', `${totalPeople} people in room`);
  }

  function renderLocalProfile() {
    renderCompactAvatars();
    renderCompactSummary();
  }

  function persistProfile() {
    safeSetStorage(localStorage, PROFILE_KEY, JSON.stringify(profile));
  }

  function updateProfileName(value) {
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

  function setPanelExpanded(expanded) {
    panelExpanded = Boolean(expanded);
    panel.dataset.expanded = panelExpanded ? 'true' : 'false';
    compactToggle.setAttribute('aria-expanded', String(panelExpanded));
    renderCompactSummary();
  }

  function setStatus(text, state) {
    panel.dataset.connection = state;
    updateActionState();
    renderPresenceSummary();
    renderCompactAvatars();
    renderCompactSummary();
  }

  function createAvatarNode(peer, className = 'collab-avatar') {
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
    compactAvatars.append(local);

    for (const peer of [...peers.values()].slice(0, 3)) {
      const avatar = createElement('span', 'collab-compact-avatar');
      avatar.style.setProperty('--peer-color', safeColor(peer.user.color));
      avatar.textContent = initials(peer.user.name);
      avatar.classList.toggle('following', peer.id === followedPeerId);
      compactAvatars.append(avatar);
    }
  }

  function renderPeople() {
    avatars.replaceChildren();

    if (!socket) {
      const empty = createElement('span', 'collab-empty');
      empty.textContent = 'Offline';
      avatars.append(empty);
    } else if (peers.size === 0) {
      const empty = createElement('span', 'collab-empty');
      empty.textContent = 'Just you';
      avatars.append(empty);
    } else {
      for (const peer of peers.values()) avatars.append(createAvatarNode(peer));
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
    const viewportNodes = [];
    const locationNodes = [];
    const cursorNodes = [];

    for (const peer of peers.values()) {
      const color = safeColor(peer.user?.color);
      const staleClass = now - (peer.updatedAt || 0) > STALE_PEER_MS ? ' collab-peer-stale' : '';
      const shouldShowViewport = peer.id !== followedPeerId && !peer.followingId;

      if (shouldShowViewport && peer.viewport?.corners?.length === 4) {
        const points = peer.viewport.corners.map((lngLat) => pointString(map.project(lngLat)));
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
          group.append(
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
          group.append(label);
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
            group.append(createSvgElement('path', {
              class: 'collab-location-heading',
              d: 'M0 -24 L5 -10 L0 -13 L-5 -10 Z',
              transform: `rotate(${Number(peer.location.heading).toFixed(1)})`,
            }));
          }
          group.append(createSvgElement('circle', {
            class: 'collab-location-dot',
            cx: 0,
            cy: 0,
            r: 6,
          }));
          const label = createSvgElement('text', {
            class: 'collab-location-label',
            x: 12,
            y: 4,
          });
          label.textContent = peer.user.name;
          group.append(label);
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
    socket.send(JSON.stringify({
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
    }));
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

  function applyFollow(peer, immediate = false) {
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

  function scheduleFollow(peer) {
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
        applyFollow(peers.get(followedPeerId));
      }, FOLLOW_INTERVAL_MS - elapsed);
    }
  }

  function followPeer(peerId, immediate = false) {
    const peer = peers.get(peerId);
    if (!peer) return;
    followedPeerId = peerId;
    renderPeople();
    scheduleOverlayRender();
    scheduleSend(true);
    applyFollow(peer, immediate);
  }

  function upsertPeer(peer) {
    if (!peer?.id || peer.id === ownConnectionId) return;
    peers.set(peer.id, peer);
    renderPeople();
    scheduleOverlayRender();
    if (peer.id === followedPeerId) scheduleFollow(peer);
  }

  function handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === 'presence:init') {
      ownConnectionId = message.id || ownConnectionId;
      peers.clear();
      for (const peer of message.peers || []) upsertPeer(peer);
      if (followedPeerId && !peers.has(followedPeerId)) followedPeerId = null;
      renderPeople();
      scheduleOverlayRender();
      scheduleSend(true);
      return;
    }

    if (message.type === 'presence:join' || message.type === 'presence:update') {
      upsertPeer(message.peer);
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

  function connect(roomValue) {
    const room = normalizeRoom(roomValue);
    currentRoom = room;
    roomInput.value = room;
    updateRoomUrl(room);
    peers.clear();
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
    socket = nextSocket;
    setStatus('Connecting', 'connecting');

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return;
      setStatus('Live', 'live');
      if (isMobileViewport()) setPanelExpanded(false);
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
    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket) return;
      handleMessage(event);
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
  const handleDocumentPointerDown = (event) => {
    if (destroyed || !panelExpanded) return;
    if (!panel.contains(event.target)) setPanelExpanded(false);
  };
  compactToggle.addEventListener('click', () => setPanelExpanded(!panelExpanded));
  document.addEventListener('pointerdown', handleDocumentPointerDown, { passive: true });

  nameInput.addEventListener('change', () => updateProfileName(nameInput.value));
  nameInput.addEventListener('blur', () => updateProfileName(nameInput.value));
  nameInput.addEventListener('keydown', (event) => {
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
  const handleLocationChange = (event) => {
    localLocation = normalizeLocalLocation(event.detail);
    scheduleSend(true);
  };
  mapContainer.addEventListener('collaboration:locationchange', handleLocationChange);

  for (const eventName of ['mousedown', 'dblclick', 'wheel', 'touchstart']) {
    panel.addEventListener(eventName, (event) => event.stopPropagation(), { passive: eventName !== 'wheel' });
  }

  map.on('move', () => {
    scheduleOverlayRender();
    scheduleSend();
  });
  map.on('moveend', () => scheduleSend(true));
  map.on('render', scheduleOverlayRender);
  map.on('mousemove', (event) => {
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

  mapContainer.append(overlay, panel);
  setPanelExpanded(false);
  setStatus('Ready', 'idle');
  renderPeople();

  return {
    destroy() {
      destroyed = true;
      clearTimeout(sendTimer);
      clearTimeout(followTimer);
      clearTimeout(shareResetTimer);
      if (overlayFrame) cancelAnimationFrame(overlayFrame);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      mapContainer.removeEventListener('collaboration:locationchange', handleLocationChange);
      socket?.close(1000, 'destroy');
      overlay.remove();
      panel.remove();
    },
  };
}
