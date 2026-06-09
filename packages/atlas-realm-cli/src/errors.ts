import type { JsonRecord } from './types.js';

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export class CliCommandError extends Error {
  code: string;
  details: JsonRecord;

  constructor(code: string, message: string, details: JsonRecord = {}) {
    super(message);
    this.name = 'CliCommandError';
    this.code = code;
    this.details = details;
  }

  toJSON(): JsonRecord {
    return {
      ok: false,
      error: this.code,
      code: this.code,
      message: this.message,
      ...this.details,
    };
  }
}

export function cliErrorJson(error: unknown): JsonRecord {
  if (error instanceof CliCommandError) return error.toJSON();
  if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    return {
      ok: false,
      error: error.code,
      code: error.code,
      message: error.message,
    };
  }
  return {
    ok: false,
    error: 'command_failed',
    code: 'command_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function formatCliError(
  error: unknown,
  { json = false, pretty = false }: { json?: boolean; pretty?: boolean } = {},
): string {
  if (json || pretty) return JSON.stringify(cliErrorJson(error), null, pretty ? 2 : 0);
  return error instanceof Error ? error.message : String(error);
}
