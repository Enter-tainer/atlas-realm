import { Server, type Connection, type ConnectionContext, type WSMessage } from 'partyserver';
import { getRoomAccessSnapshot } from '../room-access.js';
import type { AnnotationFeature, Layer } from '../layer-model.js';
import { canEdit, canManage, effectiveRoomRole, type RoomRole } from '../room-permissions.js';
import { AGENT_RECENT_TTL_MS, AGENT_TOUCH_THROTTLE_MS, PROFILE_COLORS } from './room-constants.js';
import { encodeMessage, isRecord, sanitizeText } from './json-utils.js';
import {
  emptyLocation,
  publicPeer,
  sanitizeAction,
  sanitizeClientType,
  sanitizeColor,
  sanitizeUser,
} from './room-presence.js';
import {
  sanitizeAccessRefreshMode,
  sanitizeAccessRefreshUpdate,
  sanitizePeerId,
  verifyAuthHeaders,
  verifyControlRequest,
} from './room-auth.js';
import {
  annotationFeatureFromRow,
  ensureDefaultAnnotationLayer,
  ensureLayerStorage,
  getFileContent,
  getAnnotationFeature,
  getLayer,
  layerFromRow,
  listAnnotationFeatures,
  listLayers,
  pruneUnreferencedFileContent,
  roomStatus,
  setRoomPersistence,
  touchRoom,
  upsertAnnotationFeatureRow,
  upsertLayerRow,
  type RoomStorageContext,
} from './room-storage.js';
import { handleRoomControlRequest } from './room-control.js';
import { handleRoomSocketMessage, type RoomMessageContext } from './room-messages.js';
import type {
  AccessRefreshUpdate,
  AgentParticipant,
  AuthContext,
  JsonRecord,
  PeerState,
  RoomPersistence,
  UserProfile,
} from './room-types.js';

export class MapCollaboration extends Server<Cloudflare.Env> {
  static options = {
    hibernate: true,
  };

  _storageContext(): RoomStorageContext {
    return {
      name: this.name,
      ctx: this.ctx,
      sql: this.sql.bind(this),
    };
  }

  _messageContext(): RoomMessageContext {
    return {
      ctx: this.ctx,
      sql: this.sql.bind(this),
      broadcast: this.broadcast.bind(this),
      _canEdit: this._canEdit.bind(this),
      _canManage: this._canManage.bind(this),
      _roomStatus: this._roomStatus.bind(this),
      _setRoomPersistence: this._setRoomPersistence.bind(this),
      _listLayers: this._listLayers.bind(this),
      _getLayer: this._getLayer.bind(this),
      _upsertLayerRow: this._upsertLayerRow.bind(this),
      _pruneUnreferencedFileContent: this._pruneUnreferencedFileContent.bind(this),
      _listAnnotationFeatures: this._listAnnotationFeatures.bind(this),
      _getAnnotationFeature: this._getAnnotationFeature.bind(this),
      _upsertAnnotationFeatureRow: this._upsertAnnotationFeatureRow.bind(this),
      _getFileContent: this._getFileContent.bind(this),
      _touchAgentParticipant: this._touchAgentParticipant.bind(this),
    };
  }

  async _verifyAuthHeaders(request: Request): Promise<AuthContext | null> {
    return await verifyAuthHeaders(request, this.name, this.env.INTERNAL_AUTH_SECRET);
  }

  async _verifyControlRequest(request: Request, body: string): Promise<string> {
    return await verifyControlRequest(request, this.name, this.env.INTERNAL_AUTH_SECRET, body);
  }

  _refreshConnectionAccess(connection: Connection<PeerState>, role: RoomRole | null): void {
    const state = connection.state;
    if (!state?.auth) return;
    if (!role) {
      connection.send(encodeMessage({ type: 'access:revoked' }));
      connection.close(4003, 'access revoked');
      return;
    }
    const nextAuth = { ...state.auth, role };
    connection.setState({ ...state, auth: nextAuth });
    connection.send(
      encodeMessage({
        type: 'access:updated',
        role,
        canView: true,
        canEdit: canEdit(role),
        canManage: canManage(role),
      }),
    );
  }

