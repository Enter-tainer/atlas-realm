# Account And Room Permission Design

## Goals

Add GitHub-based accounts and document-style room sharing without losing the current low-friction guest flow.

The target behavior is:

- Guests can create and use rooms without signing in.
- Guest-owned rooms stay ephemeral and are automatically cleaned after inactivity.
- Signed-in users can create rooms that are retained permanently by default.
- A room can be shared like an online document, with a general link-access mode plus per-user roles.
- Room permissions use three roles: `view`, `edit`, and `manage`.
- Users with `manage` access can grant and revoke access, change link-sharing mode, and manage room metadata.
- Existing agent and CLI workflows can continue to work, but mutations must eventually use explicit write authorization.

## Current State

Room state lives inside the `MapCollaboration` Durable Object, keyed by room name. The object stores room-local SQLite tables:

- `room_meta`
- `layers`
- `annotation_features`
- `file_contents`
- `agent_participants`

Room lifetime is currently controlled by `room_meta.persistence`:

- `ephemeral`: `expires_at = last activity + 24h`; the DO alarm clears room tables after expiry.
- `persistent`: `expires_at = null`; the DO alarm skips cleanup.

Connections currently identify users with local browser-generated profile ids or agent query parameters. These ids are useful for presence but are not trustworthy for authorization.

## Recommended Architecture

Use two levels of storage:

1. Global account and room registry in a Cloudflare D1 database.
2. Existing per-room Durable Object SQLite for live collaboration state.

The Durable Object should remain the live collaboration authority for room content, ordering, presence, and binary file payloads. D1 should become the authority for identity, room ownership, room share policy, explicit grants, sessions, and automation tokens.

This split keeps hot collaboration operations local to the room DO, while making cross-room account operations queryable:

- "My rooms"
- "Rooms shared with me"
- "Who has access to this room?"
- "Resolve this GitHub user and grant edit access"

## Identity And Connection Identity

Keep permission identity separate from connection identity.

Permission checks use stable account identity:

- `user_id`: authenticated user id from session cookie or PAT.
- `role`: effective room role derived from owner, grants, and link access.

Presence, cursors, viewport sync, following, transient locks, and UI rendering use connection identity:

- `client_id`: stable browser tab/session or CLI process id.
- `connection_id`: PartyKit/Durable Object connection id for the current WebSocket connection.
- `agent_session_id`: optional agent-specific client id, useful when a user runs multiple agents.

Do not use `user_id` as the unique key for live presence. A user can have a browser tab and one or more agents connected to the same room at the same time. If live state is keyed by `user_id`, their browser viewport and agent activity can overwrite each other, causing cursor flicker, incorrect following behavior, or accidental connection replacement.

The current implementation already partially follows this shape:

- Browser clients create a `sessionStorage` client id and pass it to PartySocket as `_pk`.
- The server broadcasts presence by `connection.id`.
- The browser stores peers in a `Map` keyed by peer id.
- The separate local profile `userId` is only a display/profile id today, not a trusted permission id.

The account system should preserve this split and make it explicit:

```text
user_id = permission and audit subject
client_id / connection_id = live collaboration subject
agent_id / agent_session_id = agent instance label and recent-agent subject
```

Durable audit rows can store both layers:

```text
updated_by_user_id
updated_by_client_id
updated_by_agent_id
```

## Authentication

Use GitHub OAuth App web application flow.

Recommended endpoints:

- `GET /api/auth/github/start`
- `GET /api/auth/github/callback`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Flow:

