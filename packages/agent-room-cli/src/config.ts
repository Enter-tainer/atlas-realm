import { createConfig } from './validation.js';
import type { AgentRoomConfig } from './types.js';

export { createConfig };

export function buildSocketUrl({
  host,
  room,
  party,
  clientId,
  agentName,
  agentColor,
  clientType,
}: AgentRoomConfig): string {
  let raw = host;
  if (!/^[a-z]+:\/\//i.test(raw)) {
    raw = /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(raw) ? `http://${raw}` : `https://${raw}`;
  }
  const input = new URL(raw);
  const protocol = input.protocol === 'http:' || input.protocol === 'ws:' ? 'ws:' : 'wss:';
  const basePath = input.pathname.replace(/\/+$/, '');
  const path = `${basePath}/parties/${encodeURIComponent(party)}/${encodeURIComponent(room)}`;
  const url = new URL(`${protocol}//${input.host}${path}`);
  url.searchParams.set('_pk', clientId);
  url.searchParams.set('userId', clientId);
  url.searchParams.set('name', agentName);
  url.searchParams.set('color', agentColor);
  url.searchParams.set('clientType', clientType);
  if (clientType === 'query') url.searchParams.set('headless', 'true');
  return url.toString();
}
