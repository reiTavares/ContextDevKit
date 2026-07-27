#!/usr/bin/env node
/**
 * selfcheck-docs.mjs — DOC-007 (WF0016, ADR-0075)
 *
 * COHESION NOTE (constitution §1 +10% allowance): assertions (a)–(d) share the
 * reindexDocs module context and docs/README.md lifecycle; splitting would
 * duplicate the loadReindexContext setup with no second consumer.
 *
 * Static wiring assertions for the public-docs enforcement gate:
 *   (a) lintPublicDocs passes on the real tree (no banned tokens / secret leaks).
 *   (b) checkReadmeClaims passes on the real tree (README inventory matches disk).
 *   (c) docs-reindex is idempotent: regenerating yields no diff vs committed
 *       docs/README.md. Side-effect-free — original bytes always restored.
 *   (d) Structural completeness: 4 Diátaxis buckets + architecture/ exist;
 *       every non-template public .md is classified (no unclassified real doc).
 *   (e) Reference is in sync (ADR-0115): docs-generate regenerate-and-diff finds
 *       no drift — the generated feature tables match the registry. Prints
 *       coverage debt (features lacking hand-authored prose) as an advisory.
 *
 * "Skipped is never a pass" (constitution §8) — missing dep = FAIL loudly.
 * Zero runtime deps — node:* only. Exits 0 on all-pass, 1 on any failure.
 * Standalone: node tools/selfcheck-docs.mjs
 */

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');

let failures = 0;
let passes = 0;
const VERBOSE = process.argv.includes('--verbose');
const ok = (msg) => { passes++; if (VERBOSE) console.log(`  ✓ ${msg}`); };
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures++; };

/**
 * Import a named export from a script, returning the module or null on error.
 * Calls bad() on any problem — callers check for null and return early.
 *
 * @param {string} scriptPath - Absolute path to the .mjs file.
 * @param {string} exportName - Name of the expected export.
 * @returns {Promise<object|null>}
 */
async function importMod(scriptPath, exportName) {
  if (!existsSync(scriptPath)) { bad(`${scriptPath} not found`); return null; }
  let mod;
  try { mod = await import(pathToFileURL(scriptPath).href); } catch (err) { bad(`import ${scriptPath}: ${err?.message ?? err}`); return null; }
  if (typeof mod[exportName] !== 'function') { bad(`${scriptPath} missing export ${exportName}()`); return null; }
  return mod;
}

// ---------------------------------------------------------------------------
// Assertion (a): lintPublicDocs — real tree must be clean
// ---------------------------------------------------------------------------

