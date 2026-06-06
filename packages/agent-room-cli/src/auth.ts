import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildApiUrl } from './config.js';
import type { JsonRecord } from './types.js';

export interface TokenStoreEntry {
  host: string;
  token: string;
  githubLogin?: string;
  displayName?: string | null;
  updatedAt: number;
}

export interface DeviceStartResponse {
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  expiresAt: number;
  intervalSeconds: number;
}

export interface DevicePollResponse extends JsonRecord {
  status?: 'pending' | 'slow_down' | 'complete' | 'expired' | 'denied';
  token?: string | null;
  intervalSeconds?: number;
  retryAfterSeconds?: number;
  user?: {
    githubLogin?: string;
    displayName?: string | null;
  };
  error?: string;
}

function homeDir(env: Record<string, string | undefined> = process.env): string {
  return env.ORM_AGENT_ROOM_CONFIG_DIR || env.XDG_CONFIG_HOME || (env.HOME ? join(env.HOME, '.config') : '.');
}

export function tokenStorePath(env: Record<string, string | undefined> = process.env): string {
  return env.ORM_AGENT_ROOM_TOKEN_STORE || join(homeDir(env), 'orm-agent-room', 'tokens.json');
}

function normalizeHostKey(host: string): string {
  let raw = host;
  if (!/^[a-z]+:\/\//i.test(raw)) {
    raw = /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(raw) ? `http://${raw}` : `https://${raw}`;
  }
  const url = new URL(raw);
  const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
  return `${protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

async function readStore(path = tokenStorePath()): Promise<Record<string, TokenStoreEntry>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, TokenStoreEntry>)
      : {};
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store: Record<string, TokenStoreEntry>, path = tokenStorePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export async function getStoredToken(host: string, path = tokenStorePath()): Promise<string> {
  const store = await readStore(path);
  return store[normalizeHostKey(host)]?.token || '';
}

export async function saveStoredToken(
  host: string,
  token: string,
  user: DevicePollResponse['user'] | null | undefined,
  path = tokenStorePath(),
): Promise<TokenStoreEntry> {
  const key = normalizeHostKey(host);
  const store = await readStore(path);
  const entry: TokenStoreEntry = {
    host: key,
    token,
    githubLogin: user?.githubLogin,
    displayName: user?.displayName,
    updatedAt: Date.now(),
  };
  store[key] = entry;
  await writeStore(store, path);
  return entry;
}

export async function deleteStoredToken(host: string, path = tokenStorePath()): Promise<boolean> {
  const key = normalizeHostKey(host);
  const store = await readStore(path);
  const existed = Boolean(store[key]);
  delete store[key];
  if (Object.keys(store).length) await writeStore(store, path);
  else await rm(path, { force: true });
  return existed;
}

async function parseJsonResponse(response: Response): Promise<JsonRecord> {
  const data = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) throw new Error(String(data.error || `HTTP ${response.status}`));
  return data;
}

export async function startDeviceLogin(host: string, name: string): Promise<DeviceStartResponse> {
  const response = await fetch(buildApiUrl({ host }, '/api/auth/github/device/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return (await parseJsonResponse(response)) as unknown as DeviceStartResponse;
}

export async function pollDeviceLogin(host: string, flowId: string): Promise<DevicePollResponse> {
  const response = await fetch(buildApiUrl({ host }, '/api/auth/github/device/poll'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId }),
  });
  return (await parseJsonResponse(response)) as DevicePollResponse;
}

export async function fetchCurrentTokenUser(host: string, token: string): Promise<JsonRecord> {
  const response = await fetch(buildApiUrl({ host }, '/api/auth/me'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse(response);
}
