#!/usr/bin/env node
/**
 * Self-test for rationale-nodes.mjs (SR1, WF-0073/BIZ-0004) — standalone
 * entrypoint (exit 0/1), sibling-dispatched like the other WF-0073 selfchecks.
 *
 * Asserts the LINKS verb: ADR files become adr:#### rationale nodes; a literal
 * ADR-#### reference in source becomes a DETERMINISTIC cites edge to that node;
 * a reference to an UNKNOWN ADR is dropped (no dangling edge, no fabricated
 * rationale); output is deterministic; an absent corpus degrades to empty.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/rationale-nodes.mjs');

/** Temp root with a decisions corpus (2 ADRs) + source that cites one real + one unknown. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rationale-'));
  const dec = join(root, 'contextkit', 'memory', 'decisions', 'business');
  mkdirSync(dec, { recursive: true });
  writeFileSync(join(dec, 'ADR-0201-alpha.md'), '# ADR-0201\n', 'utf-8');
  writeFileSync(join(dec, 'ADR-0202-beta.md'), '# ADR-0202\n', 'utf-8');
  const src = join(root, 'pkg', 'src');
  mkdirSync(src, { recursive: true });
  // cites a real ADR (0201) and an unknown one (0999 -> must be dropped).
  writeFileSync(join(src, 'a.js'), '// governed by ADR-0201\nexport function f() { return 1; } // see ADR-0999\n', 'utf-8');
  writeFileSync(join(src, 'b.js'), 'export function g() { return 2; } /* ADR-0202 */\n', 'utf-8');
  return root;
}

export async function runRationaleChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(modPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'rationale-nodes imported');

  const root = fixtureRoot();
  try {
    const layer = m.buildRationaleLayer(root);
    const ids = layer.nodes.map((n) => n.id).sort();
    record('ADR files -> adr:#### rationale nodes', JSON.stringify(ids) === JSON.stringify(['adr:0201', 'adr:0202']),
      JSON.stringify(ids));

    const citeTargets = layer.edges.map((e) => e.target).sort();
    const cites0201 = layer.edges.find((e) => e.target === 'adr:0201' && e.source === 'file:pkg/src/a.js');
    const evidenceOk = layer.edges.every((e) => e.relation === 'cites' && e.evidenceClass === 'DETERMINISTIC');
    record('cites edges DETERMINISTIC to the citing file', !!cites0201 && evidenceOk, JSON.stringify(citeTargets));

    const noUnknown = !layer.edges.some((e) => e.target === 'adr:0999');
    const noDangling = layer.edges.every((e) => layer.nodes.some((n) => n.id === e.target));
    record('unknown ADR reference dropped; no dangling edge / fabricated node', noUnknown && noDangling,
      'noUnknown=' + noUnknown + ' noDangling=' + noDangling);

    const a = JSON.stringify(m.buildRationaleLayer(root));
    const b = JSON.stringify(m.buildRationaleLayer(root));
    record('deterministic (twice -> deeply equal)', a === b, a === b ? 'identical' : 'DIVERGED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // Absent corpus -> empty layer, never throws, never fabricates.
  const empty = mkdtempSync(join(tmpdir(), 'rationale-empty-'));
  try {
    const layer = m.buildRationaleLayer(empty);
    record('absent decisions corpus -> empty layer (no fabrication)', layer.nodes.length === 0 && layer.edges.length === 0,
      'nodes=' + layer.nodes.length + ' edges=' + layer.edges.length);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  const source = readFileSync(modPath, 'utf-8');
  const bad = source.split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf('import ') === 0 && l.indexOf(' from ') !== -1)
    .map((l) => { const a = l.lastIndexOf('from '); const r = l.slice(a + 5).trim(); return r.slice(1, r.indexOf(r[0], 1)); })
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (node:* + relative siblings only)', bad.length === 0, bad.length === 0 ? 'clean' : bad.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-rationale-nodes.mjs')) {
  const results = await runRationaleChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  process.exit(failCount > 0 ? 1 : 0);
}