async function assertLintClean() {
  console.log('(a) lintPublicDocs — real tree...');
  const mod = await importMod(resolve(SCRIPTS, 'docs-public-lint.mjs'), 'lintPublicDocs');
  if (!mod) return;
  let result;
  try { result = mod.lintPublicDocs(KIT); } catch (err) { bad(`lintPublicDocs threw: ${err?.message ?? err}`); return; }
  if (result.ok) {
    ok('lintPublicDocs(root) → ok:true — no banned tokens or secret leaks in public docs');
  } else {
    bad(`lintPublicDocs found ${result.hits.length} hit(s) in public docs:`);
    for (const { file, line, token, reason } of result.hits) console.error(`       ${file}:${line}  [${token}]  ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Assertion (b): checkReadmeClaims — real tree must match
// ---------------------------------------------------------------------------

async function assertReadmeClaims() {
  console.log('(b) checkReadmeClaims — real tree...');
  const mod = await importMod(resolve(SCRIPTS, 'readme-claims.mjs'), 'checkReadmeClaims');
  if (!mod) return;
  let result;
  try { result = await mod.checkReadmeClaims(KIT); } catch (err) { bad(`checkReadmeClaims threw: ${err?.message ?? err}`); return; }
  if (result.skipped.length > 0) {
    for (const { claim, reason } of result.skipped) console.log(`  SKIPPED [${claim}] — ${reason}`);
  }
  if (result.ok) {
    ok('checkReadmeClaims(root) → ok:true — all README inventory claims match the registry');
  } else {
    bad(`checkReadmeClaims found ${result.mismatches.length} mismatch(es):`);
    for (const { claim, readmeValue, actualValue, source } of result.mismatches) {
      console.error(`       [${claim}] README says ${JSON.stringify(readmeValue)}, actual is ${JSON.stringify(actualValue)} (source: ${source})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Assertions (c) + (d) shared: load docs-reindex module once
// ---------------------------------------------------------------------------

/**
 * Load docs-reindex and capture the current docs/README.md bytes.
 * Caller MUST restore indexPath when done. Returns null on any error (bad() called).
 *
 * @returns {Promise<{reindexMod: object, committed: Buffer, indexPath: string}|null>}
 */
async function loadReindexContext() {
  const reindexPath = resolve(SCRIPTS, 'docs-reindex.mjs');
  const indexPath = resolve(KIT, 'docs', 'README.md');
  if (!existsSync(reindexPath)) { bad(`docs-reindex.mjs not found at ${reindexPath}`); return null; }
  if (!existsSync(indexPath)) { bad('docs/README.md not found'); return null; }
  const committed = readFileSync(indexPath);
  const mod = await importMod(reindexPath, 'reindexDocs');
  if (!mod) return null;
  return { reindexMod: mod, committed, indexPath };
}

// ---------------------------------------------------------------------------
// Assertion (c): docs-reindex idempotency
// ---------------------------------------------------------------------------

/**
 * @param {object} reindexMod
 * @param {Buffer} committed
 * @param {string} indexPath
 */
function assertReindexIdempotent(reindexMod, committed, indexPath) {
  console.log('(c) docs-reindex idempotency...');
  let regenerated;
  try {
    reindexMod.reindexDocs(KIT);
    regenerated = readFileSync(indexPath);
  } catch (err) {
    writeFileSync(indexPath, committed);
    bad(`reindexDocs threw: ${err?.message ?? err}`);
    return;
  }
  writeFileSync(indexPath, committed);
  if (committed.equals(regenerated)) {
    ok('docs-reindex idempotent — regenerated docs/README.md matches committed bytes');
  } else {
    bad('docs-reindex is NOT idempotent — committed and regenerated docs/README.md differ');
    console.error(`       committed length: ${committed.length}, regenerated: ${regenerated.length}`);
  }
}

// ---------------------------------------------------------------------------
// Assertion (d): structural completeness
// ---------------------------------------------------------------------------

/**
 * @param {object} reindexMod
 * @param {Buffer} committedIndex
 * @param {string} indexPath
 */
function assertStructuralCompleteness(reindexMod, committedIndex, indexPath) {
  console.log('(d) structural completeness...');
  const docsDir = resolve(KIT, 'docs');

  for (const bucket of ['tutorials', 'how-to', 'reference', 'explanation', 'architecture']) {
    const bucketPath = join(docsDir, bucket);
    existsSync(bucketPath) && statSync(bucketPath).isDirectory()
      ? ok(`docs/${bucket}/ directory exists`)
      : bad(`docs/${bucket}/ directory is missing`);
  }

  const diataxisPath = join(docsDir, '.diataxis.json');
  if (!existsSync(diataxisPath)) { bad('docs/.diataxis.json not found — cannot verify classification coverage'); return; }
  ok('docs/.diataxis.json exists');

  // Use reindexDocs to determine unclassified files — it applies the canonical
  // logic (explicit map → folder → heuristic → META_FILES). Template stubs are
  // intentional placeholders and excluded from the unclassified check.
  let reindexResult;
  try {
    reindexResult = reindexMod.reindexDocs(KIT);
  } catch (err) {
    writeFileSync(indexPath, committedIndex);
    bad(`reindexDocs threw during structural check: ${err?.message ?? err}`);
    return;
  }
  writeFileSync(indexPath, committedIndex);

  const realUnclassified = (reindexResult.unclassified ?? []).filter((rel) => !rel.endsWith('_TEMPLATE.md'));
  if (realUnclassified.length === 0) {
    ok('reindexDocs reports no real unclassified docs (all public .md files are classified)');
  } else {
    bad(`${realUnclassified.length} public .md file(s) are unclassified:`);
    for (const rel of realUnclassified) console.error(`       docs/${rel}`);
  }
}

// ---------------------------------------------------------------------------
// Assertion (f): the generated index does not depend on the ambient git env
// ---------------------------------------------------------------------------

/**
 * Regression seal (WF-0086): `reindexDocs` decides whether to index a doc by asking
 * `git check-ignore`. Git hooks export GIT_DIR/GIT_INDEX_FILE, and in a LINKED
 * WORKTREE those point at `.git/worktrees/<name>/`, which carries no `info/exclude`
 * — that rule lives in the common git dir. Inherited, the same file read as ignored
 * from a shell and NOT ignored from a hook, so `docs/README.md` differed depending on
 * who regenerated it: the pre-commit hook kept re-adding an entry the selfcheck then
 * rejected as non-idempotent. The generated index must be a function of the tree, not
 * of the caller's environment.
 *
 * SELF-CONTAINED BY NECESSITY. An earlier cut of this check ran against the real
 * `KIT/docs` and relied on `docs/CHANGELOG.md` being present-and-ignored. That file is
 * untracked and ignored only through this repo's local `.git/info/exclude`, so on a
 * clean clone it does not exist — no `META_FILES` member is ignored, both renders come
 * out identical, and the check went GREEN ON THE DEFECT. That is a false negative, the
 * one direction constitution §8 forbids. The fixture below therefore builds the
 * discriminating condition itself and asserts it is discriminating before judging.
 *
 * @param {object} reindexMod
 */
function assertIndexIgnoresAmbientGitEnv(reindexMod) {
  console.log('(f) generated index is invariant to the ambient git env...');
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  const clean = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX']) delete clean[key];
  // `tree` owns the docs + the exclude rule; `other` is a VALID but unrelated gitdir —
  // the linked-worktree shape (`.git/worktrees/<name>/` inherits no common excludes), so
  // `check-ignore` exits 1 cleanly rather than 128 "not a git repository".
  let tree; let other;
  try {
    tree = mkdtempSync(join(tmpdir(), 'ctxkit-docs-env-tree-'));
    other = mkdtempSync(join(tmpdir(), 'ctxkit-docs-env-other-'));
    for (const dir of [tree, other]) {
      const init = spawnSync('git', ['init', '--quiet', dir], { encoding: 'utf-8' });
      if (init.status !== 0) {
        bad(`(f) fixture repo could not be created — check SKIPPED, never passed: ${init.stderr?.trim() || init.error?.message || `exit ${init.status}`}`);
        return;
      }
    }
    mkdirSync(join(tree, 'docs', 'reference'), { recursive: true });
    writeFileSync(join(tree, 'docs', 'CHANGELOG.md'), '# Changelog\n\nLocal-only release chronology.\n');
    writeFileSync(join(tree, 'docs', 'reference', 'thing.md'), '# Thing\n\nA reference doc.\n');
    appendFileSync(join(tree, '.git', 'info', 'exclude'), '\n/docs/CHANGELOG.md\n');
  } catch (err) {
    bad(`(f) fixture setup threw — check SKIPPED, never passed: ${err?.message ?? err}`);
    if (tree) rmSync(tree, { recursive: true, force: true });
    if (other) rmSync(other, { recursive: true, force: true });
    return;
  }

  const docsDir = join(tree, 'docs');
  const indexPath = join(docsDir, 'README.md');
  const pollution = { ...clean, GIT_DIR: join(other, '.git'), GIT_INDEX_FILE: join(other, '.git', 'index') };
  let plain; let polluted;
  try {
    // Prove the fixture can actually tell the two readings apart. If it cannot, the
    // comparison below would pass on broken and fixed code alike — report, never pass.
    const changelog = join(docsDir, 'CHANGELOG.md');
    const ignoredClean = spawnSync('git', ['check-ignore', '-q', changelog], { cwd: docsDir, env: clean }).status === 0;
    const ignoredPolluted = spawnSync('git', ['check-ignore', '-q', changelog], { cwd: docsDir, env: pollution }).status === 0;
    if (!ignoredClean || ignoredPolluted) {
      bad(`(f) fixture is NOT discriminating (clean=${ignoredClean} polluted=${ignoredPolluted}) — check SKIPPED, never passed`);
      return;
    }
    reindexMod.reindexDocs(tree);
    plain = readFileSync(indexPath);
    process.env.GIT_DIR = pollution.GIT_DIR;
    // `check-ignore` also consults the index (a tracked file is never reported ignored),
    // so a hook's alternate index is part of the inherited state under test.
    process.env.GIT_INDEX_FILE = pollution.GIT_INDEX_FILE;
    reindexMod.reindexDocs(tree);
    polluted = readFileSync(indexPath);
  } catch (err) {
    bad(`reindexDocs threw during git-env invariance check: ${err?.message ?? err}`);
    return;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(tree, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
  if (plain.equals(polluted)) {
    ok('generated index identical with and without an inherited GIT_DIR (hook-safe)');
  } else {
    bad('generated index CHANGES when GIT_DIR is inherited — a hook and a shell would disagree');
    console.error(`       plain length: ${plain.length}, with inherited GIT_DIR: ${polluted.length}`);
  }
}

// ---------------------------------------------------------------------------
// Assertion (e): generated reference in sync + coverage debt (ADR-0115)
// ---------------------------------------------------------------------------

async function assertReferenceInSync() {
  console.log('(e) generated reference in sync (ADR-0115)...');
  const mod = await importMod(resolve(SCRIPTS, 'docs-generate.mjs'), 'generateReference');
  if (!mod) return;
  let result;
  try { result = mod.generateReference(KIT, { write: false }); } catch (err) { bad(`generateReference threw: ${err?.message ?? err}`); return; }
  if (result.ok) {
    ok(`generated reference in sync (commands=${result.counts.commands} agents=${result.counts.agents} hosts=${result.counts.hosts})`);
  } else {
    const stale = result.files.filter((f) => f.changed).map((f) => f.path);
    bad(`reference is STALE — run docs-generate.mjs to regenerate: ${stale.join(', ')}`);
  }
  // Advisory only — prose coverage gaps are tracked, never block (ADR-0115 split posture).
  if (typeof mod.coverageDebt === 'function') {
    try {
      const debt = mod.coverageDebt(KIT);
      const cmdN = debt.commandsMissing.length, agN = debt.agentsMissing.length;
      if (cmdN || agN) {
        console.log(`  ADVISORY coverage debt — ${cmdN} command(s) + ${agN} agent(s) lack a hand-authored how-to/explanation (reference covers them):`);
        if (cmdN) console.log(`       commands: ${debt.commandsMissing.slice(0, 12).join(', ')}${cmdN > 12 ? ` … (+${cmdN - 12})` : ''}`);
      } else {
        ok('coverage debt: every command + agent is mentioned in at least one prose doc');
      }
    } catch { /* advisory — never fails the gate */ }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\nselfcheck-docs — DOC-007/DOC-009 public-docs gate assertions\n');

  await assertLintClean();
  await assertReadmeClaims();
  await assertReferenceInSync();

  const ctx = await loadReindexContext();
  if (ctx === null) {
    bad('assertions (c) and (d) skipped — missing dependency (constitution §8: skipped is never a pass)');
  } else {
    assertReindexIdempotent(ctx.reindexMod, ctx.committed, ctx.indexPath);
    assertStructuralCompleteness(ctx.reindexMod, ctx.committed, ctx.indexPath);
    assertIndexIgnoresAmbientGitEnv(ctx.reindexMod);
  }

  const total = passes + failures;
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${passes}/${total} checks passed.\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error(`selfcheck-docs: unexpected error — ${err?.message ?? err}`); process.exit(1); });
