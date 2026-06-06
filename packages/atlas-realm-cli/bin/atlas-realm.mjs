#!/usr/bin/env node

import { existsSync } from 'node:fs';

const compiledCliUrl = new URL('../dist/cli.js', import.meta.url);

if (!existsSync(compiledCliUrl)) {
  console.error('Missing compiled CLI. Run `pnpm --filter @atlas-realm/cli build` first.');
  process.exit(1);
}

const { runCli } = await import('../dist/cli.js');

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
