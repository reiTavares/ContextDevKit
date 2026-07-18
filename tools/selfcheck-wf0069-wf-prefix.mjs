#!/usr/bin/env node
/**
 * WF-0069 self-check (OP-0008 Finding #8 / card #385) — spec-pack createWorkflow
 * must give an OWNED workflow dir the `WF-` prefix so the registry's NEW_RE
 * matches it and the owner survives into resolveWorkflow (an unprefixed owned dir
 * falls to LEGACY_RE, which hardcodes owner:null — the bug this guards).
 *
 * Asserts:
 *   (1) createWorkflow for an OWNED (OP-####) workflow names the dir `WF-####-slug`.
 *   (2) buildWorkflowRegistry + resolveWorkflow('WF-####') returns a row whose
 *       owner is the owning OP context (NOT null), format 'new'.
 *   (3) Regression guard: the created dir name starts with `WF-` (this FAILS
 *       against the old `${number}-${slug}` naming).
 *
 * Standalone runnable: node tools/selfcheck-wf0069-wf-prefix.mjs
 * Exit 0 on all-pass, 1 on any failure. Zero deps — node:* + templates source.
 */
import { mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const src = (rel) => pathToFileURL(resolve(KIT, 'templates/contextkit', rel)).href;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };

let createWorkflow, pathsFor, buildWorkflowRegistry, resolveWorkflow, nextWorkflowNumber;
try {
  ({ createWorkflow } = await import(src('tools/scripts/workflow-pack.mjs')));
  ({ pathsFor } = await import(src('runtime/config/paths.mjs')));
  ({ buildWorkflowRegistry, resolveWorkflow } = await import(src('tools/scripts/registry/workflow.mjs')));
  ({ nextWorkflowNumber } = await import(src('tools/scripts/registry/ids.mjs')));
  ok('workflow-pack + registry import cleanly');
} catch (err) {
  console.error(`FATAL: import failed: ${err?.message ?? err}`);
  process.exit(1);
}

console.log('\nWF-0069 #8 — owned workflow dir carries the WF- prefix + owner survives\n');

const root = mkdtempSync(resolve(tmpdir(), 'ckit-wf0069-prefix-'));
try {
  try { execSync('git init -b main', { cwd: root, stdio: 'pipe' }); }
  catch { try { execSync('git init', { cwd: root, stdio: 'pipe' }); } catch { /* best-effort */ } }

  const paths = pathsFor(root);
  const OWNER = 'OP-0001';
  // The owner context folder must exist for ownerWorkflowsDir() to nest under it.
  const ownerWfDir = resolve(paths.operations, `${OWNER}-fixture`, 'workflows');
  mkdirSync(ownerWfDir, { recursive: true });

  const expectedNumber = nextWorkflowNumber(root); // e.g. "0001"
  createWorkflow(root, 'owned-flow', 'feature', OWNER);

  // (1) + (3) the created dir under the owner carries the WF- prefix.
  const created = readdirSync(ownerWfDir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  const dirName = created[0] ?? '';
  dirName.startsWith('WF-')
    ? ok(`owned dir is WF-prefixed: "${dirName}"`)
    : bad(`owned dir MUST start with WF- (got "${dirName}") — regresses to owner:null`);
  dirName === `WF-${expectedNumber}-owned-flow`
    ? ok(`dir name matches WF-${expectedNumber}-owned-flow (mirrors workflow/create.mjs)`)
    : bad(`dir name "${dirName}" != expected WF-${expectedNumber}-owned-flow`);

  // (2) the registry resolves the workflow WITH its owner (not null).
  const registry = buildWorkflowRegistry(root);
  const row = resolveWorkflow(registry, `WF-${expectedNumber}`);
  row
    ? ok(`resolveWorkflow('WF-${expectedNumber}') returns a row (format='${row.format}')`)
    : bad(`resolveWorkflow('WF-${expectedNumber}') returned null — NEW_RE missed the dir`);
  if (row) {
    row.owner === OWNER
      ? ok(`owner survives: row.owner='${row.owner}' (not null)`)
      : bad(`owner LOST: row.owner='${row.owner}' expected '${OWNER}'`);
    row.format === 'new'
      ? ok("row.format is 'new' (matched NEW_RE, not LEGACY_RE)")
      : bad(`row.format='${row.format}' — fell to legacy indexing`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? '\n  PASS — WF-0069 #8 WF-prefix self-check: all checks passed.\n'
    : `\n  FAIL — WF-0069 #8 WF-prefix self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
