#!/usr/bin/env node
/**
 * Selfcheck — native host-neutral `/work` Claude command.
 *
 * Guards the fix for "Claude reaches for ctx.mjs (the Antigravity runner) to start
 * a methodology operation":
 *   1. The native /work command exists, is well-formed, and drives the host-neutral
 *      script `contextkit/tools/scripts/work.mjs` — never `ctx`/`cdx` as a command.
 *
 * Run:  node tools/selfcheck-work-command.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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

console.log('\n🌀 Selfcheck — native host-neutral /work command\n');
checkCommand();
rep.finish('native host-neutral /work command');
