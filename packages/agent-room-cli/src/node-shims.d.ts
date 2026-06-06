declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
  exitCode?: number;
};

declare const Buffer: {
  from(input: string | ArrayBufferLike | ArrayBufferView, encoding?: string): any;
  byteLength(input: string, encoding?: string): number;
};

declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): { digest(encoding: 'hex'): string };
  };
}

declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>;
  export function readFile(path: string): Promise<any>;
  export function writeFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
}

declare module 'node:path' {
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;
}

declare module 'node:zlib' {
  export function gzipSync(data: Uint8Array): any;
  export function gunzipSync(data: Uint8Array): any;
}
