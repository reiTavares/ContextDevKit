#!/usr/bin/env node
/**
 * CDK-071 self-check — lineage-public core + CLI integration.
 *
 * Asserts five invariants:
 *   (1) projectPublicLineage returns adrs with ONLY {number,title,status,decision} keys.
 *   (2) SAFETY-CRITICAL: full JSON output contains neither the fixture receipt
 *       fingerprint 'SECRET_FP_123' nor the fixture session id nor 'ownerSessionId'.
 *   (3) redacted is non-empty and lists field families.
 *   (4) Fail-open on a bare root (no contextkit) → no throw, adrs empty,
 *       sources.skipped non-empty.
 *   (5) CLI `node lineage-public.mjs --json` exits 0 + parseable JSON.
 *
 * Standalone runnable: node tools/selfcheck-pkg07-071.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');

const IO_PATH = resolve(KIT, 'templates/contextkit/tools/scripts/lineage-public.mjs');
const IO_URL  = pathToFileURL(IO_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import the public projection module
// ---------------------------------------------------------------------------
let projectPublicLineage;
try {
  ({ projectPublicLineage } = await import(IO_URL));
  ok('lineage-public.mjs imports cleanly');
} catch (importErr) {
  console.error(`FATAL: cannot import lineage-public.mjs: ${importErr?.message ?? importErr}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------
const FIXTURE_ADR_NUM    = '0071';
const FIXTURE_WF_SLUG    = 'public-lineage';
const FIXTURE_CARD_ID    = 'CDK-071';
const FIXTURE_SESS_NUM   = '99';
const FIXTURE_CAP        = 'selfcheck-cap';
const FIXTURE_BRANCH     = 'main';
const FIXTURE_FINGERPRINT = 'SECRET_FP_123';

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

/**
 * Creates a minimal seeded fixture under a temp dir and git-inits it.
 * Includes an ADR, a workflow, a card, a state.json (with ownerSessionId),
 * a receipt (with a distinctive fingerprint), and a session file.
 *
 * @returns {string} absolute path to the fixture root
 */
