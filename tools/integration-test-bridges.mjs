/**
 * integration-test-bridges.mjs — F8 / ADR-0068.
 *
 * Verifies the six multi-platform context bridges: they are OPT-IN per tool
 * (`bridges.enabled`), install idempotently via marker-inject, carry the explicit
 * "context only — no enforcement" notice, preserve user content across re-installs,
 * and place Cursor's YAML frontmatter at line 1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture, run, KIT } from './it-helpers.mjs';

const rep = reporter();
const fx = installFixture(rep);

const TARGETS = {
  cursor: '.cursor/rules/contextdevkit.mdc',
  copilot: '.github/copilot-instructions.md',
  gemini: 'GEMINI.md',
  windsurf: '.windsurfrules',
  aider: 'CONVENTIONS.md',
  continue: '.continue/rules/contextdevkit.md',
};
const abs = (rel) => join(fx.proj, rel);
const update = () => run([join(KIT, 'install.mjs'), '--target', fx.proj, '--update']);

// 1. Default install (bridges.enabled: []) creates NO bridge files.
const noneYet = Object.values(TARGETS).every((rel) => !existsSync(abs(rel)));
noneYet ? rep.ok('1. default install creates no bridges (opt-in)') : rep.bad('1. a bridge was installed without opt-in');

// Enable all six in config, then re-run install --update (preserves config).
const cfg = JSON.parse(readFileSync(fx.cfgPath, 'utf-8').replace(/^﻿/, ''));
cfg.bridges = { enabled: Object.keys(TARGETS) };
writeFileSync(fx.cfgPath, JSON.stringify(cfg, null, 2));
const r = update();
r.status === 0 ? rep.ok('2. install --update with bridges enabled succeeds') : rep.bad(`2. update failed (status ${r.status}): ${r.stderr}`);

// 3. Each enabled bridge exists, holds the marker block, and is context-only.
for (const [key, rel] of Object.entries(TARGETS)) {
  const txt = existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf-8') : '';
  txt.includes('<!-- ContextDevKit:start -->') && /no enforcement/i.test(txt)
    ? rep.ok(`3.${key} bridge installed at ${rel} (context-only)`)
    : rep.bad(`3.${key} bridge missing/incomplete at ${rel}`);
}

// 4. Cursor frontmatter sits at line 1 (above the marker).
const cur = readFileSync(abs(TARGETS.cursor), 'utf-8');
cur.startsWith('---\n') && cur.indexOf('alwaysApply') < cur.indexOf('<!-- ContextDevKit:start -->')
  ? rep.ok('4. cursor frontmatter at line 1, above the kit block')
  : rep.bad('4. cursor frontmatter not at the top');

// 5. Idempotent: a second --update leaves GEMINI.md byte-identical.
const before = readFileSync(abs(TARGETS.gemini), 'utf-8');
update();
readFileSync(abs(TARGETS.gemini), 'utf-8') === before ? rep.ok('5. bridge re-install is idempotent') : rep.bad('5. bridge re-install changed bytes');

// 6. User content outside the block is preserved across re-install.
const cop = abs(TARGETS.copilot);
writeFileSync(cop, readFileSync(cop, 'utf-8') + '\n\n<!-- MY-OWN-RULE -->\n');
update();
readFileSync(cop, 'utf-8').includes('MY-OWN-RULE') ? rep.ok('6. user content preserved across re-install') : rep.bad('6. user content clobbered');

fx.cleanup();
rep.finish('bridges (F8)');
