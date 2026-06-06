import { canGrantRole, effectiveRoomRole, type LinkAccess, type RoomRole } from './room-permissions.js';

type RoomPersistence = 'ephemeral' | 'persistent';
type CreatedByKind = 'guest' | 'user';

interface RoomAccessRow {
  owner_user_id: string | null;
  created_by_kind: CreatedByKind;
  persistence: RoomPersistence;
  link_access: LinkAccess;
  grant_role: RoomRole | null;
}

export interface EffectiveRoomAccess {
  roomId: string;
  userId: string | null;
  role: RoomRole | 'none';
  isOwner: boolean;
  ownerUserId: string | null;
  createdByKind: CreatedByKind;
  persistence: RoomPersistence;
  linkAccess: LinkAccess;
  grantRole: RoomRole | null;
}

export interface RoomRegistryInput {
  roomId: string;
  title?: string | null;
  ownerUserId?: string | null;
  createdByKind: CreatedByKind;
  createdByGuestId?: string | null;
  persistence: RoomPersistence;
  linkAccess: LinkAccess;
  now?: number;
}

export interface RoomSummary {
  roomId: string;
  title: string | null;
  ownerUserId: string | null;
  createdByKind: CreatedByKind;
  persistence: RoomPersistence;
  linkAccess: LinkAccess;
  updatedAt: number;
  lastActiveAt: number;
}

export interface RoomUpdateInput {
  roomId: string;
  actorUserId: string;
  title?: string | null;
  linkAccess?: LinkAccess;
  now?: number;
}

export interface GrantInput {
  roomId: string;
  targetUserId: string;
  targetRole: RoomRole;
  actorUserId: string;
  now?: number;
}

export interface PendingGrantInput {
  roomId: string;
  githubId: string;
  githubLogin: string;
  targetRole: RoomRole;
  actorUserId: string;
  now?: number;
}

export interface ClaimedPendingGrant {
  roomId: string;
  role: RoomRole;
}

export interface RoomGrantMember {
  roomId: string;
  userId: string;
  role: RoomRole;
  grantedByUserId: string;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
  updatedAt: number;
}

