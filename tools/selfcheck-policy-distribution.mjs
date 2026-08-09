#!/usr/bin/env node
/**
 * Self-test for the flat policy-table distribution contract (WF-0086 IN1, ADR-0148).
 *
 * The IN1 finding: flat policy tables such as `work-classification.json` and
 * `decision-intelligence.json` had readers in the
 * runtime but NO installer path — so a greenfield install silently degraded every
 * reader to its embedded fallback and the canonical journey map went inert. The
 * three subtrees (`domain-engineering|devteam|domain-artifacts`) were already
 * covered; the flat tables next to them were not.
 *
 * This guard is deliberately written as a COMPLETENESS invariant rather than a
 * check of the three known names: every `*.json` sitting directly in
 * `templates/contextkit/policy/` must be claimed by exactly one distribution
 * channel in `tools/install/engine.mjs` — `MEMORY_SEEDS` (write-if-missing, user
 * data the project extends) or `POLICY_TABLES` (always-overwrite, deterministic
 * kit code schema-coupled to its reader). A table added later with neither is the
 * same defect again, and this fails on it without needing an edit here.
 *
 * Standalone entrypoint (exit 0/1) and hub-exported, mirroring
 * selfcheck-graph-index.mjs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const ENGINE = 'tools/install/engine.mjs';
const POLICY_DIR = 'templates/contextkit/policy';

/**
 * Extract a top-level string-array literal (`const NAME = [ '…', '…' ];`) from the
 * installer source. Source-text parsing keeps this a zero-dep static check and
 * avoids importing the installer (which pulls the whole engine graph).
 * @param {string} source engine.mjs text
 * @param {string} name declaration name
 * @returns {string[]|null} entries, or null when the declaration is absent
 */
function readArrayLiteral(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  if (start === -1) return null;
  const end = source.indexOf('];', start);
  if (end === -1) return null;
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Run the policy-distribution checks.
 * @param {{ ok: (m:string)=>void, bad: (m:string)=>void }} counters
 * @param {{ KIT: string }} ctx KIT = kit-dev root holding templates/ + tools/
 */
export function runPolicyDistributionChecks({ ok, bad }, { KIT: root }) {
  let source;
  try {
    source = readFileSync(resolve(root, ENGINE), 'utf-8');
  } catch (err) {
    bad(`${ENGINE} unreadable: ${err?.message ?? err}`);
    return;
  }

  const tables = readArrayLiteral(source, 'POLICY_TABLES');
  const seeds = readArrayLiteral(source, 'MEMORY_SEEDS');
  if (!tables) { bad('POLICY_TABLES declaration missing from the installer'); return; }
  if (!seeds) { bad('MEMORY_SEEDS declaration missing from the installer'); return; }
  ok(`installer declares POLICY_TABLES (${tables.length}) + MEMORY_SEEDS (${seeds.length})`);

  let present;
  try {
    present = readdirSync(resolve(root, POLICY_DIR), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    bad(`${POLICY_DIR} unreadable: ${err?.message ?? err}`);
    return;
  }
  if (present.length === 0) { bad(`${POLICY_DIR} has no flat policy tables — expected at least one`); return; }

  // (a) completeness — every flat table is claimed by exactly one channel.
  const seeded = new Set(seeds.filter((s) => s.startsWith('policy/')).map((s) => s.slice('policy/'.length)));
  const overwritten = new Set(tables);
  const unclaimed = present.filter((f) => !seeded.has(f) && !overwritten.has(f));
  const doubleClaimed = present.filter((f) => seeded.has(f) && overwritten.has(f));

  if (unclaimed.length === 0) {
    ok(`(a) all ${present.length} flat policy tables are distributed (no install gap)`);
  } else {
    bad(`(a) policy tables reach NO install path: ${unclaimed.join(', ')} — add to POLICY_TABLES (kit code) or MEMORY_SEEDS (user data)`);
  }
  if (doubleClaimed.length === 0) {
    ok('(b) no table is both seeded and overwritten (single distribution channel each)');
  } else {
    bad(`(b) tables claimed by BOTH channels: ${doubleClaimed.join(', ')} — overwrite would clobber the seeded copy`);
  }

  // (c) the remaining classifier tables are kit code (always-overwrite), never seeded:
  // each is schema-coupled to a runtime reader, so a stale user copy breaks it.
  for (const table of ['work-classification.json', 'decision-intelligence.json']) {
    if (!present.includes(table)) { bad(`(c) ${table} absent from ${POLICY_DIR}`); continue; }
    if (overwritten.has(table) && !seeded.has(table)) ok(`(c) ${table} ships always-overwrite (schema-coupled kit table)`);
    else bad(`(c) ${table} must be in POLICY_TABLES, not seeded (overwrite=${overwritten.has(table)} seeded=${seeded.has(table)})`);
  }

  // (d) the copy loop actually consumes POLICY_TABLES — a declared-but-unused
  // constant would pass (a) while distributing nothing (the phantom-pass trap).
  if (/for \(const \w+ of POLICY_TABLES\)/.test(source)) ok('(d) copyEngine iterates POLICY_TABLES (declaration is wired, not dead)');
  else bad('(d) POLICY_TABLES is declared but never iterated — nothing is distributed');
}

// --- self-run guard: prove the suite executes (no phantom pass) ------------------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let okN = 0; let badN = 0;
  const ok = (m) => { okN += 1; console.log(`  ok  ${m}`); };
  const bad = (m) => { badN += 1; console.log(`  BAD ${m}`); };
  runPolicyDistributionChecks({ ok, bad }, { KIT });
  console.log(`\nselfcheck-policy-distribution: ${okN} ok / ${badN} bad`);
  process.exit(badN === 0 ? 0 : 1);
}
