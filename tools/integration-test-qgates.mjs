/**
 * integration-test-qgates.mjs — F2 / ADR-0062.
 *
 * Verifies the multi-language pre-push quality gate (`quality-gates.mjs`) honours
 * the warn-first / on-by-level contract: silent below minLevel or when disabled,
 * WARN (exit 0) at minLevel..strictLevel, BLOCK (exit 1) at strictLevel on a real
 * failure, a `disabled[]` key skipped, a missing framework reported (never a
 * false failure, rule 8), and the audited `CONTEXT_SKIP_QGATES` bypass.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture, run } from './it-helpers.mjs';

const rep = reporter();
const fx = installFixture(rep);

const gates = join(fx.proj, 'contextkit', 'runtime', 'git-hooks', 'quality-gates.mjs');
const qgates = (env = {}) => run([gates], { cwd: fx.proj, env: { ...process.env, ...env } });

const setConfig = (mutate) => {
  const cfg = JSON.parse(readFileSync(fx.cfgPath, 'utf-8').replace(/^﻿/, ''));
  mutate(cfg);
  writeFileSync(fx.cfgPath, JSON.stringify(cfg, null, 2));
};

const failingTest = () => writeFileSync(join(fx.proj, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node -e "process.exit(1)"' } }, null, 2));

// 1. Generic project (no framework) → exits 0, says nothing to run.
setConfig((c) => {
  c.level = 5;
  c.qualityGate = { enabled: true, minLevel: 3, strictLevel: 4, disabled: [] };
});
let r = qgates();
r.status === 0 && /No framework detected/.test(r.stderr || '') ? rep.ok('1. generic project → exit 0, nothing to run') : rep.bad(`1. generic case wrong (status ${r.status}): ${r.stderr}`);

// 2. Disabled → silent exit 0 even with a failing test present.
failingTest();
setConfig((c) => {
  c.qualityGate = { enabled: false, minLevel: 3, strictLevel: 4, disabled: [] };
});
r = qgates();
r.status === 0 && !/Quality Gates/.test(r.stderr || '') ? rep.ok('2. disabled → silent exit 0') : rep.bad(`2. expected silent, got status ${r.status}: ${r.stderr}`);

// 3. Below minLevel → silent exit 0.
setConfig((c) => {
  c.level = 2;
  c.qualityGate = { enabled: true, minLevel: 3, strictLevel: 4, disabled: [] };
});
r = qgates();
r.status === 0 && !/Quality Gates/.test(r.stderr || '') ? rep.ok('3. below minLevel → silent exit 0') : rep.bad(`3. expected silent, got status ${r.status}: ${r.stderr}`);

// 4. Warn mode (minLevel <= level < strictLevel), failing test → exit 0 + warning.
setConfig((c) => {
  c.level = 3;
  c.qualityGate = { enabled: true, minLevel: 3, strictLevel: 4, disabled: [] };
});
r = qgates();
r.status === 0 && /warn mode|warn mode\)|push allowed/.test(r.stderr || '') ? rep.ok('4. warn mode → failing gate exits 0 (warn)') : rep.bad(`4. warn case wrong (status ${r.status}): ${r.stderr}`);

// 5. Strict mode (level >= strictLevel), failing test → exit 1 (block).
setConfig((c) => {
  c.level = 5;
  c.qualityGate = { enabled: true, minLevel: 3, strictLevel: 4, disabled: [] };
});
r = qgates();
r.status === 1 && /push blocked/i.test(r.stderr || '') ? rep.ok('5. strict mode → failing gate exits 1 (block)') : rep.bad(`5. strict case wrong (status ${r.status}): ${r.stderr}`);

// 6. Strict mode but the failing gate is in disabled[] → exit 0 (skipped, no failure).
setConfig((c) => {
  c.level = 5;
  c.qualityGate = { enabled: true, minLevel: 3, strictLevel: 4, disabled: ['test'] };
});
r = qgates();
r.status === 0 ? rep.ok('6. disabled[] gate skipped → exit 0 even in strict mode') : rep.bad(`6. disabled gate still failed (status ${r.status}): ${r.stderr}`);

// 7. Audited bypass → exit 0 regardless of level/failure.
setConfig((c) => {
  c.level = 5;
  c.qualityGate = { enabled: true, minLevel: 3, strictLevel: 4, disabled: [] };
});
r = qgates({ CONTEXT_SKIP_QGATES: '1' });
r.status === 0 ? rep.ok('7. CONTEXT_SKIP_QGATES bypass → exit 0') : rep.bad(`7. bypass did not allow (status ${r.status}): ${r.stderr}`);

fx.cleanup();
rep.finish('quality-gates (F2)');
