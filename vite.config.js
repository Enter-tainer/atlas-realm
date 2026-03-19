import { defineConfig } from 'vite'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'

import { cloudflare } from "@cloudflare/vite-plugin";

function fileHash(path) {
  try {
    return createHash('md5').update(readFileSync(path)).digest('hex').slice(0, 8)
  } catch { return Date.now().toString(36) }
}

export default defineConfig({
  plugins: [cloudflare()],
  define: {
    __STYLE_HASH__: JSON.stringify(fileHash('public/orm/style/standard.json')),
  },
  server: {
    host: true,
  },
})