  _applyAccessRefresh(
    updates: AccessRefreshUpdate[],
    connections: Iterable<Connection<PeerState>> = this.getConnections<PeerState>(),
  ): number {
    let count = 0;
    for (const connection of connections) {
      const auth = connection.state?.auth;
      if (!auth) continue;
      const update = updates.find((candidate) => candidate.userId === auth.userId);
      if (!update) continue;
      this._refreshConnectionAccess(connection, update.role);
      count += 1;
    }
    return count;
  }

  async _applyRoomAccessRefresh(
    connections: Iterable<Connection<PeerState>> = this.getConnections<PeerState>(),
  ): Promise<number> {
    const connectionList = [...connections];
    if (!this.env.ACCOUNTS_DB) {
      let fallbackCount = 0;
      for (const connection of connectionList) {
        if (!connection.state?.auth) continue;
        this._refreshConnectionAccess(connection, connection.state.auth.role);
        fallbackCount += 1;
      }
      return fallbackCount;
    }

    const snapshot = await getRoomAccessSnapshot(this.env.ACCOUNTS_DB, this.name);
    let count = 0;
    for (const connection of connectionList) {
      const auth = connection.state?.auth;
      if (!auth) continue;
      const accountUserId = auth.authKind === 'anonymous' ? null : auth.userId;
      const computedRole = snapshot
        ? effectiveRoomRole({
            isOwner: Boolean(accountUserId && snapshot.ownerUserId === accountUserId),
            grantRole: accountUserId ? snapshot.grantsByUserId.get(accountUserId) || null : null,
            linkAccess: snapshot.linkAccess,
          })
        : 'none';
      const role = computedRole === 'none' ? null : computedRole;
      this._refreshConnectionAccess(connection, role);
      count += 1;
    }
    return count;
  }

  async _applyAccessRefreshPayload(
    payload: JsonRecord | null,
    connections: Iterable<Connection<PeerState>> = this.getConnections<PeerState>(),
  ): Promise<number | null> {
    const refresh = isRecord(payload?.refresh) ? payload.refresh : null;
    const mode = sanitizeAccessRefreshMode(refresh?.mode);
    if (mode === 'room') return this._applyRoomAccessRefresh(connections);

    const updates = Array.isArray(payload?.updates)
      ? payload.updates
          .map(sanitizeAccessRefreshUpdate)
          .filter((update): update is AccessRefreshUpdate => Boolean(update))
      : [];
    if (updates.length === 0) return null;
    return this._applyAccessRefresh(updates, connections);
  }

  _roleFor(connection: Connection<PeerState>): RoomRole {
    return connection.state?.auth?.role || (this.env.INTERNAL_AUTH_SECRET ? 'view' : 'manage');
  }

  _canEdit(connection: Connection<PeerState>): boolean {
    return canEdit(this._roleFor(connection));
  }

  _canManage(connection: Connection<PeerState>): boolean {
    return canManage(this._roleFor(connection));
  }

  async _ensureLayerStorage(): Promise<void> {
    await ensureLayerStorage(this._storageContext());
  }

  /** Persisted throttle guard — reads from DO storage once per wake cycle. */
  private static TOUCH_INTERVAL_MS = 60_000;
  private static TOUCH_STORAGE_KEY = '_touch_ts';
  /** Cached in memory after storage read; null = not loaded this wake cycle. */
  private _lastTouchCached: number | null = null;

  /** Use by onConnect and onMessage — throttled writes. */
  async _touchRoom(): Promise<void> {
    const now = Date.now();
    // Lazy-read from persistent storage on first call after wake.
    if (this._lastTouchCached === null) {
      this._lastTouchCached = (await this.ctx.storage.get<number>(MapCollaboration.TOUCH_STORAGE_KEY)) ?? 0;
    }
    if (now - this._lastTouchCached < MapCollaboration.TOUCH_INTERVAL_MS) return;
    this._lastTouchCached = now;
    await this.ctx.storage.put(MapCollaboration.TOUCH_STORAGE_KEY, now);
    await touchRoom(this._storageContext());
  }

  _roomStatus() {
    return roomStatus(this._storageContext());
  }

  async _setRoomPersistence(persistence: RoomPersistence): Promise<ReturnType<MapCollaboration['_roomStatus']>> {
    return await setRoomPersistence(this._storageContext(), persistence);
  }