export interface UserIdentity {
  userId: string;
  githubId: string;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface RoomAccessSnapshot {
  ownerUserId: string | null;
  linkAccess: LinkAccess;
  grantsByUserId: Map<string, RoomRole>;
}

interface GrantRoleRow {
  role: RoomRole | null;
}

interface RoomAccessSnapshotRow {
  owner_user_id: string | null;
  link_access: LinkAccess;
}

interface RoomAccessSnapshotGrantRow {
  user_id: string;
  role: RoomRole;
}

interface RoomOwnerRow {
  owner_user_id: string | null;
}

interface RoomSummaryRow {
  roomId: string;
  title: string | null;
  ownerUserId: string | null;
  createdByKind: CreatedByKind;
  persistence: RoomPersistence;
  linkAccess: LinkAccess;
  updatedAt: number;
  lastActiveAt: number;
}

function nowMs(now?: number): number {
  return typeof now === 'number' ? now : Date.now();
}

function normalizeLinkAccess(value: unknown): LinkAccess {
  return value === 'view' || value === 'edit' ? value : 'restricted';
}

function normalizeRole(value: unknown): RoomRole | null {
  return value === 'view' || value === 'edit' || value === 'manage' ? value : null;
}

export async function getEffectiveRoomAccess(
  db: D1Database,
  roomId: string,
  userId: string | null,
): Promise<EffectiveRoomAccess | null> {
  const row = userId
    ? await db
        .prepare(
          `
          SELECT
            rooms.owner_user_id,
            rooms.created_by_kind,
            rooms.persistence,
            rooms.link_access,
            room_grants.role AS grant_role
          FROM rooms
          LEFT JOIN room_grants ON room_grants.room_id = rooms.room_id AND room_grants.user_id = ?2
          WHERE rooms.room_id = ?1 AND rooms.archived_at IS NULL
          LIMIT 1
        `,
        )
        .bind(roomId, userId)
        .first<RoomAccessRow>()
    : await db
        .prepare(
          `
          SELECT
            rooms.owner_user_id,
            rooms.created_by_kind,
            rooms.persistence,
            rooms.link_access,
            NULL AS grant_role
          FROM rooms
          WHERE rooms.room_id = ?1 AND rooms.archived_at IS NULL
          LIMIT 1
        `,
        )
        .bind(roomId)
        .first<RoomAccessRow>();

  if (!row) return null;

  const linkAccess = normalizeLinkAccess(row.link_access);
  const grantRole = normalizeRole(row.grant_role);
  const isOwner = Boolean(userId && row.owner_user_id === userId);

  return {
    roomId,
    userId,
    role: effectiveRoomRole({ isOwner, grantRole, linkAccess }),
    isOwner,
    ownerUserId: row.owner_user_id,
    createdByKind: row.created_by_kind || (row.owner_user_id ? 'user' : 'guest'),
    persistence: row.persistence || (row.owner_user_id ? 'persistent' : 'ephemeral'),
    linkAccess,
    grantRole,
  };
}

export async function getRoomAccessSnapshot(db: D1Database, roomId: string): Promise<RoomAccessSnapshot | null> {
  const room = await db
    .prepare(
      `
      SELECT owner_user_id, link_access
      FROM rooms
      WHERE room_id = ?1 AND archived_at IS NULL
      LIMIT 1
    `,
    )
    .bind(roomId)
    .first<RoomAccessSnapshotRow>();

  if (!room) return null;

  const grants = await db
    .prepare(
      `
      SELECT user_id, role
      FROM room_grants
      WHERE room_id = ?1
    `,
    )
    .bind(roomId)
    .all<RoomAccessSnapshotGrantRow>();

  const grantsByUserId = new Map<string, RoomRole>();
  for (const grant of grants.results || []) {
    const role = normalizeRole(grant.role);
    if (grant.user_id && role) grantsByUserId.set(grant.user_id, role);
  }

  return {
    ownerUserId: room.owner_user_id,
    linkAccess: normalizeLinkAccess(room.link_access),
    grantsByUserId,
  };
}

export async function ensureRoomRegistry(db: D1Database, input: RoomRegistryInput): Promise<void> {
  const now = nowMs(input.now);
  await db
    .prepare(
      `
      INSERT INTO rooms (
        room_id, title, owner_user_id, created_by_kind, created_by_guest_id,
        created_at, updated_at, last_active_at, persistence, link_access
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, ?7, ?8)
      ON CONFLICT(room_id) DO UPDATE SET
        last_active_at = excluded.last_active_at,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      input.roomId,
      input.title || null,
      input.ownerUserId || null,
      input.createdByKind,
      input.createdByGuestId || null,
      now,
      input.persistence,
      input.linkAccess,
    )
    .run();
}

export async function createRoomRegistry(db: D1Database, input: RoomRegistryInput): Promise<RoomSummary> {
  await ensureRoomRegistry(db, input);
  const room = await getRoomSummary(db, input.roomId);
  if (!room) throw new Error('Room not found');
  return room;
}

export async function getRoomSummary(db: D1Database, roomId: string): Promise<RoomSummary | null> {
  const row = await db
    .prepare(
      `
      SELECT
        room_id AS roomId,
        title,
        owner_user_id AS ownerUserId,
        created_by_kind AS createdByKind,
        persistence,
        link_access AS linkAccess,
        updated_at AS updatedAt,
        last_active_at AS lastActiveAt
      FROM rooms
      WHERE room_id = ?1 AND archived_at IS NULL
      LIMIT 1
    `,
    )
    .bind(roomId)
    .first<RoomSummaryRow>();
  return row || null;
}

export async function updateRoomMetadata(db: D1Database, input: RoomUpdateInput): Promise<RoomSummary> {
  const actor = await getEffectiveRoomAccess(db, input.roomId, input.actorUserId);
  if (!actor || actor.role !== 'manage') throw new Error('Forbidden room update');

  const existing = await getRoomSummary(db, input.roomId);
  if (!existing) throw new Error('Room not found');

  const now = nowMs(input.now);
  const title = input.title !== undefined ? input.title : existing.title;
  const linkAccess = input.linkAccess || existing.linkAccess;
  await db
    .prepare(
      `
      UPDATE rooms
      SET title = ?2, link_access = ?3, updated_at = ?4
      WHERE room_id = ?1 AND archived_at IS NULL
    `,
    )
    .bind(input.roomId, title || null, linkAccess, now)
    .run();

  const room = await getRoomSummary(db, input.roomId);
  if (!room) throw new Error('Room not found');
  return room;
}

export async function claimGuestRoom(
  db: D1Database,
  roomId: string,
  actorUserId: string,
  now: number = Date.now(),
): Promise<RoomSummary> {
  const existing = await getRoomSummary(db, roomId);
  if (!existing) throw new Error('Room not found');
  if (existing.ownerUserId && existing.ownerUserId !== actorUserId) throw new Error('Room already owned');

  await db
    .prepare(
      `
      UPDATE rooms
      SET
        owner_user_id = ?2,
        created_by_kind = 'user',
        persistence = 'persistent',
        updated_at = ?3,
        last_active_at = ?3
      WHERE room_id = ?1 AND archived_at IS NULL
    `,
    )
    .bind(roomId, actorUserId, now)
    .run();

  const room = await getRoomSummary(db, roomId);
  if (!room) throw new Error('Room not found');
  return room;
}

export async function upsertRoomGrant(db: D1Database, input: GrantInput): Promise<void> {
  const actor = await getEffectiveRoomAccess(db, input.roomId, input.actorUserId);
  if (!actor || !canGrantRole({ actorIsOwner: actor.isOwner, actorRole: actor.role, targetRole: input.targetRole })) {
    throw new Error('Forbidden grant');
  }

  const now = nowMs(input.now);
  await db
    .prepare(
      `
      INSERT INTO room_grants (room_id, user_id, role, granted_by_user_id, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(room_id, user_id) DO UPDATE SET
        role = excluded.role,
        granted_by_user_id = excluded.granted_by_user_id,
        updated_at = excluded.updated_at
    `,
    )
    .bind(input.roomId, input.targetUserId, input.targetRole, input.actorUserId, now)
    .run();
}

export async function listRoomGrants(db: D1Database, roomId: string, actorUserId: string): Promise<RoomGrantMember[]> {
  const actor = await getEffectiveRoomAccess(db, roomId, actorUserId);
  if (!actor || actor.role !== 'manage') throw new Error('Forbidden grant');

  const result = await db
    .prepare(
      `
      SELECT
        room_grants.room_id AS roomId,
        room_grants.user_id AS userId,
        room_grants.role AS role,
        room_grants.granted_by_user_id AS grantedByUserId,
        users.github_login AS githubLogin,
        users.display_name AS displayName,
        users.avatar_url AS avatarUrl,
        room_grants.updated_at AS updatedAt
      FROM room_grants
      JOIN users ON users.user_id = room_grants.user_id
      WHERE room_grants.room_id = ?1
      ORDER BY room_grants.updated_at DESC
    `,
    )
    .bind(roomId)
    .all<RoomGrantMember>();
  return result.results || [];
}

export async function getUserByGithubLogin(db: D1Database, githubLogin: string): Promise<UserIdentity | null> {
  const row = await db
    .prepare(
      `
      SELECT
        user_id AS userId,
        github_id AS githubId,
        github_login AS githubLogin,
        display_name AS displayName,
        avatar_url AS avatarUrl
      FROM users
      WHERE lower(github_login) = lower(?1)
      LIMIT 1
    `,
    )
    .bind(githubLogin)
    .first<UserIdentity>();
  return row || null;
}

export async function removeRoomGrant(
  db: D1Database,
  roomId: string,
  targetUserId: string,
  actorUserId: string,
): Promise<void> {
  const actor = await getEffectiveRoomAccess(db, roomId, actorUserId);
  if (!actor || actor.role !== 'manage') throw new Error('Forbidden grant');

  const room = await db
    .prepare(`SELECT owner_user_id FROM rooms WHERE room_id = ?1 AND archived_at IS NULL LIMIT 1`)
    .bind(roomId)
    .first<RoomOwnerRow>();
  if (!room) throw new Error('Room not found');
  if (room.owner_user_id === targetUserId) throw new Error('Cannot remove owner');

  const target = await db
    .prepare(`SELECT role FROM room_grants WHERE room_id = ?1 AND user_id = ?2 LIMIT 1`)
    .bind(roomId, targetUserId)
    .first<GrantRoleRow>();
  const targetRole = normalizeRole(target?.role);
  if (targetRole === 'manage' && !actor.isOwner) throw new Error('Forbidden grant');

  await db.prepare(`DELETE FROM room_grants WHERE room_id = ?1 AND user_id = ?2`).bind(roomId, targetUserId).run();
}

export async function upsertPendingRoomGrant(db: D1Database, input: PendingGrantInput): Promise<void> {
  if (!input.githubId.trim()) throw new Error('Pending grants require immutable github_id');

  const actor = await getEffectiveRoomAccess(db, input.roomId, input.actorUserId);
  if (!actor || !canGrantRole({ actorIsOwner: actor.isOwner, actorRole: actor.role, targetRole: input.targetRole })) {
    throw new Error('Forbidden grant');
  }

  const now = nowMs(input.now);
  await db
    .prepare(
      `
      INSERT INTO pending_room_grants (room_id, github_id, github_login, role, granted_by_user_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(room_id, github_id) DO UPDATE SET
        github_login = excluded.github_login,
        role = excluded.role,
        granted_by_user_id = excluded.granted_by_user_id
    `,
    )
    .bind(input.roomId, input.githubId, input.githubLogin, input.targetRole, input.actorUserId, now)
    .run();
}

export async function claimPendingRoomGrants(
  db: D1Database,
  userId: string,
  githubId: string,
  now: number = Date.now(),
): Promise<ClaimedPendingGrant[]> {
  const pending = await db
    .prepare(
      `
      SELECT room_id AS roomId, role
      FROM pending_room_grants
      WHERE github_id = ?1 AND claimed_at IS NULL
    `,
    )
    .bind(githubId)
    .all<ClaimedPendingGrant>();

  const rows = pending.results || [];
  for (const row of rows) {
    const role = normalizeRole(row.role);
    if (!role) continue;
    await db
      .prepare(
        `
        INSERT INTO room_grants (room_id, user_id, role, granted_by_user_id, created_at, updated_at)
        SELECT room_id, ?2, role, granted_by_user_id, ?3, ?3
        FROM pending_room_grants
        WHERE room_id = ?1 AND github_id = ?4 AND claimed_at IS NULL
        ON CONFLICT(room_id, user_id) DO UPDATE SET
          role = excluded.role,
          granted_by_user_id = excluded.granted_by_user_id,
          updated_at = excluded.updated_at
      `,
      )
      .bind(row.roomId, userId, now, githubId)
      .run();
    await db
      .prepare(
        `
        UPDATE pending_room_grants
        SET claimed_at = ?3
        WHERE room_id = ?1 AND github_id = ?2 AND claimed_at IS NULL
      `,
      )
      .bind(row.roomId, githubId, now)
      .run();
  }

  return rows
    .map((row) => ({ roomId: row.roomId, role: normalizeRole(row.role) }))
    .filter((row): row is ClaimedPendingGrant => Boolean(row.role));
}
