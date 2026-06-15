#!/usr/bin/env node
/**
 * Standalone integration test for CDK-052 — the executable context manifest.
 *
 * Builds a temporary fixture tree (a couple of fake decisions / sessions /
 * glossary rows / a project-map manifest / a playbook), then asserts the four
 * contract guarantees of `context-manifest.mjs`:
 *   (1) DETERMINISM — two `resolveManifest(root, objective)` calls are byte-identical;
 *   (2) BOUNDED — total entries ≤ cap;
 *   (3) NO BODY LEAK — a sentinel body string planted in fixtures is absent from
 *       the serialized manifest (only its title/path surface);
 *   (4) FAIL-OPEN — a root with no memory dir ⇒ empty sections, no throw.
 *
 * Run: node tools/integration-test-pkg05-052.mjs   (exits 0 on PASS, 1 on FAIL)
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveManifest,
  renderManifest,
  exportManifest,
  DEFAULT_CAP,
} from '../templates/contextkit/tools/scripts/context-manifest.mjs';

/** Sentinel that MUST NEVER appear in the manifest (it lives only in file bodies). */
const SENTINEL = 'SECRET_BODY_DO_NOT_LEAK_8f3a2b1c';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
};

/** Materialize a memory tree under `root` with body sentinels in every file. */
async function buildFixture(root) {
  const memory = join(root, 'contextkit', 'memory');
  await mkdir(join(memory, 'decisions'), { recursive: true });
  await mkdir(join(memory, 'sessions'), { recursive: true });
  await mkdir(join(memory, 'project-map'), { recursive: true });
  await mkdir(join(root, 'contextkit', 'workflows', 'playbooks'), { recursive: true });

  await writeFile(join(memory, 'decisions', '0001-pick-a-stack.md'),
    `# ADR-0001: Pick a stack\n\n- Status: Accepted\n\n## Decision\n\n${SENTINEL} we chose node.\n`);
  await writeFile(join(memory, 'decisions', '0002-bound-the-budget.md'),
    `# ADR-0002: Bound the budget gate\n\n- Status: Accepted\n\n## Decision\n\n${SENTINEL} cap it.\n`);

  await writeFile(join(memory, 'sessions', '2026-06-15-01-first-session.md'),
    `# Session 1 — First session\n\n- Date: 2026-06-15\n\n## Request\n\n${SENTINEL} do the thing.\n`);

  await writeFile(join(memory, 'GLOSSARY.md'),
    '# Glossary — domain term ↔ code identifier\n\n' +
    '| Domain term (UI / business) | Code identifier | Notes |\n| --- | --- | --- |\n' +
    `| budget gate | \`budgetGate\` | ${SENTINEL} note |\n` +
    `| copper | \`ruivo\` | ${SENTINEL} note |\n`);

  await writeFile(join(memory, 'project-map', 'manifest.json'),
    JSON.stringify({ name: 'fix', signature: 'abcd1234', modules: [
      { path: 'src/a', deps: [] }, { path: 'src/b', deps: ['src/a'] },
    ], note: SENTINEL }, null, 2));

  await writeFile(join(root, 'contextkit', 'workflows', 'playbooks', 'budget-sweep.md'),
    `# Playbook — Budget sweep\n\n> ${SENTINEL} steps here.\n`);
}

async function run() {
  const root = await mkdtemp(join(tmpdir(), 'cdk052-'));
  try {
    await buildFixture(root);

    // (1) Determinism — same (root, objective) ⇒ byte-identical serialization.
    const objective = 'fix the budget gate';
    const first = JSON.stringify(await resolveManifest(root, objective));
    const second = JSON.stringify(await resolveManifest(root, objective));
    assert(first === second, 'two resolveManifest calls are byte-identical (determinism)');

    const manifest = await resolveManifest(root, objective);
    assert(manifest.signature && /^[0-9a-f]{8}$/.test(manifest.signature), 'signature is a stable 8-char hash');
    assert(manifest.generatedFor === objective, 'generatedFor records the objective');

    // (2) Bounded — total entries ≤ cap (test with a tiny cap to force trimming).
    const capped = await resolveManifest(root, objective, { cap: 3 });
    const total = capped.sections.decisions.length + capped.sections.sessions.length +
      capped.sections.glossary.length + capped.sections.playbooks.length +
      (capped.sections.projectMap ? 1 : 0);
    assert(total <= 3, `total entries (${total}) within cap of 3`);
    const defaultTotal = manifest.sections.decisions.length + manifest.sections.sessions.length +
      manifest.sections.glossary.length + manifest.sections.playbooks.length +
      (manifest.sections.projectMap ? 1 : 0);
    assert(defaultTotal <= DEFAULT_CAP, `default total (${defaultTotal}) within DEFAULT_CAP ${DEFAULT_CAP}`);

    // (3) No body leak — sentinel absent from JSON + rendered markdown; titles present.
    const serialized = JSON.stringify(manifest) + '\n' + renderManifest(manifest);
    assert(!serialized.includes(SENTINEL), 'serialized manifest does NOT contain the body sentinel');
    assert(serialized.includes('Bound the budget gate'), 'ADR title surfaces (metadata only)');
    assert(serialized.includes('budget gate'), 'glossary term surfaces (metadata only)');
    assert(serialized.includes('Budget sweep'), 'playbook title surfaces (metadata only)');
    assert(manifest.sections.projectMap && manifest.sections.projectMap.moduleCount === 2,
      'project-map reports moduleCount only (2), not module bodies');

    // Objective bias: the budget ADR scores higher than the stack ADR → ranked first.
    assert(manifest.sections.decisions[0]?.id === '0002', 'objective biases the budget ADR to the top');

    // exportManifest writes atomically and returns the md path.
    const written = await exportManifest(root, objective);
    assert(written.endsWith('context-manifest.md'), 'exportManifest returns the md path');

    // (4) Fail-open — a root with no memory dir ⇒ empty sections, no throw.
    const emptyRoot = await mkdtemp(join(tmpdir(), 'cdk052-empty-'));
    try {
      const empty = await resolveManifest(emptyRoot, 'anything');
      assert(empty.sections.decisions.length === 0 && empty.sections.sessions.length === 0 &&
        empty.sections.glossary.length === 0 && empty.sections.playbooks.length === 0 &&
        empty.sections.projectMap === null, 'missing dirs ⇒ empty sections, no throw');
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  if (failures) {
    console.error(`\n❌ CDK-052 manifest test: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\n✅ CDK-052 manifest test PASSED.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((err) => {
    console.error('❌ CDK-052 test crashed:', err?.stack ?? err);
    process.exit(1);
  });
}