  _agentParticipants(now = Date.now()): AgentParticipant[] {
    return this.sql<{
      agent_id: string;
      user_json: string;
      last_seen_at: number;
      expires_at: number;
      last_action: string;
    }>`
      SELECT agent_id, user_json, last_seen_at, expires_at, last_action
      FROM agent_participants
      WHERE expires_at > ${now}
      ORDER BY last_seen_at DESC
    `
      .map((row) => {
        try {
          const user = sanitizeUser(JSON.parse(String(row.user_json)), {
            id: row.agent_id,
            name: 'Agent',
            color: PROFILE_COLORS[7],
          });
          return {
            id: row.agent_id,
            user: { ...user, id: row.agent_id },
            clientType: 'agent' as const,
            active: Number(row.expires_at) > now,
            lastSeenAt: Number(row.last_seen_at),
            expiresAt: Number(row.expires_at),
            lastAction: String(row.last_action || 'connect'),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  _pruneAgentParticipants(now = Date.now()): void {
    void this.sql`
      DELETE FROM agent_participants
      WHERE expires_at <= ${now}
    `;
  }

  _touchAgentParticipant(user: UserProfile, action = 'connect', now = Date.now()): AgentParticipant | null {
    const agentId = sanitizePeerId(user.id);
    if (!agentId) return null;
    const existing = this.sql<{ last_seen_at: number; expires_at: number }>`
      SELECT last_seen_at, expires_at FROM agent_participants WHERE agent_id = ${agentId} LIMIT 1
    `[0];
    const expiresAt = now + AGENT_RECENT_TTL_MS;
    const lastAction = sanitizeAction(action);
    const shouldWrite =
      !existing || now - Number(existing.last_seen_at) >= AGENT_TOUCH_THROTTLE_MS || lastAction !== 'connect';
    if (shouldWrite) {
      const storedUser = {
        id: agentId,
        name: sanitizeText(user.name, 'Agent', 32),
        color: sanitizeColor(user.color, PROFILE_COLORS[7]),
        avatarUrl: user.avatarUrl || null,
      };
      void this.sql`
        INSERT OR REPLACE INTO agent_participants (agent_id, user_json, last_seen_at, expires_at, last_action)
        VALUES (${agentId}, ${JSON.stringify(storedUser)}, ${now}, ${expiresAt}, ${lastAction})
      `;
      const participant = {
        id: agentId,
        user: storedUser,
        clientType: 'agent' as const,
        active: true,
        lastSeenAt: now,
        expiresAt,
        lastAction,
      };
      this.broadcast(
        encodeMessage({
          type: 'agent:participant:update',
          agent: participant,
        }),
        undefined,
      );
      return participant;
    }
    return {
      id: agentId,
      user,
      clientType: 'agent',
      active: Number(existing.expires_at) > now,
      lastSeenAt: Number(existing.last_seen_at),
      expiresAt: Number(existing.expires_at),
      lastAction,
    };
  }

  _ensureDefaultAnnotationLayer(): void {
    ensureDefaultAnnotationLayer(this._storageContext());
  }

  _upsertLayerRow(layer: Layer): void {
    upsertLayerRow(this._storageContext(), layer);
  }

  _layerFromRow(row: {
    layer_id: string;
    kind: string;
    name: string;
    visible: number;
    sort_key: string;
    payload_json: string;
    revision: number;
    created_at: number;
    updated_at: number;
    updated_by: string | null;
  }): Layer | null {
    return layerFromRow(row);
  }

  _listLayers(): Layer[] {
    return listLayers(this._storageContext());
  }

  _getLayer(layerId: string): Layer | null {
    return getLayer(this._storageContext(), layerId);
  }

  _annotationFeatureFromRow(row: {
    feature_id: string;
    layer_id: string;
    feature_type: string;
    feature_json: string;
    sort_key: string;
    revision: number;
    created_at: number;
    updated_at: number;
    updated_by: string;
  }): AnnotationFeature | null {
    return annotationFeatureFromRow(row);
  }

  _listAnnotationFeatures(layerId?: string): AnnotationFeature[] {
    return listAnnotationFeatures(this._storageContext(), layerId);
  }

  _getAnnotationFeature(featureId: string): AnnotationFeature | null {
    return getAnnotationFeature(this._storageContext(), featureId);
  }

  _upsertAnnotationFeatureRow(feature: AnnotationFeature): void {
    upsertAnnotationFeatureRow(this._storageContext(), feature);
  }

  _getFileContent(contentHash: string): ArrayBuffer | null {
    return getFileContent(this._storageContext(), contentHash);
  }

  _pruneUnreferencedFileContent({ immediate = false }: { immediate?: boolean } = {}): void {
    pruneUnreferencedFileContent(this._storageContext(), { immediate });
  }

  async onStart(): Promise<void> {
    await this._ensureLayerStorage();
  }

  async onConnect(connection: Connection<PeerState>, { request }: ConnectionContext): Promise<void> {
    const auth = await this._verifyAuthHeaders(request);
    await this._touchRoom();
    const url = new URL(request.url);
    const clientType = sanitizeClientType(url.searchParams.get('clientType'));
    const presenceVisible = clientType === 'human' && url.searchParams.get('headless') !== 'true';
    const color = sanitizeColor(
      url.searchParams.get('color'),
      PROFILE_COLORS[
        Math.abs(connection.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % PROFILE_COLORS.length
      ],
    );
    const user = {
      id: auth?.clientId || sanitizeText(url.searchParams.get('userId'), connection.id, 80),
      name: sanitizeText(auth?.displayName || url.searchParams.get('name'), `Guest ${connection.id.slice(0, 4)}`, 32),
      color,
      avatarUrl: auth?.avatarUrl || null,
    };
    const agent = clientType === 'agent' ? this._touchAgentParticipant(user, 'connect') : null;

    connection.setState({
      user,
      auth: auth || undefined,
      clientType,
      presenceVisible,
      viewport: null,
      cursor: { visible: false, lngLat: null },
      location: emptyLocation(),
      followingId: null,
      viewState: { terrain: false, satellite: false },
      updatedAt: Date.now(),
    });

    const peers = [...this.getConnections<PeerState>()]
      .filter((peer) => peer.id !== connection.id)
      .map(publicPeer)
      .filter(Boolean);

    connection.send(
      encodeMessage({
        type: 'presence:init',
        id: connection.id,
        room: this.name,
        roomStatus: this._roomStatus(),
        peers,
        agents: this._agentParticipants(),
      }),
    );

    connection.send(encodeMessage({ type: 'room:status', ...this._roomStatus() }));

    connection.send(
      encodeMessage({
        type: 'layer:list',
        layers: this._listLayers(),
      }),
    );
    connection.send(
      encodeMessage({
        type: 'annotation-feature:list',
        features: this._listAnnotationFeatures(),
      }),
    );

    if (presenceVisible) {
      this.broadcast(
        encodeMessage({
          type: 'presence:join',
          peer: publicPeer(connection),
        }),
        [connection.id],
      );
    } else if (agent) {
      connection.send(
        encodeMessage({
          type: 'agent:participant:update',
          agent,
        }),
      );
    }
  }

  async onMessage(connection: Connection<PeerState>, message: WSMessage): Promise<void> {
    await this._touchRoom();
    await handleRoomSocketMessage(this._messageContext(), connection, message);
  }

  onClose(connection: Connection<PeerState>): void {
    if (connection.state?.presenceVisible === false || connection.state?.clientType !== 'human') return;
    this.broadcast(encodeMessage({ type: 'presence:leave', id: connection.id }));
  }

  onError(connection: Connection<PeerState>): void {
    this.broadcast(
      encodeMessage({
        type: 'presence:leave',
        id: connection.id,
      }),
    );
  }

  async onRequest(request: Request): Promise<Response> {
    return handleRoomControlRequest(this, request);
  }

  async onAlarm(): Promise<void> {
    await this._ensureLayerStorage();
    const room = this.sql<{ persistence: RoomPersistence; expires_at: number | null }>`
      SELECT persistence, expires_at FROM room_meta WHERE room_id = ${this.name} LIMIT 1
    `[0];
    if (!room || room.persistence === 'persistent') return;
    if (room.expires_at && Number(room.expires_at) > Date.now()) {
      this._pruneAgentParticipants();
      await this.ctx.storage.setAlarm(Number(room.expires_at) + 60_000);
      return;
    }
    void this.sql`DELETE FROM layers`;
    void this.sql`DELETE FROM annotation_features`;
    void this.sql`DELETE FROM file_contents`;
    void this.sql`DELETE FROM agent_participants`;
    void this.sql`DELETE FROM room_meta WHERE room_id = ${this.name}`;
  }
}
