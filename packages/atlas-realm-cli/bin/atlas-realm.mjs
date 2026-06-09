#!/usr/bin/env node

import { existsSync } from 'node:fs';

const compiledCliUrl = new URL('../dist/cli.js', import.meta.url);

if (!existsSync(compiledCliUrl)) {
  console.error('Missing compiled CLI. Run `pnpm --filter @atlas-realm/cli build` first.');
  process.exit(1);
}

const [{ runCli }, { formatCliError }] = await Promise.all([import('../dist/cli.js'), import('../dist/errors.js')]);

const hasFlag = (name) => process.argv.some((arg) => arg === name || arg.startsWith(`${name}=`));

runCli(process.argv.slice(2)).catch((error) => {
  console.error(
    formatCliError(error, {
      json: hasFlag('--json'),
      pretty: hasFlag('--pretty'),
    }),
  );
  process.exitCode = 1;
});
