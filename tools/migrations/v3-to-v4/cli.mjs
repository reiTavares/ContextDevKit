import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../../templates/contextkit/tools/migrations/v3-to-v4/cli.mjs';
import { stableJson } from '../../../templates/contextkit/tools/migrations/v3-to-v4/common.mjs';

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli().then((receipt) => process.stdout.write(stableJson(receipt))).catch((error) => {
    process.stderr.write(`[migrate-v3-to-v4:${error?.code || 'UNEXPECTED_ERROR'}] ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
