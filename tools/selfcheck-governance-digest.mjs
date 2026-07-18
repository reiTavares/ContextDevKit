#!/usr/bin/env node
/**
 * Self-check — governance-digest generator (WF-0070 / ADR-0132 §2).
 *
 * HERMETIC: builds its own temp memory fixture (business/operation/workflow/ADR/
 * session/deliberation) and asserts the digest surfaces each one. It does NOT read
 * the ambient dogfood `contextkit/memory/` — that tree is gitignored, so it is
 * absent in a worktree / fresh clone / CI, where an ambient-dependent assertion
 * would spuriously fail (the rebase-into-worktree bug this rewrite fixes).
 *
 * Asserts the query-first projection invariants:
 *   (1) generateDigest(fixture) has a heading for EACH entity kind and surfaces the
 *       fixture's entities (BIZ-9001, OP-9001, WF-9001, ADR-9001, session,
 *       deliberation).
 *   (2) Determinism: two calls on the same tree are byte-identical (no clock in body).
 *   (3) Fail-open: a bare temp dir with NO memory tree returns a string with
 *       "_none_" sections and never throws (constitution §8).
 *   (4) writeDigest writes _contextkit/governance-digest.{md,json} atomically.
 *
 * Standalone: node tools/selfcheck-governance-digest.mjs  (exit 0 = pass).
 * Zero runtime deps — node:* only.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const MOD_URL = pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/governance-digest.mjs')).href;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

console.log('\n🧭 self-check — governance digest (WF-0070 / ADR-0132)\n');

/**
 * Materializes a minimal, deterministic memory tree covering every entity kind
 * the digest projects. Returns the temp project root (caller removes it).
 * @returns {string} absolute temp root with a contextkit/memory/ fixture.
 */
function buildFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ck-digest-fix-'));
  const mem = resolve(root, 'contextkit', 'memory');
  const mk = (p) => mkdirSync(resolve(mem, p), { recursive: true });
  const wf = (p, c) => writeFileSync(resolve(mem, p), c, 'utf-8');
  mk('business/BIZ-9001-fixture');
  wf('business/BIZ-9001-fixture/business.json', JSON.stringify({ id: 'BIZ-9001', status: 'proposed', title: 'Fixture Business' }));
  mk('operations/OP-9001-fixture');
  wf('operations/OP-9001-fixture/operation.json', JSON.stringify({ id: 'OP-9001', status: 'active', title: 'Fixture Operation' }));
  mk('operations/OP-9001-fixture/workflows/WF-9001-fixture');
  wf('operations/OP-9001-fixture/workflows/WF-9001-fixture/workflow-state.json', JSON.stringify({ status: 'ship' }));
  mk('decisions');
  wf('decisions/9001-fixture-adr.md', '# Fixture ADR\n**Status:** Accepted\n');
  mk('sessions');
  wf('sessions/2026-01-01-01-fixture-session.md', '# Fixture session\n');
  mk('deliberations');
  wf('deliberations/2026-01-01-fixture-topic.md', '# Fixture deliberation\n');
  return root;
}

let generateDigest, writeDigest, buildDigestModel;
try {
  ({ generateDigest, writeDigest, buildDigestModel } = await import(MOD_URL));
  ok('governance-digest.mjs imports (generateDigest / writeDigest / buildDigestModel)');
} catch (err) {
  bad(`import failed: ${err.message}`);
  process.exit(1);
}

// (1) hermetic fixture: every entity kind heading + every fixture entity surfaced.
const fixture = buildFixture();
try {
  const digest = generateDigest(fixture);
  const headings = ['## Business', '## Operations', '## Workflows', '## ADRs', '## Recent sessions', '## Deliberations'];
  const missingHeading = headings.filter((h) => !digest.includes(h));
  missingHeading.length === 0
    ? ok('digest has a heading for every entity kind')
    : bad(`digest missing heading(s): ${missingHeading.join(', ')}`);
  const entities = ['BIZ-9001', 'OP-9001', 'WF-9001', 'ADR-9001', '2026-01-01-01-fixture-session', '2026-01-01-fixture-topic'];
  const missingEntity = entities.filter((e) => !digest.includes(e));
  missingEntity.length === 0
    ? ok('digest surfaces every fixture entity (BIZ/OP/WF/ADR/session/deliberation)')
    : bad(`digest missing entity/entities: ${missingEntity.join(', ')}`);
  digest.length > 200 ? ok(`digest is non-trivial (${digest.length} chars)`) : bad('digest is suspiciously short');

  // (2) determinism on the fixture tree.
  generateDigest(fixture) === generateDigest(fixture)
    ? ok('two calls are byte-identical (deterministic)')
    : bad('digest is non-deterministic across calls');

  // (4) writeDigest persists _contextkit/governance-digest.{md,json} into the fixture.
  const paths = writeDigest(fixture);
  existsSync(paths.md) && readFileSync(paths.md, 'utf-8').includes('# Governance digest')
    ? ok('writeDigest wrote _contextkit/governance-digest.md')
    : bad('writeDigest did not write the markdown digest');
  existsSync(paths.json) && Array.isArray(JSON.parse(readFileSync(paths.json, 'utf-8')).business)
    ? ok('writeDigest wrote a parseable _contextkit/governance-digest.json')
    : bad('writeDigest did not write valid JSON');
} catch (err) {
  bad(`fixture digest checks threw: ${err.message}`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// (3) fail-open on a bare dir (no contextkit/memory tree).
try {
  const bare = mkdtempSync(resolve(tmpdir(), 'ck-digest-bare-'));
  try {
    const digest = generateDigest(bare);
    typeof digest === 'string' && digest.includes('_none_')
      ? ok('fail-open: bare dir returns a string with _none_ sections (no throw)')
      : bad('fail-open digest did not degrade to _none_ sections');
    const model = buildDigestModel(bare);
    model.business.length === 0 && model.workflows.length === 0
      ? ok('fail-open model is empty for a bare dir')
      : bad('fail-open model unexpectedly non-empty');
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
} catch (err) {
  bad(`fail-open check threw (must never throw): ${err.message}`);
}

console.log(failures === 0 ? '\n✅ governance digest self-check passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
