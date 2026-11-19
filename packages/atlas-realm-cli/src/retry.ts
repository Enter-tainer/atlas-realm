/**
 * A single CLI invocation re-establishes the whole link (room registry POST,
 * WebSocket upgrade, sync handshake) and then submits its mutation. Any one of
 * those steps can fail once on a flaky link, so the handshake — which submits
 * nothing and is therefore safe to repeat — is retried.
 */

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
]);

function errorCode(error: unknown): string {
  const record = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const direct = record?.code;
  if (typeof direct === 'string') return direct;
  const cause = record?.cause?.code;
  return typeof cause === 'string' ? cause : '';
}

/**
 * True when retrying the handshake could plausibly succeed. Only errors raised
 * before anything was submitted qualify: a mutation that already reached the
 * room must never be replayed by this predicate.
 */
export function isTransientConnectError(error: unknown): boolean {
  if (!(error instanceof Error) && typeof error !== 'object') return false;
  const code = errorCode(error);
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true;
  const message = String((error as { message?: unknown })?.message ?? '');
  if (!message) return false;
  // undici reports every transport failure as "fetch failed" and keeps the
  // real reason in `cause`; a plain HTTP status is reported separately below.
  if (/fetch failed/i.test(message)) return true;
  if (/(ECONNRESET|ECONNREFUSED|socket hang up|other side closed|network error)/i.test(message)) return true;
  if (/WebSocket (closed before opening|connection failed)/i.test(message)) return true;
  if (/Timed out connecting to /i.test(message)) return true;
  if (/Timed out waiting for (presence:init|sync:snapshot)/i.test(message)) return true;
  // 5xx and 429 are worth another try; any other status is a real answer.
  if (/Failed to prepare room registry: HTTP (5\d\d|429)/i.test(message)) return true;
  return false;
}

export type RetryNotice = { attempt: number; attempts: number; delayMs: number; error: Error };

export function retryDelayMs(attempt: number, baseMs = 250, maxMs = 2_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
