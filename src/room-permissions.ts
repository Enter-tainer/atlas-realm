export type RoomRole = 'view' | 'edit' | 'manage';
export type LinkAccess = 'restricted' | 'view' | 'edit';

export const ROOM_ROLE_WEIGHT: Record<RoomRole | 'none', number> = {
  none: 0,
  view: 1,
  edit: 2,
  manage: 3,
};

const ROLES_BY_WEIGHT = ['none', 'view', 'edit', 'manage'] as const;

export function roleWeight(role: RoomRole | 'none' | null | undefined): number {
  return ROOM_ROLE_WEIGHT[role || 'none'];
}

export function roleFromWeight(weight: number): RoomRole | 'none' {
  return ROLES_BY_WEIGHT[Math.max(0, Math.min(3, Math.floor(weight)))] || 'none';
}

export function linkAccessRole(linkAccess: LinkAccess): RoomRole | 'none' {
  if (linkAccess === 'edit') return 'edit';
  if (linkAccess === 'view') return 'view';
  return 'none';
}

export function effectiveRoomRole({
  isOwner = false,
  grantRole = null,
  linkAccess = 'restricted',
}: {
  isOwner?: boolean;
  grantRole?: RoomRole | null;
  linkAccess?: LinkAccess;
}): RoomRole | 'none' {
  return roleFromWeight(
    Math.max(roleWeight(isOwner ? 'manage' : 'none'), roleWeight(grantRole), roleWeight(linkAccessRole(linkAccess))),
  );
}

export function canView(role: RoomRole | 'none' | null | undefined): boolean {
  return roleWeight(role) >= ROOM_ROLE_WEIGHT.view;
}

export function canEdit(role: RoomRole | 'none' | null | undefined): boolean {
  return roleWeight(role) >= ROOM_ROLE_WEIGHT.edit;
}

export function canManage(role: RoomRole | 'none' | null | undefined): boolean {
  return roleWeight(role) >= ROOM_ROLE_WEIGHT.manage;
}

export function canGrantRole({
  actorIsOwner,
  actorRole,
  targetRole,
}: {
  actorIsOwner: boolean;
  actorRole: RoomRole | 'none';
  targetRole: RoomRole;
}): boolean {
  if (targetRole === 'manage') return actorIsOwner;
  return actorIsOwner || canManage(actorRole);
}

export const ACCOUNT_ROOM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_github_login_idx ON users(github_login);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  title TEXT,
  owner_user_id TEXT,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('guest', 'user')),
  created_by_guest_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  persistence TEXT NOT NULL CHECK (persistence IN ('ephemeral', 'persistent')),
  link_access TEXT NOT NULL CHECK (link_access IN ('restricted', 'view', 'edit')),
  archived_at INTEGER,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS rooms_owner_idx ON rooms(owner_user_id, updated_at);
CREATE INDEX IF NOT EXISTS rooms_activity_idx ON rooms(last_active_at);

CREATE TABLE IF NOT EXISTS room_grants (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit', 'manage')),
  granted_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(room_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (granted_by_user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS room_grants_user_idx ON room_grants(user_id, updated_at);

CREATE TABLE IF NOT EXISTS pending_room_grants (
  room_id TEXT NOT NULL,
  github_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit', 'manage')),
  granted_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (room_id, github_id),
  FOREIGN KEY (room_id) REFERENCES rooms(room_id),
  FOREIGN KEY (granted_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS oauth_device_flows (
  flow_id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_uri TEXT NOT NULL,
  verification_uri_complete TEXT,
  token_name TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_poll_at INTEGER,
  completed_at INTEGER,
  access_token_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'denied', 'expired')),
  FOREIGN KEY (access_token_id) REFERENCES access_tokens(token_id)
);

CREATE INDEX IF NOT EXISTS oauth_device_flows_expiry_idx ON oauth_device_flows(expires_at);
`.trim();