function buildFixtureRoot() {
  const fixtureRoot = resolve(tmpdir(), `selfcheck-public-071-${Date.now()}`);
  mkdirSync(fixtureRoot, { recursive: true });

  try { execSync('git init -b main', { cwd: fixtureRoot, stdio: 'pipe' }); } catch {
    try { execSync('git init', { cwd: fixtureRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
  }

  const ckPath = (rel) => resolve(fixtureRoot, 'contextkit', rel);

  // ADR
  mkdirSync(ckPath('memory/decisions'), { recursive: true });
  writeFileSync(
    ckPath(`memory/decisions/${FIXTURE_ADR_NUM}-public-lineage.md`),
    `# ADR-${FIXTURE_ADR_NUM} — Public ADR Projection\n\n**Status:** Accepted\n\n## Context\n\nWe need a public view.\n\n## Decision\n\nBuild CDK-071 redact layer.\n\n`,
  );

  // Workflow with a phase ref containing the ADR number
  mkdirSync(ckPath(`memory/workflows/${FIXTURE_WF_SLUG}`), { recursive: true });
  writeFileSync(
    ckPath(`memory/workflows/${FIXTURE_WF_SLUG}/index.md`),
    `---\nslug: ${FIXTURE_WF_SLUG}\nkind: feature\nnumber: 0029\n` +
    `started: 2026-01-01T00:00:00.000Z\nbranch: ${FIXTURE_BRANCH}\ncurrentPhase: spec\n` +
    `intake: done\nintake-ref: ADR-${FIXTURE_ADR_NUM}\nprd: done\nprd-ref: \nspec: pending\nspec-ref: \n---\n\n` +
    `# Workflow - ${FIXTURE_WF_SLUG}\n\n`,
  );

  // Pipeline card
  for (const stage of ['backlog', 'working', 'testing', 'conclusion']) {
    mkdirSync(ckPath(`pipeline/${stage}`), { recursive: true });
  }
  writeFileSync(
    ckPath(`pipeline/working/${FIXTURE_CARD_ID}-public-lineage.md`),
    `---\nid: ${FIXTURE_CARD_ID}\ntitle: Public lineage projection\nworkflow: ${FIXTURE_WF_SLUG}\ntype: feature\npriority: P1\n---\n\n# CDK-071\n\n`,
  );

  // state.json with ownerSessionId (must NOT appear in public output)
  mkdirSync(ckPath(`pipeline/state/${FIXTURE_CARD_ID}`), { recursive: true });
  writeFileSync(
    ckPath(`pipeline/state/${FIXTURE_CARD_ID}/state.json`),
    JSON.stringify({
      kind: 'task', id: FIXTURE_CARD_ID, status: 'working',
      ownerSessionId: FIXTURE_SESS_NUM, ownerUser: 'test',
      branch: FIXTURE_BRANCH, startedAt: Date.now(), lastHeartbeat: Date.now(),
      endedAt: null, cycles: {}, events: [],
    }, null, 2),
  );

  // Receipt with a distinctive fingerprint (must NOT appear in public output)
  mkdirSync(ckPath(`pipeline/state/${FIXTURE_CARD_ID}/receipts`), { recursive: true });
  writeFileSync(
    ckPath(`pipeline/state/${FIXTURE_CARD_ID}/receipts/${FIXTURE_CAP}.json`),
    JSON.stringify({
      version: 1, capability: FIXTURE_CAP, taskId: FIXTURE_CARD_ID,
      sessionId: FIXTURE_SESS_NUM, runId: 'run-071',
      command: 'node', host: 'claude-code-test', result: 'passed',
      evidence: { exitCode: 0 },
      scope: { branch: FIXTURE_BRANCH },
      fingerprint: FIXTURE_FINGERPRINT,
      createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    }, null, 2),
  );

  // Session file
  mkdirSync(ckPath('memory/sessions'), { recursive: true });
  writeFileSync(
    ckPath(`memory/sessions/2026-01-01-${FIXTURE_SESS_NUM.padStart(2, '0')}-public-lineage.md`),
    `# Public lineage session\n\nBuilt CDK-071.\n`,
  );

  return fixtureRoot;
}

/**
 * Removes the fixture directory recursively. Best-effort.
 * @param {string} fixtureRoot
 */
function cleanFixture(fixtureRoot) {
  try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// (1) adrs contain ONLY {number, title, status, decision} keys
// ---------------------------------------------------------------------------
console.log('\n(1) projectPublicLineage: adrs projected to public keys only\n');

let fixtureRoot;
let publicLineage;
try {
  fixtureRoot = buildFixtureRoot();
  publicLineage = await projectPublicLineage(fixtureRoot);
  ok('projectPublicLineage completed without throwing');
} catch (callErr) {
  bad(`projectPublicLineage threw unexpectedly: ${callErr?.message ?? callErr}`);
  process.exit(failures > 0 ? 1 : 0);
}

const ALLOWED_ADR_KEYS = new Set(['number', 'title', 'status', 'decision']);
let allAdrKeysClean = true;
for (const adr of (publicLineage.adrs ?? [])) {
  for (const key of Object.keys(adr)) {
    if (!ALLOWED_ADR_KEYS.has(key)) {
      bad(`adr object contains forbidden key '${key}' — only {number,title,status,decision} allowed`);
      allAdrKeysClean = false;
    }
  }
}
if (allAdrKeysClean) {
  ok(`all adr objects contain only {number,title,status,decision} (${publicLineage.adrs.length} ADR(s))`);
}
publicLineage.adrs.length >= 1
  ? ok(`at least 1 adr in public view (got ${publicLineage.adrs.length})`)
  : bad('expected ≥1 adr in public view — fixture ADR not projected');

// ---------------------------------------------------------------------------
// (2) SAFETY-CRITICAL: no internal leak in full JSON serialization
// ---------------------------------------------------------------------------
console.log('\n(2) SAFETY-CRITICAL: no internal fields leak into public JSON output\n');

const fullJson = JSON.stringify(publicLineage);

!fullJson.includes(FIXTURE_FINGERPRINT)
  ? ok(`receipt fingerprint '${FIXTURE_FINGERPRINT}' NOT present in public JSON (redacted)`)
  : bad(`LEAK: receipt fingerprint '${FIXTURE_FINGERPRINT}' found in public JSON output`);

!fullJson.includes(`"${FIXTURE_SESS_NUM}"`)
  ? ok(`session id '${FIXTURE_SESS_NUM}' NOT present in public JSON (redacted)`)
  : bad(`LEAK: session id '${FIXTURE_SESS_NUM}' found in public JSON output`);

!fullJson.includes('ownerSessionId')
  ? ok("'ownerSessionId' NOT present in public JSON (redacted)")
  : bad("LEAK: 'ownerSessionId' found in public JSON output");

// ---------------------------------------------------------------------------
// (3) redacted is non-empty and lists field families
// ---------------------------------------------------------------------------
console.log('\n(3) redacted array is non-empty and lists field families\n');

Array.isArray(publicLineage.redacted) && publicLineage.redacted.length > 0
  ? ok(`redacted has ${publicLineage.redacted.length} entries: ${publicLineage.redacted.join(', ')}`)
  : bad('expected non-empty redacted array of field families');

// ---------------------------------------------------------------------------
// (4) Fail-open: bare root (no contextkit) → no throw, adrs empty, skipped non-empty
// ---------------------------------------------------------------------------
console.log('\n(4) Fail-open: bare root (no contextkit) — no throw, sources.skipped non-empty\n');

const bareRoot = resolve(tmpdir(), `selfcheck-public-071-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
try { execSync('git init -b main', { cwd: bareRoot, stdio: 'pipe' }); } catch {
  try { execSync('git init', { cwd: bareRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
}

let barePublic = null;
try {
  barePublic = await projectPublicLineage(bareRoot);
  ok('projectPublicLineage on bare root: no throw (fail-open)');
} catch (bareErr) {
  bad(`projectPublicLineage on bare root threw: ${bareErr?.message ?? bareErr}`);
}

if (barePublic) {
  (barePublic.adrs ?? []).length === 0
    ? ok('bare root: adrs is empty (no ADRs to project)')
    : bad(`bare root: expected 0 adrs, got ${barePublic.adrs.length}`);

  const skipped = barePublic.sources?.skipped ?? [];
  skipped.length > 0
    ? ok(`bare root: sources.skipped is non-empty (${skipped.join(', ')})`)
    : bad('bare root: expected non-empty sources.skipped');
}
cleanFixture(bareRoot);

// ---------------------------------------------------------------------------
// (5) CLI: node lineage-public.mjs --json exits 0 and prints parseable JSON
// ---------------------------------------------------------------------------
console.log('\n(5) CLI: node lineage-public.mjs --json exits 0 + parseable JSON\n');

const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], {
  cwd: fixtureRoot,
  encoding: 'utf-8',
  timeout: 30_000,
});

cliResult.status === 0
  ? ok('CLI: exit code 0')
  : bad(`CLI: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 200)}`);

let parsedCli = null;
try {
  parsedCli = JSON.parse(cliResult.stdout);
  ok('CLI: stdout is valid JSON');
} catch (parseErr) {
  bad(`CLI: stdout is not parseable JSON: ${parseErr?.message ?? parseErr}`);
}

if (parsedCli) {
  Array.isArray(parsedCli.adrs)
    ? ok(`CLI JSON: adrs array present (${parsedCli.adrs.length} entries)`)
    : bad('CLI JSON: expected adrs[] in output');

  typeof parsedCli.schemaVersion === 'string'
    ? ok(`CLI JSON: schemaVersion present ('${parsedCli.schemaVersion}')`)
    : bad('CLI JSON: expected schemaVersion string in output');
}

cleanFixture(fixtureRoot);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-071 lineage-public self-check: all checks passed.\n'
    : `\n  FAIL — CDK-071 lineage-public self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
