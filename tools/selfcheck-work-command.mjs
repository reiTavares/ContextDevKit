#!/usr/bin/env node
/**
 * Selfcheck — native /work Claude command + host-neutral seeded README
 * (BIZ-0001 methodology; ADR-0126 follow-up).
 *
 * Guards the fix for "Claude reaches for ctx.mjs (the Antigravity runner) to start
 * a methodology operation":
 *   1. The native /work command exists, is well-formed, and drives the host-neutral
 *      script `contextkit/tools/scripts/work.mjs` — never `ctx`/`cdx` as a command.
 *   2. The installer-seeded work-context READMEs point at the host-neutral path too
 *      (a fresh install must not teach `node ctx.mjs ...`).
 *
 * Run:  node tools/selfcheck-work-command.mjs
 */
import { readFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;

const CMD = resolve(KIT, 'templates/claude/commands/pipeline/work.md');
const HOST_NEUTRAL = 'contextkit/tools/scripts/work.mjs';

// ── 1. The native command file ───────────────────────────────────────────────
function checkCommand() {
  let body = '';
  try {
    body = readFileSync(CMD, 'utf8');
    ok('templates/claude/commands/pipeline/work.md exists');
  } catch {
    bad('work.md command file is MISSING — Claude has no native methodology entry point');
    return;
  }

  /^---\r?\n[\s\S]*?description:[\s\S]*?---/.test(body)
    ? ok('work.md has a frontmatter block with a description')
    : bad('work.md is missing a frontmatter description');

  body.includes(HOST_NEUTRAL)
    ? ok(`work.md drives the host-neutral script (${HOST_NEUTRAL})`)
    : bad(`work.md does not reference ${HOST_NEUTRAL}`);

  // The only allowed mention of ctx/cdx is the "do NOT use" warning — never as an
  // actual command line (`node ctx.mjs work` / `node cdx.mjs work`).
  !/node\s+ctx\.mjs\s+work/.test(body) && !/node\s+cdx\.mjs\s+work/.test(body)
    ? ok('work.md never instructs the Antigravity/Codex runner (ctx/cdx) as a command')
    : bad('work.md still instructs `node ctx.mjs work` / `node cdx.mjs work` (wrong host runner)');

  /do not call|⚠️/i.test(body)
    ? ok('work.md warns against the wrong-host runner explicitly')
    : bad('work.md does not warn against ctx/cdx misuse');
}

// ── 2. The seeded READMEs are host-neutral ───────────────────────────────────
async function checkSeededReadme() {
  const mod = await import('file:///' + resolve(KIT, 'tools/install/seed-methodology.mjs').replaceAll('\\', '/'));
  const dir = mkdtempSync(join(tmpdir(), 'workcmd-sc-'));
  mkdirSync(join(dir, 'contextkit'), { recursive: true });
  try {
    await mod.maybeSeedMethodology(dir, { name: 'Acme Platform' });
    const roots = ['business', 'operations'];
    let neutral = true;
    let leaks = false;
    for (const root of roots) {
      const readmePath = join(dir, 'contextkit', 'memory', root, 'README.md');
      let text = '';
      try { text = readFileSync(readmePath, 'utf8'); } catch { neutral = false; continue; }
      if (!text.includes(HOST_NEUTRAL)) neutral = false;
      if (/node\s+ctx\.mjs\s+work|node\s+cdx\.mjs\s+work/.test(text)) leaks = true;
    }
    neutral ? ok('seeded root READMEs reference the host-neutral work.mjs path') : bad('a seeded README is missing the host-neutral path');
    !leaks ? ok('seeded READMEs never teach `node ctx.mjs work` (no wrong-host leak)') : bad('a seeded README still teaches the ctx/cdx runner');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  console.log('\n🌀 Selfcheck — native /work command + host-neutral seeded READMEs\n');
  checkCommand();
  await checkSeededReadme();
  rep.finish('native /work command + host-neutral READMEs');
})();
