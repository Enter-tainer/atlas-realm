/// <reference types="vite/client" />

declare global {
  const __STYLE_HASH__: string;

  interface Window {
    _mlmap?: import('maplibre-gl').Map | null;
  }

  interface Document {
    webkitFullscreenElement?: Element | null;
  }

  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      ORM_BUCKET: R2Bucket;
      ACCOUNTS_DB?: D1Database;
      MapCollaboration: DurableObjectNamespace;
      INTERNAL_AUTH_SECRET?: string;
      GITHUB_CLIENT_ID?: string;
      GITHUB_CLIENT_SECRET?: string;
    }
  }
}

declare module 'cloudflare:test' {
  export const env: Cloudflare.Env;
  export const SELF: Fetcher;
  export function reset(): Promise<void>;
  export function runDurableObjectAlarm(stub: DurableObjectStub): Promise<boolean>;
  export function runInDurableObject<O extends DurableObject, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}

export {};
