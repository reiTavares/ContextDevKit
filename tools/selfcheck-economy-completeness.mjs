#!/usr/bin/env node
/**
 * Economy telemetry COMPLETENESS gate (OP-0001 / ADR-0117).
 *
 * Enumerates the canonical economy registry and asserts no measurable lever ships
 * "dark": every `category:'lever'` resource MUST have a telemetry emit-site
 * (emitEconomy / logSavingSync / logEconomyEventSync referencing its id). For
 * `advisory`/`lifecycle` resources it REPORTS the still-uninstrumented set
 * (visibility, not a silent gap) so coverage can be driven to completion.
 *
 * Static wiring tripwire (not a behavior proof — see econCheckTelemetryEmit for
 * the behavioral guarantee). Zero runtime deps — node:* only. Exit 1 if a lever
 * is dark; exit 0 otherwise (advisory dark set is printed, never fatal yet).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = [
  'templates/contextkit/tools/scripts/economy',
  'templates/contextkit/tools/scripts',
  'templates/contextkit/runtime/execution',
  'templates/contextkit/runtime/hooks',
].map((d) => resolve(KIT, d));

const EMIT_RE = /emitEconomy\(|logSavingSync\(|logEconomyEventSync\(|appendEconomyEventSync\(/;

function walk(dir, out) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
}

function hasEmitSite(resource, files) {
  const idLiteral = new RegExp(`['"]${resource.replace(/[-/]/g, '\$&')}['"]`);
  for (const f of files) {
    let text = '';
    try { text = readFileSync(f, 'utf-8'); } catch { continue; }
    if (EMIT_RE.test(text) && idLiteral.test(text)) return true;
  }
  return false;
}

const { ECONOMY_RESOURCES } = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/economy/registry.mjs')).href);
const files = [];
for (const d of SCAN_DIRS) walk(d, files);

let leverDark = 0;
const advisoryDark = [];
console.log('\n── Economy telemetry completeness (ADR-0117) ──');
for (const { resource, category } of ECONOMY_RESOURCES) {
  const wired = hasEmitSite(resource, files);
  if (category === 'lever') {
    wired ? console.log(`  ✓ lever ${resource} — instrumented`) : (console.error(`  ✗ lever ${resource} — DARK (no emit-site)`), leverDark++);
  } else if (!wired) {
    advisoryDark.push(`${resource}(${category})`);
  } else {
    console.log(`  ✓ ${category} ${resource} — instrumented`);
  }
}
if (advisoryDark.length > 0) {
  console.log(`  ⚠ ADVISORY — ${advisoryDark.length} non-lever resource(s) not yet instrumented (tracked, non-fatal):`);
  console.log(`      ${advisoryDark.join(', ')}`);
}
console.log(
  leverDark === 0
    ? `\n✅ Economy completeness: all ${ECONOMY_RESOURCES.filter((r) => r.category === 'lever').length} measurable levers instrumented (no lever ships dark).\n`
    : `\n❌ Economy completeness: ${leverDark} lever(s) DARK.\n`,
);
process.exit(leverDark === 0 ? 0 : 1);
