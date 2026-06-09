import { defineConfig } from 'vite';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

import { cloudflare } from '@cloudflare/vite-plugin';

function fileHash(path) {
  try {
    return createHash('md5').update(readFileSync(path)).digest('hex').slice(0, 8);
  } catch {
    return Date.now().toString(36);
  }
}

export default defineConfig({
  plugins: [cloudflare({ remoteBindings: process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS !== '0' })],
  define: {
    __STYLE_HASH__: JSON.stringify(fileHash('public/orm/style/standard.json')),
    __SCREENSHOT_FIXTURES__: JSON.stringify(process.env.SCREENSHOT_FIXTURES === '1'),
  },
  server: {
    host: true,
  },
});
