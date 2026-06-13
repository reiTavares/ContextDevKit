/**
 * integration-test-autoformat.mjs — F1 / ADR-0061.
 *
 * Verifies the PostToolUse format/lint hook (`auto-format.mjs`) is advisory and
 * level/config-aware: it stays silent when disabled, below minLevel, or when no
 * toolchain is present, and runs the project's `format` script otherwise —
 * always exiting 0 (a formatter must never break the agent's work, rule 2).
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const fx = installFixture(rep);

const setConfig = (mutate) => {
  const cfg = JSON.parse(readFileSync(fx.cfgPath, 'utf-8').replace(/^﻿/, ''));
  mutate(cfg);
  writeFileSync(fx.cfgPath, JSON.stringify(cfg, null, 2));
};

const payload = { tool_name: 'Write', tool_input: { file_path: 'src/a.js' } };

// 1. Fresh L5 project, no toolchain → skipped, silent.
setConfig((c) => {
  c.level = 5;
  c.autoFormat = { enabled: true, minLevel: 4, excludePaths: [] };
});
let out = fx.hook('auto-format.mjs', payload);
out.trim() === '' ? rep.ok('1. no toolchain → silent skip') : rep.bad(`1. expected silence, got: ${out}`);

// 2. Disabled → silent even with a format script present.
writeFileSync(join(fx.proj, 'package.json'), JSON.stringify({ name: 'x', scripts: { format: 'node -e ""' } }, null, 2));
setConfig((c) => {
  c.autoFormat = { enabled: false, minLevel: 4, excludePaths: [] };
});
out = fx.hook('auto-format.mjs', payload);
out.trim() === '' ? rep.ok('2. disabled → silent') : rep.bad(`2. expected silence, got: ${out}`);

// 3. Below minLevel → silent.
setConfig((c) => {
  c.level = 2;
  c.autoFormat = { enabled: true, minLevel: 4, excludePaths: [] };
});
out = fx.hook('auto-format.mjs', payload);
out.trim() === '' ? rep.ok('3. below minLevel → silent') : rep.bad(`3. expected silence, got: ${out}`);

// 4. Excluded path → silent.
setConfig((c) => {
  c.level = 5;
  c.autoFormat = { enabled: true, minLevel: 4, excludePaths: ['node_modules/'] };
});
out = fx.hook('auto-format.mjs', { tool_name: 'Write', tool_input: { file_path: 'node_modules/pkg/index.js' } });
out.trim() === '' ? rep.ok('4. excluded path → silent') : rep.bad(`4. expected silence, got: ${out}`);

// 5. Enabled with a passing format script → runs, exits 0, no advisory.
setConfig((c) => {
  c.level = 5;
  c.autoFormat = { enabled: true, minLevel: 4, excludePaths: [] };
});
out = fx.hook('auto-format.mjs', payload);
out.includes('reported issues') ? rep.bad('5. passing format script should not warn') : rep.ok('5. passing format script → no advisory, exit 0');

fx.cleanup();
rep.finish('auto-format (F1)');
