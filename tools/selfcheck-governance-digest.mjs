#!/usr/bin/env node
/**
 * Self-check — governance-digest generator (WF-0070 / ADR-0132 §2).
 *
 * Asserts the query-first projection invariants:
 *   (1) generateDigest(<repo-root>) returns a non-empty string with a heading for
 *       EACH entity kind (Business, Operations, Workflows, ADRs, sessions,
 *       Deliberations) and surfaces the real dogfood entities (BIZ-0001, OP-0008,
 *       WF-0070, ADR-0132).
 *   (2) Determinism: two calls are byte-identical (no clock in the body).
 *   (3) Fail-open: a bare temp dir with NO memory tree returns a string with
 *       "_none_" sections and never throws (constitution §8).
 *   (4) writeDigest writes _contextkit/governance-digest.{md,json} atomically.
 *
 * Standalone: node tools/selfcheck-governance-digest.mjs  (exit 0 = pass).
 * Zero runtime deps — node:* only.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

let generateDigest, writeDigest, buildDigestModel;
try {
  ({ generateDigest, writeDigest, buildDigestModel } = await import(MOD_URL));
  ok('governance-digest.mjs imports (generateDigest / writeDigest / buildDigestModel)');
} catch (err) {
  bad(`import failed: ${err.message}`);
  process.exit(1);
}

// (1) real-repo digest surfaces every entity kind + known dogfood entities.
try {
  const digest = generateDigest(KIT);
  const headings = ['## Business', '## Operations', '## Workflows', '## ADRs', '## Recent sessions', '## Deliberations'];
  const missingHeading = headings.filter((h) => !digest.includes(h));
  missingHeading.length === 0
    ? ok('digest has a heading for every entity kind')
    : bad(`digest missing heading(s): ${missingHeading.join(', ')}`);
  const entities = ['BIZ-0001', 'OP-0008', 'WF-0070', 'ADR-0132'];
  const missingEntity = entities.filter((e) => !digest.includes(e));
  missingEntity.length === 0
    ? ok('digest surfaces the real dogfood entities (BIZ-0001, OP-0008, WF-0070, ADR-0132)')
    : bad(`digest missing entity/entities: ${missingEntity.join(', ')}`);
  digest.length > 200 ? ok(`digest is non-trivial (${digest.length} chars)`) : bad('digest is suspiciously short');
} catch (err) {
  bad(`generateDigest(repo) threw: ${err.message}`);
}

// (2) determinism.
try {
  generateDigest(KIT) === generateDigest(KIT)
    ? ok('two calls are byte-identical (deterministic)')
    : bad('digest is non-deterministic across calls');
} catch (err) {
  bad(`determinism check threw: ${err.message}`);
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

// (4) writeDigest persists _contextkit/governance-digest.{md,json}.
try {
  const paths = writeDigest(KIT);
  existsSync(paths.md) && readFileSync(paths.md, 'utf-8').includes('# Governance digest')
    ? ok('writeDigest wrote _contextkit/governance-digest.md')
    : bad('writeDigest did not write the markdown digest');
  existsSync(paths.json) && JSON.parse(readFileSync(paths.json, 'utf-8')).business
    ? ok('writeDigest wrote a parseable _contextkit/governance-digest.json')
    : bad('writeDigest did not write valid JSON');
} catch (err) {
  bad(`writeDigest threw: ${err.message}`);
}

console.log(failures === 0 ? '\n✅ governance digest self-check passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
