import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_NAME,
  DEFAULT_HOST,
  DEFAULT_PARTY,
  DEFAULT_ROOM,
  HEX_COLOR_RE,
  ID_RE,
} from './constants.js';
import type { AgentRoomConfig, JsonRecord } from './types.js';

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeId(value: unknown, fallback = ''): string {
  const id = String(value || '').trim();
  return ID_RE.test(id) ? id : fallback;
}

export function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback;
}

export function normalizeName(value: unknown, fallback: string, maxLength = 96): string {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

export function randomId(prefix: string): string {
  return `${prefix}-${randomUUID()
    .replace(/[^0-9a-zA-Z_-]/g, '')
    .slice(0, 72)}`;
}

export function coerceBoolean(value: unknown, fallback: boolean | null = null): boolean | null {
  if (value === undefined) return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function coerceNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function parseJson(value: string, label: string): any {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} JSON: ${message}`);
  }
}

export function createConfig(
  options: JsonRecord = {},
  env: Record<string, string | undefined> = process.env,
): AgentRoomConfig {
  const clientId = normalizeId(options.clientId, randomId('agent'));
  const clientType = options.clientType === 'query' || options.headless === true ? 'query' : 'agent';
  return {
    host: String(options.host || env.ORM_ROOM_HOST || env.ROOM_HOST || DEFAULT_HOST),
    room: normalizeId(options.room, DEFAULT_ROOM),
    party: normalizeId(options.party, DEFAULT_PARTY),
    clientId,
    agentName: normalizeName(options.agentName, DEFAULT_AGENT_NAME, 32),
    agentColor: normalizeColor(options.agentColor, DEFAULT_AGENT_COLOR),
    clientType,
    timeoutMs: clamp(options.timeout, 1000, 120_000, 10_000),
  };
}
