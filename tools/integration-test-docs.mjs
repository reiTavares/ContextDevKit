#!/usr/bin/env node
/**
 * integration-test-docs.mjs — DOC-007 (WF0016, ADR-0075)
 *
 * Behavioral integration assertions for the public-docs enforcement gate.
 * All temp fixtures are cleaned up via a finally block.
 *
 * Assertions:
 *   1. lint BLOCKS (exit 1) on a seeded banned token in a public file.
 *   2. lint is CLEAN on the real tree via the library API (internal paths not scanned).
 *   3. lint is CLEAN on the real tree via the CLI.
 *   4. readme-claims FAILS on a deliberately wrong forge count (fixture).
 *   5. readme-claims PASSES on the real tree.
 *   6. docs-reindex idempotency: two consecutive runs produce identical output.
 *   7. validate-doc is ADVISORY: exits 0 without a CI opt-in env var.
 *
 * Zero runtime deps — node:* only. Exits 0 on all-pass, 1 on any failure.
 * Standalone: node tools/integration-test-docs.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');
const node = process.execPath;

let failures = 0;
let passes = 0;
const ok = (msg) => { passes++; console.log(`  ✓ ${msg}`); };
const bad = (msg) => { failures++; console.error(`  ✗ ${msg}`); };

/** Run a node script synchronously. */
function run(args, cwd) {
  const r = spawnSync(node, args, { encoding: 'utf-8', cwd: cwd ?? KIT });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Temp dirs registered for cleanup. @type {string[]} */
const tempDirs = [];
const makeTempDir = () => { const d = mkdtempSync(join(tmpdir(), 'cdk-docs-it-')); tempDirs.push(d); return d; };
const cleanup = () => { for (const d of tempDirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } };

/**
 * Import a script module and assert it exports a named function.
 * Returns the module on success, or calls bad() and returns null.
 *
 * @param {string} scriptPath - Absolute path to the .mjs file.
 * @param {string} exportName - Expected export name.
 * @returns {Promise<object|null>}
 */
async function importScript(scriptPath, exportName) {
  if (!existsSync(scriptPath)) { bad(`${scriptPath} not found`); return null; }
  let mod;
  try { mod = await import(pathToFileURL(scriptPath).href); } catch (err) { bad(`import ${scriptPath}: ${err?.message}`); return null; }
  if (typeof mod[exportName] !== 'function') { bad(`${scriptPath} missing export ${exportName}()`); return null; }
  return mod;
}

/**
 * Write a minimal docs/.public-projection.json into a fixture root.
 * Banned token: "nolrm/contextkit". Internal dir: contextkit/memory.
 *
 * @param {string} root - Fixture root path.
 */
function writeProjection(root) {
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });
  const policy = {
    version: 1,
    publicPaths: ['docs'],
    internalPaths: ['contextkit/memory'],
    bannedTokens: [{ id: 'inspiration-nolrm', pattern: 'nolrm/contextkit', flags: 'g', reason: 'Banned token test.' }],
    secretShaped: [],
    allow: [],
  };
  writeFileSync(join(docsDir, '.public-projection.json'), JSON.stringify(policy, null, 2));
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** 1. lint BLOCKS on a seeded banned token. */
async function assertLintBlocks() {
  console.log('\nAssertion 1: lint blocks on a seeded banned token...');
  const root = makeTempDir();
  writeProjection(root);
  writeFileSync(join(root, 'docs', 'pub.md'), '# Doc\n\nReferences nolrm/contextkit here.\n');
  const r = run([resolve(SCRIPTS, 'docs-public-lint.mjs'), '--root', root]);
  r.status !== 0 ? ok('lint exits 1 on a banned token in a public file') : bad(`lint exited 0 (expected 1). stdout: ${r.stdout.trim()}`);
}

/** 2. lint is CLEAN on the real tree — library API path (proves internalPaths exclusion). */
async function assertLintSkipsInternal() {
  console.log('\nAssertion 2: lint clean — real tree, library API...');
  const mod = await importScript(resolve(SCRIPTS, 'docs-public-lint.mjs'), 'lintPublicDocs');
  if (!mod) return;
  let result;
  try { result = mod.lintPublicDocs(KIT); } catch (err) { bad(`lintPublicDocs threw: ${err?.message}`); return; }
  if (result.ok) {
    ok('lintPublicDocs(root) → ok:true (internal paths not scanned)');
  } else {
    bad(`lintPublicDocs found ${result.hits.length} hit(s):`);
    for (const { file, line, token } of result.hits) console.error(`       ${file}:${line} [${token}]`);
  }
}

/** 3. lint is CLEAN on the real tree — CLI path. */
function assertLintCleanCli() {
  console.log('\nAssertion 3: lint clean on real tree (CLI)...');
  const r = run([resolve(SCRIPTS, 'docs-public-lint.mjs'), '--root', KIT]);
  r.status === 0 ? ok('lint CLI exits 0 on real tree') : bad(`lint CLI exited ${r.status}. stdout: ${r.stdout.trim()}`);
}