1. Client opens `/api/auth/github/start?returnTo=<current-url>`.
2. Worker generates a random `state`, stores it in a short-lived, HttpOnly, Secure cookie, and redirects to `https://github.com/login/oauth/authorize`.
3. GitHub redirects back with `code` and `state`.
4. Worker validates `state`.
5. Worker exchanges `code` for an access token server-side using `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
6. Worker fetches the GitHub user profile.
7. Worker upserts a local `users` row.
8. Worker creates an application session and sets an HttpOnly, Secure, SameSite=Lax session cookie.
9. Worker redirects to `returnTo`.

The app only needs identity, so request minimal scope. Start with no extra scopes and rely on GitHub's public user identity. If email is required later, add `user:email` and handle private email addresses explicitly.

Do not expose GitHub access tokens to the browser. Store only what is needed for login and profile display. If future GitHub API calls are not needed after login, do not persist the OAuth access token; use it once to fetch the profile and discard it.

## Identity Model

Use an internal immutable user id rather than GitHub login as the primary key. GitHub usernames can change.

Suggested global D1 tables:

```sql
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE INDEX users_github_login_idx ON users(github_login);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at);
```

Session cookies should contain an opaque random session id, not user data. Store a hash of `session_id` instead of the raw value if we want database compromise resistance.

## Room Ownership And Sharing Model

Add a global room registry. Every room gets a registry row the first time it is created or touched under the new system.

```sql
CREATE TABLE rooms (
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

CREATE INDEX rooms_owner_idx ON rooms(owner_user_id, updated_at);
CREATE INDEX rooms_activity_idx ON rooms(last_active_at);
```

Policy interpretation:

- `link_access = 'restricted'`: only owner or explicitly granted users can open the room.
- `link_access = 'view'`: anyone with the room URL can view; editing and managing require explicit roles.
- `link_access = 'edit'`: anyone with the room URL can view and edit; managing still requires explicit `manage` access.

Invariant:

- Owners always have `manage` access.
- `manage` implies `edit`; `edit` implies `view`.
- Guests cannot own persistent rooms unless they later claim the room by signing in.

Default room creation:

- Guest-created room:
  - `created_by_kind = 'guest'`
  - `owner_user_id = null`
  - `persistence = 'ephemeral'`
  - `link_access = 'edit'`
- Signed-in-created room:
  - `created_by_kind = 'user'`
  - `owner_user_id = current user`
  - `persistence = 'persistent'`
  - Recommended initial sharing: `link_access = 'restricted'`

The initial sharing default for signed-in rooms is the main product decision. Restricted-by-default is safer and matches private document expectations. Public-by-link is lower friction, but accidental exposure is harder to undo.

This model maps more cleanly to online document sharing than separate public/restricted booleans for view and edit. The room has one general access setting, and named members can have a higher or lower explicit role.

## Explicit Grants

Use room grants for named users.

```sql
CREATE TABLE room_grants (
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

CREATE INDEX room_grants_user_idx ON room_grants(user_id, updated_at);
```

Roles:

- `view`: can connect, read room state, presence, layers, annotations, and file contents.
- `edit`: includes `view`; can mutate layers, annotations, file contents, room view state if that becomes durable, and presence-affecting write operations.
- `manage`: includes `edit`; can change room sharing, grant/revoke access, and rename/archive room.
- `owner`: stored on `rooms.owner_user_id`, not duplicated as a grant. Owners always have effective `manage`.

V1 manager boundary:

- Only the owner can grant or revoke `manage`.
- Users with `manage` can grant and revoke `view` and `edit`.
- Users with `manage` cannot remove or downgrade the owner.

This keeps access administration bounded until there is a full audit log and ownership-transfer model.

Do not add a separate `commenter` role until there is an actual comment-only feature. It adds UI and enforcement complexity without current value.

## Granting Access To A Person

There are two practical cases.

For users who have already signed in:

- A user with `manage` access enters a GitHub username.
- Server looks up local `users.github_login`.
- Server creates or updates `room_grants`.

For users who have not signed in yet:

- A user with `manage` access enters a GitHub username.
- Server must call GitHub's public user API at grant time and resolve the username to immutable `github_id`.
- Store the pending grant by `github_id`. Keep `github_login` only as display and audit metadata.
- When that person signs in, attach pending grants only when the authenticated GitHub account's immutable id matches `github_id`.

Do not grant pending access by matching only `github_login`. GitHub usernames can be renamed and later claimed by another account, so login-only pending grants create a time-of-check-to-time-of-use authorization bug. This is especially dangerous for `manage` grants because a renamed or squatted username could inherit room administration.

Suggested pending table:

```sql
CREATE TABLE pending_room_grants (
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
```

## Share Links

Use link sharing plus named grants in v1. Do not add separate invite links yet.

The reason to avoid invite links for v1 is product ambiguity:

- Single-use links are safer but awkward for sharing with a group.
- Multi-use links overlap heavily with "anyone with link can view/edit".
- Role-granting invite links raise the question of who can create them and how they are revoked.
- They add token storage, expiry, use counting, and token leak handling before the core account model is proven.

The normal room URL is enough for the first document-style model:

- `restricted`: signed-in explicit members only.
- `view`: anyone with the URL can view.
- `edit`: anyone with the URL can view and edit.

If we later need invite links, they should be designed as a separate feature after we know whether the product needs single-use acceptance, team sharing, or anonymous link access.

## Permission Evaluation

Effective access must use highest-privilege-wins semantics, not first-match ordering. Multiple access sources can apply to the same user at the same time, and the final role is the maximum role weight.

```text
none = 0
view = 1
edit = 2
manage = 3
```

The role ladder is monotonic:

```text
manage > edit > view > none
```

Potential sources:

- Ownership: owner contributes `manage`.
- Explicit grant: `room_grants.role` contributes `view`, `edit`, or `manage`.
- Pending grant after claim: same as explicit grant.
- Link access: `link_access = 'view'` contributes `view`; `link_access = 'edit'` contributes `edit`; `restricted` contributes `none`.

The effective role is:

```text
effective_role = MAX(owner_role, explicit_grant_role, link_access_role)
```

This avoids a subtle but serious policy bug. If a signed-in user has an explicit `view` grant but the room is also `link_access = 'edit'`, the user must still receive `edit`, because anonymous link visitors already have `edit`. Explicit membership cannot reduce below the room's general link access.

Implementation rules:

- Never return early from the first matching access source.
- Collect every applicable source, map each one to a numeric weight, and convert the maximum weight back to the final role.
- Treat a lower explicit grant as a lower-bound membership record, not as a deny.
- Keep deny semantics out of v1. If the product later needs "blocked user even though the link is public", add a separate explicit-deny model with clear UI and tests.

This keeps the policy stable when new access sources are added later, such as ownership transfer, organization membership, or future invite tokens.

Examples:

- Owner + any link access => `manage`.
- Explicit `view` + `link_access = 'edit'` => `edit`.
- Explicit `edit` + `link_access = 'view'` => `edit`.
- No grant + `link_access = 'restricted'` => `none`.

For mutations:

```text
can_edit = effective_role IN ('edit', 'manage')
```

For reads:

```text
can_view = effective_role IN ('view', 'edit', 'manage')
```

For management:

```text
can_manage = effective_role = 'manage'
```

Editors cannot reshare unless they are explicitly granted `manage`. This matches the distinction most online document products make between editing content and administering access.

If we later need explicit deny semantics, model it as a separate `blocked` state with clear UI and tests. Do not overload a low explicit grant as a deny.

## Enforcement Points

Enforce permissions in the Worker before the Durable Object sends or accepts room state.

HTTP routes:

- `/api/auth/*`: session management.
- `/api/rooms`: create/list rooms.
- `/api/rooms/:room`: get/update metadata.
- `/api/rooms/:room/grants`: list/add/update/revoke explicit grants.
- `/api/rooms/:room/access`: return current user's effective role for UI gating.

Grant and link-access mutations must also notify the live room DO. Updating D1 alone is not enough because existing WebSocket connections cache their trusted role in `connection.state`.

WebSocket connect:

1. Parse session cookie.
2. Resolve user, if any.
3. Resolve room access from D1.
4. Reject connection if `can_view` is false.
5. Pass trusted auth context to the Durable Object.

WebSocket message handling:

- Presence and viewport updates require `can_view`.
- Anonymous viewers in public-view rooms should be rate-limited or aggregated before broadcast if the room has many guests.
- Layer and annotation mutations require `can_edit`.
- File content upload requires `can_edit`.
- Room sharing updates require `can_manage` and should be handled by HTTP API rather than ad hoc WebSocket messages.
- `room:update` for persistence should require `manage`. In v1, remove or restrict CLI ability to toggle arbitrary rooms.

Live permission refresh:

1. A manage API changes `room_grants`, owner, or `link_access` in D1.
2. Worker recomputes affected users' effective roles, or marks the entire room for refresh when link access changes.
3. Worker sends a signed internal control request to the room DO.
4. DO iterates active connections:
   - If a connection's `user_id` is affected, update `connection.state.auth.role` to the new effective role.
   - If the new role is `none`, close the connection or mark it unauthorized and require reconnect.
   - If a role is downgraded, subsequent `onMessage` checks must immediately enforce the lower role.
5. DO broadcasts a small access-refresh event to affected clients so the frontend can update read-only/manage UI without waiting for reconnect.

For `link_access` changes, the safest v1 behavior is room-wide refresh: recompute all active connections or close anonymous connections that no longer satisfy `can_view`.

Recommended control payload:

```json
{
  "action": "access-refresh",
  "roomId": "trip",
  "reason": "grant-updated",
  "refresh": {
    "mode": "users",
    "userIds": ["user_..."]
  },
  "issuedAt": 1710000000000
}
```

For grant changes, `refresh.mode = "users"` is enough because only connections for those account users can change. For owner changes or `link_access` changes, use `refresh.mode = "room"` so the DO checks every active connection, including anonymous guests and PAT-authenticated agents.

If the DO is kept decoupled from D1, the Worker should include the post-update effective role for each affected user in the control payload. If the DO is allowed to query D1, it may recompute directly. Pick one source of truth per implementation path; do not let Worker and DO use different role algorithms.

This is a correctness and security requirement, not just a UI sync optimization. The Worker auth gate only evaluates permissions when the WebSocket is created. Without a live refresh path, a downgraded or removed editor would keep the old `edit` role in `connection.state` and could continue sending mutating messages until reconnect.

Permission-changing HTTP APIs must therefore use this commit rule:

1. Persist the grant, ownership, or link-access change in D1.
2. Deliver the signed access-refresh control request to the room DO.
3. Return success only after the DO acknowledges that active connections were refreshed or closed.

If step 2 or 3 fails, the API must fail visibly, for example with `503 access-refresh-failed`, because the durable policy and existing WebSocket permissions may be temporarily inconsistent. V1 should prefer a visible retryable failure over silently leaving a "ghost connection" with stale edit permission.

DO-side handling requirements:

- Store trusted `user_id`, `client_id`, `auth_kind`, and `role` in each connection's state.
- On access refresh, match account-scoped changes by `user_id`, not by `client_id`, so all browser tabs and agent processes for that account are updated.
- If the recomputed role is lower, replace the cached role immediately before processing any further messages from that connection.
- If the recomputed role is `none`, close the connection or mark it unauthorized so all future messages are rejected.
- Every mutating `onMessage` handler must check the current cached role, not the role that was present at initial connect.

Important implementation detail: do not trust `userId`, `name`, `clientType`, or role sent in query parameters. The Worker/DO should derive identity and role from the session cookie and D1 lookup. Agent clients need an equivalent trusted credential; see "Agents And CLI".

## Durable Object And D1 Boundary

The current `routePartykitRequest(request, env, { cors: true })` hands PartyKit requests directly to the DO. To enforce permissions, add an auth gate before routing or use a PartyKit hook that can validate the request and attach context.

Recommended approach:

1. Detect collaboration WebSocket paths before `routePartykitRequest`.
2. Resolve auth and room access in the Worker.
3. If denied, return `401` or `403`.
4. Forward to the DO with signed headers containing:
   - `x-orm-auth-user-id`
   - `x-orm-auth-user-name`
   - `x-orm-auth-user-avatar`
   - `x-orm-room-role`
   - `x-orm-client-id`
   - `x-orm-agent-id`
   - `x-orm-auth-kind`
   - `x-orm-auth-issued-at`
   - `x-orm-auth-signature`
5. DO verifies the signature using a Worker secret before trusting those headers.
6. DO rejects auth headers whose `issued_at` is outside a short clock-skew window, for example 60 seconds.

The signature should cover the fields the DO will trust:

```text
payload = room_id + "\n" + user_id + "\n" + role + "\n" + client_id + "\n" + agent_id + "\n" + auth_kind + "\n" + issued_at
signature = HMAC-SHA256(payload, INTERNAL_AUTH_SECRET)
```

`auth_kind` should be one of `anonymous`, `user`, or `token`. For anonymous browser guests, `agent_id` should be a canonical empty string in the signed payload, and the DO should treat the account user id as `null` when recomputing room access. For human browser connections, `agent_id` should be an empty string. Every field the DO persists into `connection.state.auth` or uses for presence identity should either be signed or derived inside the DO after signature validation.

After validation, the DO stores trusted identity and role in `connection.state`. Later `onMessage` handlers should read from connection state and perform per-message capability checks; they should not re-parse client-supplied identity.

The same internal signing mechanism should protect control requests from the Worker to the DO, such as permission refresh or forced disconnect. Control requests must include `room_id`, action, issued timestamp, and signature. The DO must reject unsigned or stale control requests.

If PartyKit routing makes custom forwarding awkward, an acceptable alternative is for the DO to perform the same D1 lookup during `onConnect`. That is simpler, but it couples every room DO to the global auth schema.

## Room Lifecycle

Lifecycle rules:

- Guest-created rooms remain `ephemeral`.
- Signed-in-created rooms default to `persistent`.
- If a guest signs in while in a guest room, offer "claim this room".
- Claiming a room sets:
  - `owner_user_id = current user`
  - `created_by_kind = 'user'`
  - `persistence = 'persistent'`
  - DO `room_meta.persistence = 'persistent'`
  - DO `room_meta.expires_at = null`

The global `rooms.persistence` and DO `room_meta.persistence` should be kept consistent. D1 is the product metadata source; DO is the cleanup executor for room-local content.

Recommended source-of-truth rule:

- D1 decides intended persistence and ownership.
- DO mirrors persistence locally because its alarm cleanup must run without a global query.

When room metadata changes in D1, send a control message or direct DO call to update local `room_meta`.

## Agents And CLI

The current agent-room CLI identifies through query parameters. That is acceptable for presence identity, but not for write authorization.

Use Personal Access Tokens for automation in v1. Room-scoped tokens are deferred because they require extra lifecycle rules: who can create them, whether managers can revoke them, and what happens when the creator loses access to a room.

Add PAT storage:

```sql
CREATE TABLE access_tokens (
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
```

Token format should make the token type obvious, for example `orm_pat_...`. Store only a hash. The token should authenticate as the owning user, then the normal room access calculation decides whether the agent can view, edit, or manage the room.

CLI usage:

```text
orm-agent-room --host <host> --room <room> --token <token> snapshot --json
orm-agent-room --host <host> --room <room> --token <token> layers add route.geojson --json
```

Agent presence should use the authenticated user's account as the durable identity, plus an agent-specific display suffix. For example:

- `user_id`: authenticated user id from the token.
- `client_id`: unique CLI process/session id used for connection-level presence.
- `agent_id` or `agent_session_id`: unique agent instance id used for recent-agent tracking.
- `display_name`: `GitHub Name / Agent Name` or `GitHub Login / Agent Name`.
- `avatar_url`: GitHub avatar from the user profile.
- `client_type`: `agent`.
- `agent_name`: CLI-provided name, used only as a label.

This keeps audit and permissions tied to a real account, while live UI state stays keyed by connection or agent instance. A browser connection from the same user and an agent connection from that user should render as separate participants, not overwrite each other.

For short-term compatibility, allow unauthenticated CLI access only to rooms with `link_access = 'edit'`.

## Client UI

Minimal v1 UI:

- Top bar account area:
  - Signed out: "Sign in with GitHub" button.
  - Signed in: GitHub avatar, display name or login, account menu, sign out.
- Presence avatars:
  - Signed-in humans use GitHub avatar and profile name.
  - Guests keep generated color/avatar and local guest name.
  - Agents use the authenticated user's avatar with an agent label/badge.
  - Anonymous viewers in `link_access = 'view'` rooms should be aggregated once the count is non-trivial, for example `+42 Guests`, instead of rendering every guest as a full presence item.
- Room title, persistence indicator, and current access role.
- Share dialog with:
  - General access selector: restricted, anyone with link can view, anyone with link can edit.
  - People list with role selector: view/edit/manage/remove.
  - Add by GitHub username.
  - Copy link.
  - No invite-link creation in v1.
- Access-denied screen with sign-in button.
- Read-only mode banner or disabled edit controls when user can view but not edit.
- Claim room prompt for signed-in users in guest-created rooms.
- Manage-only controls:
  - Rename room.
  - Change general access.
  - Add/remove members.
  - Transfer ownership can be deferred; it is not required for v1.

Frontend state should treat access as a server-provided capability object, not reimplement policy from raw fields. `GET /api/rooms/:room/access` can return:

```json
{
  "role": "edit",
  "canView": true,
  "canEdit": true,
  "canManage": false,
  "room": {
    "roomId": "trip",
    "title": "Trip",
    "linkAccess": "view",
    "persistence": "persistent"
  },
  "user": {
    "userId": "user_...",
    "githubLogin": "octocat",
    "displayName": "Octocat",
    "avatarUrl": "https://..."
  }
}
```

The UI should be advisory only. Server-side enforcement is mandatory.

## API Sketch

```text
GET    /api/auth/me
GET    /api/auth/github/start
GET    /api/auth/github/callback
POST   /api/auth/logout

GET    /api/rooms
POST   /api/rooms
GET    /api/rooms/:room
PATCH  /api/rooms/:room
POST   /api/rooms/:room/claim
GET    /api/rooms/:room/access

GET    /api/rooms/:room/grants
PUT    /api/rooms/:room/grants/:githubLogin
DELETE /api/rooms/:room/grants/:userId
POST   /api/rooms/:room/_control/access-refresh

GET    /api/tokens
POST   /api/tokens
DELETE /api/tokens/:tokenId
```

`/_control/*` routes are internal Worker-to-DO routes, not public client APIs. They must require the internal control signature.

`PATCH /api/rooms/:room` should allow users with `manage` access to update:

- `title`
- `link_access`

Persistence changes should be internal product behavior, not a normal shared-room setting, unless we intentionally expose it to owners.

## Migration Plan

1. Add D1 binding and schema migrations for users, sessions, rooms, grants, pending grants, and tokens.
2. Add GitHub OAuth endpoints and `/api/auth/me`.
3. Add room registry creation:
   - On first room connect, create a guest room row if missing.
   - On signed-in room creation, create a user-owned persistent room row.
4. Add access lookup endpoint and UI read-only gating.
5. Enforce `can_view` on WebSocket connect.
6. Enforce `can_edit` on all room mutations.
7. Add share dialog and grants API.
8. Add claim-room flow.
9. Add CLI token authentication.
10. Restrict or remove unauthenticated `room:update --persistence persistent`.

During migration, existing rooms without a D1 row should be treated as guest-created rooms with `link_access = 'edit'` and `persistence = 'ephemeral'` until claimed.

## Deployment Configuration

Production D1 database:

```text
name: orm_accounts
database_id: 13b68cae-3b59-4ae6-b655-9e15843c7551
region: APAC
```

The production database has been created and the initial migration has been applied:

```text
wrangler d1 create orm_accounts
wrangler d1 migrations apply orm_accounts --remote
```

The production Worker binding in `wrangler.jsonc` should stay:

```jsonc
"d1_databases": [
  {
    "binding": "ACCOUNTS_DB",
    "database_name": "orm_accounts",
    "database_id": "13b68cae-3b59-4ae6-b655-9e15843c7551",
    "migrations_dir": "migrations"
  }
]
```

Wrangler does not automatically create this database just because it appears in `wrangler.jsonc`; remote D1 databases must be created explicitly with `wrangler d1 create`, then migrated with `wrangler d1 migrations apply --remote`.

Local development uses a separate local D1 database under `.wrangler/state` by default. It does not read or write production D1 unless explicitly run with remote bindings. Initialize or reset local account tables with:

```text
wrangler d1 migrations apply orm_accounts --local
```

Required Worker secrets:

```text
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put INTERNAL_AUTH_SECRET
```

`INTERNAL_AUTH_SECRET` signs Worker-to-DO auth headers and control requests. Rotating it invalidates in-flight WebSocket auth headers, so active clients should reconnect after rotation.

## Open Decisions

- Signed-in room default sharing: recommended `link_access = restricted`; alternative `link_access = view`.
- Whether users with `manage` can manually set persistence back to ephemeral: No
- Whether public-view guest aggregation should happen entirely in the client or also in DO broadcast payloads. Recommended: aggregate in the DO once guest count crosses a threshold.

## Security Notes

- Use HttpOnly, Secure, SameSite=Lax cookies for sessions.
- Validate OAuth `state`.
- Do not trust client-supplied user ids or roles.
- Never store raw API tokens.
- Keep GitHub OAuth client secret only in Worker secrets.
- Apply permission checks on every write message, not just on connect.
- Return generic `403` for restricted rooms so private room existence is not unnecessarily disclosed.
- Add audit fields (`created_by`, `updated_by`, timestamps) to grants and room metadata changes from the start.

## Test Plan

This feature needs coverage at several layers because the risky behavior is mostly cross-boundary: OAuth creates identity, D1 stores grants, Worker gates connections, DO enforces per-message permissions, and the frontend must not expose edit affordances in read-only contexts.

### Database And Migration Tests

- D1 schema creates all account, session, room, grant, pending grant, and token tables with expected constraints and indexes.
- `users.github_id` is unique and immutable for authorization purposes.
- `room_grants.role` only accepts `view`, `edit`, and `manage`.
- `pending_room_grants.github_id` is required and the primary key includes `(room_id, github_id)`.
- Deleting, revoking, or archiving records does not accidentally remove room content from the DO.
- Existing rooms without D1 rows are backfilled or interpreted as guest-created rooms with `link_access = 'edit'` and `persistence = 'ephemeral'`.

### Authentication Tests

- GitHub OAuth start sets a short-lived state cookie and redirects with the expected minimal scope.
- Callback rejects missing, mismatched, expired, or replayed `state`.
- Callback upserts users by immutable `github_id`, not by login.
- GitHub login rename updates display metadata without changing the local `user_id`.
- Session cookies are HttpOnly, Secure, SameSite=Lax, and contain only opaque session ids.
- Logout revokes the session and clears the cookie.

### Authorization Tests

- Restricted rooms reject anonymous users and signed-in users without grants.
- `link_access = 'view'` allows anonymous read but rejects mutations.
- `link_access = 'edit'` allows anonymous read and edit but rejects manage operations.
- Explicit `view` grants can read but cannot mutate.
- Explicit `edit` grants can mutate layers, annotations, and file contents but cannot change sharing.
- Explicit `manage` grants can add/remove `view` and `edit` grants.
- Effective role uses maximum role weight across owner, explicit grant, and link access.
- A user with explicit `view` in a room with `link_access = 'edit'` receives effective `edit`.
- A user with explicit `edit` in a room with `link_access = 'view'` receives effective `edit`.
- Only owner can grant or revoke `manage`.
- No manager can remove or downgrade the owner.
- `room:update` persistence changes require `manage` or are disabled for normal clients, depending on the final product choice.
- Pending grants are claimed only when authenticated `github_id` matches the stored pending `github_id`; login-only matches must fail.

### Worker To DO Auth-Gate Tests

- Worker rejects unauthorized WebSocket upgrades before routing to the DO.
- Worker signs trusted auth headers with `INTERNAL_AUTH_SECRET`.
- Worker sends signed internal control requests to DO after grant or link-access changes.
- DO accepts valid HMAC signatures inside the allowed timestamp window.
- DO rejects missing signatures, bad signatures, stale `issued_at`, future `issued_at`, room-id mismatch, role tampering, and user-id tampering.
- DO rejects unsigned, stale, or tampered control requests.
- After connect, DO stores trusted `user_id`, role, `client_id`, and agent metadata in `connection.state`.
- `onMessage` permission checks use `connection.state`, not client-supplied identity fields.

### Durable Object Tests

- Ephemeral guest rooms still set alarms and clear room-local tables after expiry.
- Persistent signed-in rooms keep `expires_at = null` and are skipped by `onAlarm`.
- Claiming a guest room switches both D1 room persistence and DO `room_meta.persistence` to `persistent`.
- Per-message authorization covers every mutating message type: layer create/update/delete/reorder, annotation upsert/delete/reorder, file content upload, and room metadata updates.
- Access-refresh control messages downgrade active connections immediately.
- Removing a user's last view source closes that user's active room connections or marks them unauthorized.
- Downgrading an active editor to viewer prevents subsequent mutating messages on the existing WebSocket.
- Changing `link_access` triggers room-wide active-connection access refresh.
- Presence, cursor, viewport, following, and transient locks are keyed by `client_id` or `connection.id`, not `user_id`.
- A browser connection and an agent connection for the same `user_id` render and update independently.
- Anonymous public-view guests are aggregated or rate-limited once the chosen threshold is exceeded.

### Frontend Tests

- Signed-out users see GitHub sign-in and guest identity.
- Signed-in users see GitHub avatar, display name or login, and sign-out.
- Access-denied rooms show a sign-in path without leaking private room details.
- `view` users can inspect layers and annotations but edit controls are hidden or disabled.
- `edit` users can use editing workflows but cannot open manage-only sharing controls.
- `manage` users can open the share dialog, change link access, and add/remove grants allowed by v1 rules.
- Share dialog presents exactly three general-access states: restricted, anyone with link can view, anyone with link can edit.
- Adding a GitHub username shows pending state when the user has not signed in, backed by immutable `github_id`.
- Browser user and their agent show as separate presence participants.
- Large anonymous viewer counts are displayed as an aggregate instead of a long participant list.

### CLI And Agent Tests

- CLI can authenticate with a PAT and connect as `client_type = agent`.
- PAT is stored and sent securely by the CLI; raw token is not logged.
- PAT-authenticated agent inherits the user's room role.
- Agent with `view` can snapshot but cannot mutate.
- Agent with `edit` can mutate but cannot manage sharing.
- Agent presence includes authenticated user display information plus agent label.
- Multiple agents from the same user get distinct `agent_session_id` or `client_id` values.
- Unauthenticated CLI access only works for rooms with `link_access = 'edit'`, if that compatibility path remains enabled.

### Security Regression Tests

- Client-supplied `userId`, `name`, `clientType`, or role cannot escalate privileges.
- Explicit low grants cannot reduce below higher general link access unless a future explicit deny feature is added.
- Pending grants cannot be stolen by GitHub username rename or reuse.
- Raw PATs and invite-like secrets are never stored in D1.
- Session fixation attempts fail because login creates a fresh session id.
- Cross-room authorization checks cannot reuse a valid signed header from another room.
- Stale Worker-to-DO auth headers cannot be replayed after the timestamp window.
- Restricted-room failures return generic `403` responses.

### End-To-End Scenarios

- Guest creates a room, edits it, leaves it inactive, and the room is cleaned after TTL.
- Signed-in user creates a room, leaves it inactive, and the room persists.
- Owner grants another GitHub user `view`; that user can open but not edit.
- Owner upgrades that user to `edit`; edits work immediately after reconnect or access refresh.
- Owner grants a third user `manage`; that manager can grant `view/edit` but cannot grant `manage`.
- Owner downgrades an active editor to viewer; the editor's existing WebSocket immediately loses write ability.
- Owner removes an active member from a restricted room; the member's existing WebSocket is closed or loses room access.
- Owner starts a browser session and an agent session simultaneously; both remain visible and independent.
- A room set to anyone-with-link view handles many anonymous viewers without flooding the presence UI.
