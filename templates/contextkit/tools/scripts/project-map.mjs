#!/usr/bin/env node
/**
 * /project-map — deterministic, stack-agnostic structural map of THIS project.
 *
 * Generates a durable, committed map under `<memory>/project-map/` that the agent
 * reads INSTEAD of re-exploring the tree — modules classified frontend/backend/
 * shared, dependency edges, a sampled symbol inventory, structural insights
 * (cycles/orphans/oversized) and architectural-rule violations. ZERO AI tokens.
 *
 * Usage:
 *   project-map.mjs                  # (re)generate the map
 *   project-map.mjs --check          # delta vs the saved map + rule violations
 *   project-map.mjs --check --strict # exit 1 if stale OR a rule is violated (CI)
 *   project-map.mjs --for <path>     # focused subgraph (module + deps + importers)
 *
 * Output path single-sourced via `pathsFor` (rule 4). Best-effort; never throws on
 * a bad file. Rules/insights are opt-in and additive (ADR-0046). [ADR-0038/0039/0040/0046]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { scanProject } from './project-map-core.mjs';
import { renderAll } from './project-map-render.mjs';
import { computeInsights, manifestDelta, subgraphFor } from './project-map-insights.mjs';
import { evaluateRules, loadRules } from './project-map-rules.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const readManifest = (dir) => readFile(resolve(dir, 'manifest.json'), 'utf-8').then(JSON.parse).catch(() => null);

/** Builds the full model with insights + rule violations attached. */
function analyze(dir) {
  const model = scanProject(ROOT);
  model.insights = computeInsights(model.modules);
  model.violations = evaluateRules(model.modules, loadRules(dir));
  return model;
}

function printInsights(model) {
  const { cycles, orphans, oversized } = model.insights;
  if (cycles.length) console.log(`   ⚠️  ${cycles.length} dependency cycle(s): ${cycles.map((c) => c.join('→')).slice(0, 3).join(' · ')}`);
  if (orphans.length) console.log(`   ℹ️  ${orphans.length} orphan module(s): ${orphans.slice(0, 5).join(', ')}`);
  if (oversized.length) console.log(`   ℹ️  ${oversized.length} oversized module(s) (split candidates): ${oversized.join(', ')}`);
  if (model.violations.length) console.log(`   ⛔ ${model.violations.length} rule violation(s): ${model.violations.map((v) => `${v.from}→${v.to}`).slice(0, 3).join(' · ')}`);
}

async function generate(dir) {
  const model = analyze(dir);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(renderAll(model))) await writeFile(resolve(dir, name), body, 'utf-8');
  const manifest = {
    name: model.name,
    generatedAt: model.generatedAt,
    signature: model.signature,
    fileCount: model.fileCount,
    modules: model.modules.map((m) => ({ path: m.path, role: m.role, files: m.files, bytes: m.bytes, deps: m.deps || [] })),
    insights: model.insights,
    violations: model.violations,
  };
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`✅ Project map written to contextkit/memory/project-map/ (${model.modules.length} modules · ${model.fileCount} files).`);
  printInsights(model);
  console.log('   Read 00-index.md first — it replaces re-greping the tree.');
}

function printDelta(saved, model) {
  const d = manifestDelta(saved, model);
  const line = (label, items) => items.length && console.log(`   ${label}: ${items.slice(0, 8).join(' · ')}${items.length > 8 ? ` (+${items.length - 8})` : ''}`);
  line('+ modules', d.addedModules);
  line('− modules', d.removedModules);
  line('+ edges', d.addedEdges);
  line('− edges', d.removedEdges);
}

async function check(dir) {
  const saved = await readManifest(dir);
  if (!saved) {
    console.log('ℹ️  No project map yet. Run `/project-map` to generate one.');
    return 0;
  }
  const model = analyze(dir);
  const stale = model.signature !== saved.signature;
  if (stale) {
    console.log(`⚠️  Project map is STALE — saved \`${saved.signature}\` vs current \`${model.signature}\`. Run \`/project-map\`.`);
    printDelta(saved, model);
  } else {
    console.log(`✅ Project map is fresh (signature ${saved.signature}).`);
  }
  for (const v of model.violations) console.log(`⛔ ${v.rule}: ${v.from} → ${v.to} (${v.reason})`);
  const fail = (stale || model.violations.length > 0) && flag('--strict');
  return fail ? 1 : 0;
}

function forPath(target) {
  const sub = subgraphFor(scanProject(ROOT).modules, target);
  if (!sub) {
    console.log(`ℹ️  No mapped module owns \`${target}\`.`);
    return 0;
  }
  console.log(`# ${sub.module}/`);
  console.log(`depends on: ${sub.deps.map((d) => `${d}/`).join(', ') || '—'}`);
  console.log(`imported by: ${sub.importers.map((d) => `${d}/`).join(', ') || '—'}`);
  return 0;
}

async function main() {
  const dir = pathsFor(ROOT).projectMap;
  if (flag('--for')) process.exit(forPath(valueOf('--for')));
  if (flag('--check')) process.exit(await check(dir));
  await generate(dir);
}

main().catch((err) => {
  console.error('❌ project-map failed:', err?.message ?? err);
  process.exit(1);
});