/** 4. readme-claims FAILS on a deliberately wrong forge count. */
async function assertClaimsFails() {
  console.log('\nAssertion 4: readme-claims fails on wrong forge count...');
  const root = makeTempDir();
  writeFileSync(join(root, 'README.md'), '# Kit\n\nIt includes forge-new and 99 lifecycle commands.\n');
  const forgeDir = join(root, 'templates', 'claude', 'commands', 'forge');
  mkdirSync(forgeDir, { recursive: true });
  // Only 2 lifecycle commands exist — README claims 99.
  writeFileSync(join(forgeDir, 'forge-new.md'), '# forge-new\n');
  writeFileSync(join(forgeDir, 'forge-show.md'), '# forge-show\n');
  writeFileSync(join(forgeDir, 'forge-audit.md'), '# forge-audit\n');
  const mod = await importScript(resolve(SCRIPTS, 'readme-claims.mjs'), 'checkReadmeClaims');
  if (!mod) return;
  let result;
  try { result = await mod.checkReadmeClaims(root); } catch (err) { bad(`checkReadmeClaims threw: ${err?.message}`); return; }
  !result.ok && result.mismatches.length > 0
    ? ok(`readme-claims correctly fails on wrong count (${result.mismatches.length} mismatch(es))`)
    : bad(`readme-claims should have failed but returned ok:${result.ok}`);
}

/** 5. readme-claims PASSES on the real tree. */
async function assertClaimsPasses() {
  console.log('\nAssertion 5: readme-claims passes on real tree...');
  const mod = await importScript(resolve(SCRIPTS, 'readme-claims.mjs'), 'checkReadmeClaims');
  if (!mod) return;
  let result;
  try { result = await mod.checkReadmeClaims(KIT); } catch (err) { bad(`checkReadmeClaims threw: ${err?.message}`); return; }
  if (result.ok) {
    ok('readme-claims passes on the real tree');
  } else {
    bad(`readme-claims found ${result.mismatches.length} mismatch(es) on real tree`);
    for (const { claim, readmeValue, actualValue, source } of result.mismatches) {
      console.error(`       [${claim}] README=${JSON.stringify(readmeValue)}, actual=${JSON.stringify(actualValue)} (${source})`);
    }
  }
}

/** 6. docs-reindex idempotency: two consecutive runs produce identical output. */
async function assertReindexIdempotent() {
  console.log('\nAssertion 6: docs-reindex idempotency...');
  const mod = await importScript(resolve(SCRIPTS, 'docs-reindex.mjs'), 'reindexDocs');
  if (!mod) return;
  const indexPath = resolve(KIT, 'docs', 'README.md');
  if (!existsSync(indexPath)) { bad('docs/README.md missing'); return; }
  const committed = readFileSync(indexPath);
  let first, second;
  try {
    mod.reindexDocs(KIT); first = readFileSync(indexPath);
    mod.reindexDocs(KIT); second = readFileSync(indexPath);
  } catch (err) {
    writeFileSync(indexPath, committed);
    bad(`reindexDocs threw: ${err?.message}`);
    return;
  }
  writeFileSync(indexPath, committed);
  first.equals(second)
    ? ok('docs-reindex idempotent — two runs produce identical output')
    : bad(`docs-reindex NOT idempotent — run1 length ${first.length}, run2 length ${second.length}`);
}

/** 7. validate-doc is ADVISORY: exits 0 without CI opt-in. */
async function assertValidateDocAdvisory() {
  console.log('\nAssertion 7: validate-doc advisory (exits 0 without CI opt-in)...');
  const validatePath = resolve(SCRIPTS, 'validate-doc.mjs');
  if (!existsSync(validatePath)) {
    // validate-doc is a separate ticket — report skip explicitly, never silent pass.
    console.log('  SKIPPED — validate-doc.mjs not shipped yet; this check is deferred.');
    return;
  }
  const root = makeTempDir();
  const poorDoc = join(root, 'poor.md');
  writeFileSync(poorDoc, 'short doc\n');
  const r = run([validatePath, poorDoc], root);
  r.status === 0 ? ok('validate-doc exits 0 (advisory) on low-quality doc without CI opt-in') : bad(`validate-doc exited ${r.status} without CI opt-in — expected advisory/0. stderr: ${r.stderr.trim()}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\nintegration-test-docs — DOC-007 behavioral assertions\n');
  try {
    await assertLintBlocks();
    await assertLintSkipsInternal();
    assertLintCleanCli();
    await assertClaimsFails();
    await assertClaimsPasses();
    await assertReindexIdempotent();
    await assertValidateDocAdvisory();
  } finally {
    cleanup();
  }
  const total = passes + failures;
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${passes}/${total} checks passed.\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { cleanup(); console.error(`integration-test-docs: fatal — ${err?.message ?? err}`); process.exit(1); });
