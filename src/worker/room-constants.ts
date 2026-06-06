export const PROFILE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5'];

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const FILE_CONTENT_BINARY_VERSION = 1;
export const MAX_FILE_CONTENT_BYTES = 2 * 1024 * 1024;
export const EPHEMERAL_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const UNREFERENCED_FILE_CONTENT_TTL_MS = 60 * 60 * 1000;
export const AGENT_RECENT_TTL_MS = 5 * 60 * 1000;
export const AGENT_TOUCH_THROTTLE_MS = 5 * 1000;
export const AUTH_HEADER_MAX_AGE_MS = 60_000;
export const SQL_READY_KEY = '__layer_sql_ready_v2_clean_break';
