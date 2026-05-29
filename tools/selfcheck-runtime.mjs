/**
 * Self-check — RUNTIME / BEHAVIOR invariants.
 *
 * Owns the deeper *behavioural* checks that exercise live engine modules:
 *   - boot-context-readers (Unreleased extraction + session tie-break)
 *   - safe-io atomic primitives + sid sanitization + safe JSON read
 *   - shared squad detection used by /squad + /tune-agents
 *
 * Split out of the legacy `selfcheck-checks.mjs` (ADR-0016 H1 / task 037 —
 * by invariant category, not by line count). Sibling modules:
 *   - `selfcheck-config.mjs`   — level taxonomy + zod schema agreement.
 *   - `selfcheck-source.mjs`   — source-level / structural invariants.
 *
 * Every function takes the reporter `rep` ({ ok, bad }) plus only what it
 * needs, so the module has no hidden state. Entry point:
 * `runRuntimeChecks(rep, ctx)` where `ctx = { KIT, mods }`.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Boot-context reader behaviours the boot banner depends on. Guards two
 * boundary bugs: a clipped [Unreleased] must say so, and a session-number
 * collision must resolve by the later date.
 */
async function checkBootReaders(rep, boot) {
  const { ok, bad } = rep;
  console.log('Checking boot-context readers...');
  if (!boot?.extractUnreleased || !boot?.extractLatestSession) {
    bad('boot-context-readers exports missing (extractUnreleased/extractLatestSession)');
    return;
  }
  boot.extractUnreleased('## [Unreleased]\n\n- one real change\n\n## [1.0.0]\n') === '- one real change'
    ? ok('extractUnreleased returns a short block verbatim') : bad('extractUnreleased mangled a short block');
  const bigBody = Array.from({ length: 80 }, (_, i) => `- change ${i}`).join('\n');
  /truncated/i.test(boot.extractUnreleased(`## [Unreleased]\n\n${bigBody}\n\n## [1.0.0]\n`) || '')
    ? ok('extractUnreleased flags a >60-line block as truncated') : bad('extractUnreleased truncated silently (no marker)');
  const tmp = mkdtempSync(join(tmpdir(), 'vibekit-sc-'));
  try {
    const sdir = resolve(tmp, 'vibekit/memory/sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(resolve(sdir, '2026-01-02-09-older.md'), '# OLDER session pick\n');
    writeFileSync(resolve(sdir, '2026-05-09-09-newer.md'), '# NEWER session pick\n');
    const latest = await boot.extractLatestSession(tmp);
    latest?.content?.includes('NEWER')
      ? ok('extractLatestSession breaks a number tie by the later date') : bad(`extractLatestSession tie-break wrong: ${latest?.content}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Atomic writes round-trip + leave no temp residue; sid sanitization
 * neutralizes traversal; shared JSON read/parse work. Guards 008/011/012/027.
 */
async function checkConcurrencySafety(rep, safeio, ledger) {
  const { ok, bad } = rep;
  console.log('Checking atomic I/O + sid sanitization...');
  if (safeio?.writeFileAtomicSync && safeio?.writeFileAtomic) {
    const tmp = mkdtempSync(join(tmpdir(), 'vibekit-io-'));
    try {
      const f = resolve(tmp, 'a.txt');
      safeio.writeFileAtomicSync(f, 'hello');
      readFileSync(f, 'utf-8') === 'hello' ? ok('writeFileAtomicSync round-trips') : bad('writeFileAtomicSync wrong content');
      await safeio.writeFileAtomic(f, 'world');
      readFileSync(f, 'utf-8') === 'world' ? ok('writeFileAtomic round-trips') : bad('writeFileAtomic wrong content');
      readdirSync(tmp).length === 1 ? ok('atomic write leaves no temp residue') : bad('atomic write left temp files behind');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else bad('safe-io atomic writers not exported');
  if (ledger?.sanitizeSid) {
    const dirty = ledger.sanitizeSid('../../etc/passwd');
    !dirty.includes('/') && !dirty.includes('.') ? ok('sanitizeSid neutralizes path traversal') : bad(`sanitizeSid leaked separators: ${dirty}`);
  } else bad('ledger.sanitizeSid not exported');
  if (safeio?.readJsonSafe && safeio?.parseJsonSafe) {
    safeio.parseJsonSafe('{"a":1}')?.a === 1 && safeio.parseJsonSafe('not json', 'fb') === 'fb'
      ? ok('parseJsonSafe parses + falls back') : bad('parseJsonSafe wrong');
    const tmp2 = mkdtempSync(join(tmpdir(), 'vibekit-rj-'));
    try {
      const jf = resolve(tmp2, 'x.json');
      writeFileSync(jf, '﻿' + JSON.stringify({ ok: true }));
      safeio.readJsonSafe(jf)?.ok === true ? ok('readJsonSafe reads a BOM-prefixed JSON file') : bad('readJsonSafe BOM fail');
      safeio.readJsonSafe(resolve(tmp2, 'missing.json'), 'def') === 'def' ? ok('readJsonSafe returns fallback for a missing file') : bad('readJsonSafe missing-file fail');
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  } else bad('safe-io read helpers (readJsonSafe/parseJsonSafe) not exported');
}

/** 028 — shared squad detection used by /squad + /tune-agents. */
async function checkSquadMeta(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking shared squad detection...');
  const { squadOf } = await import('file://' + resolve(KIT, 'templates/vibekit/tools/scripts/squad-meta.mjs').replaceAll('\\', '/'));
  const dir = mkdtempSync(join(tmpdir(), 'vibekit-sq-'));
  try {
    writeFileSync(resolve(dir, 'infra-security.md'), '---\ndescription: Cloud security (security-team)\n---\n');
    squadOf(dir, 'qa-unit') === 'qa-team' ? ok('squadOf: qa-* → qa-team') : bad('squadOf qa-* wrong');
    squadOf(dir, 'infra-security') === 'security-team' ? ok('squadOf: reads the squad tag from the description') : bad('squadOf tag parse wrong');
    squadOf(dir, 'nonexistent') === 'devteam' ? ok('squadOf: missing agent → devteam') : bad('squadOf fallback wrong');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs every runtime/behavior check in order. `ctx` = { KIT, mods }. */
export async function runRuntimeChecks(rep, { KIT, mods }) {
  await checkBootReaders(rep, mods['hooks/boot-context-readers.mjs']);
  await checkConcurrencySafety(rep, mods['hooks/safe-io.mjs'], mods['hooks/ledger.mjs']);
  await checkSquadMeta(rep, KIT);
}
