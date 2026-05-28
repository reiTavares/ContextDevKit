#!/usr/bin/env node
/**
 * forge-ops — the read-only inspection CLI for forged Agent Packages.
 * Subcommands: list, show, doctor, policy, budget, audit. Each one walks
 * `agent-packages/` (or `--root <dir>`) using `lib/package-ops.mjs`. Pure
 * Node — but `show`/`policy`/`budget` need the optional `yaml` dep at runtime
 * (ADR-0013) because they parse the manifest.
 *
 * Usage:
 *   node vibekit/squads/agent-forge/cli/forge-ops.mjs <subcommand> [args] [--root <dir>] [--json]
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aggregateBudgets, diagnosePackage, discoverPackages, loadManifest, loadProvenance, summarize } from '../lib/package-ops.mjs';

const SUB = ['list', 'show', 'doctor', 'policy', 'budget', 'audit'];

function parseArgs(argv) {
  const args = { sub: argv[0], target: null, root: 'agent-packages', json: false };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--root') args.root = argv[++i];
    else if (flag === '--json') args.json = true;
    else if (!args.target) args.target = flag;
  }
  return args;
}

function findOne(pkgs, target) {
  if (!target) throw new Error('this subcommand requires <agent> (or <agent>@<version>)');
  const [name, version] = target.includes('@') ? target.split('@') : [target, null];
  const candidates = pkgs.filter((p) => p.name === name && (!version || p.version === version));
  if (!candidates.length) throw new Error(`no package matches "${target}" under the registry`);
  return candidates[candidates.length - 1];
}

async function cmdList(args) {
  const pkgs = await discoverPackages(resolve(process.cwd(), args.root));
  if (args.json) return console.log(JSON.stringify(pkgs, null, 2));
  if (!pkgs.length) return console.log(`(no packages found under ${args.root}/)`);
  console.log(`Agent Packages under ${args.root}/  (${pkgs.length}):`);
  for (const pkg of pkgs) {
    const manifest = await loadManifest(pkg.path).catch(() => null);
    const provenance = await loadProvenance(pkg.path);
    console.log('  ' + summarize(pkg, manifest, provenance));
  }
}

async function cmdShow(args) {
  const pkgs = await discoverPackages(resolve(process.cwd(), args.root));
  const pkg = findOne(pkgs, args.target);
  const manifest = await loadManifest(pkg.path);
  const provenance = await loadProvenance(pkg.path);
  const payload = { ...pkg, manifest, provenance };
  if (args.json) return console.log(JSON.stringify(payload, null, 2));
  console.log(`# ${pkg.name}@${pkg.version}\n`);
  console.log(`name        : ${manifest?.metadata?.name}`);
  console.log(`version     : ${manifest?.metadata?.version}`);
  console.log(`description : ${manifest?.metadata?.description?.trim()}`);
  console.log(`primary     : ${manifest?.spec?.model_selection?.primary?.provider}/${manifest?.spec?.model_selection?.primary?.model}`);
  if (manifest?.spec?.model_selection?.fallback?.length) {
    const fb = manifest.spec.model_selection.fallback[0];
    console.log(`fallback    : ${fb.provider}/${fb.model}`);
  }
  console.log(`runtimes    : ${(manifest?.spec?.runtime_adapters || []).join(', ')}`);
  console.log(`eval_passed : ${manifest?.metadata?.provenance?.eval_passed_at ?? 'NEVER'}`);
  console.log(`forged_by   : ${manifest?.metadata?.provenance?.forged_by}`);
  console.log(`hash        : ${manifest?.metadata?.provenance?.blueprint_hash}`);
}

async function cmdDoctor(args) {
  const pkgs = await discoverPackages(resolve(process.cwd(), args.root));
  if (!pkgs.length) return console.log(`(no packages found under ${args.root}/)`);
  const report = [];
  let bad = 0;
  for (const pkg of pkgs) {
    const result = await diagnosePackage(pkg.path);
    report.push({ name: pkg.name, version: pkg.version, ...result });
    if (!result.ok) bad += 1;
  }
  if (args.json) return console.log(JSON.stringify(report, null, 2));
  for (const entry of report) {
    if (entry.ok) console.log(`  ✅ ${entry.name}@${entry.version}`);
    else {
      console.log(`  ❌ ${entry.name}@${entry.version}`);
      for (const problem of entry.problems) console.log(`     - ${problem}`);
    }
  }
  console.log(`\n${pkgs.length - bad}/${pkgs.length} healthy${bad ? `; ${bad} need attention` : ''}.`);
  if (bad) process.exit(1);
}

async function cmdPolicy(args) {
  const pkgs = await discoverPackages(resolve(process.cwd(), args.root));
  const pkg = findOne(pkgs, args.target);
  const { parseYaml } = await import('../lib/yaml.mjs');
  const pillars = {};
  for (const name of ['cost', 'compliance', 'quality']) {
    pillars[name] = parseYaml(await readFile(join(pkg.path, `governance/${name}.policy.yaml`), 'utf-8'));
  }
  pillars.fallback = parseYaml(await readFile(join(pkg.path, 'governance/fallback-chain.yaml'), 'utf-8'));
  if (args.json) return console.log(JSON.stringify(pillars, null, 2));
  console.log(`# Governance — ${pkg.name}@${pkg.version}\n`);
  console.log('cost.budgets:'); console.log(JSON.stringify(pillars.cost?.budgets, null, 2));
  console.log('\ncompliance.data_residency:'); console.log(JSON.stringify(pillars.compliance?.data_residency, null, 2));
  console.log('\nquality.eval_gates.pre_release:'); console.log(JSON.stringify(pillars.quality?.eval_gates?.pre_release, null, 2));
  console.log('\nfallback.chain:'); console.log(JSON.stringify(pillars.fallback?.chain, null, 2));
}

async function cmdBudget(args) {
  const pkgs = await discoverPackages(resolve(process.cwd(), args.root));
  const manifests = [];
  for (const pkg of pkgs) {
    const manifest = await loadManifest(pkg.path).catch(() => null);
    if (manifest) manifests.push(manifest);
  }
  const result = aggregateBudgets(manifests);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`# Forge Budget — aggregate across ${manifests.length} package(s)\n`);
  console.log(`monthly target   : $${result.totals.monthly_target_usd.toFixed(2)}`);
  console.log(`monthly hard cap : $${result.totals.monthly_hard_cap_usd.toFixed(2)}\n`);
  for (const entry of result.perAgent) {
    console.log(`  ${entry.name}  target $${entry.target}  cap $${entry.hardCap}  per-call max $${entry.perCallCap}`);
  }
}

async function cmdAudit(args) {
  const pkgs = await discoverPackages(resolve(process.cwd(), args.root));
  const pkg = findOne(pkgs, args.target);
  const auditPath = join(pkg.path, 'audit', `${pkg.name}.jsonl`);
  let raw = '';
  try { raw = await readFile(auditPath, 'utf-8'); } catch {
    console.log(`(no audit log at ${auditPath})`);
    return;
  }
  const events = raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const totals = { calls: events.length, ok: 0, refused: 0, error: 0, killed: 0, totalCost: 0, fallbacks: 0 };
  for (const event of events) {
    if (event.outcome && totals[event.outcome] !== undefined) totals[event.outcome] += 1;
    if (event.fallback_triggered) totals.fallbacks += 1;
    totals.totalCost += Number(event.cost_usd ?? 0);
  }
  if (args.json) return console.log(JSON.stringify({ pkg, totals }, null, 2));
  console.log(`# Audit — ${pkg.name}@${pkg.version}  (${events.length} events)\n`);
  console.log(`  ok        : ${totals.ok}`);
  console.log(`  refused   : ${totals.refused}`);
  console.log(`  error     : ${totals.error}`);
  console.log(`  killed    : ${totals.killed}`);
  console.log(`  fallbacks : ${totals.fallbacks}`);
  console.log(`  cost      : $${totals.totalCost.toFixed(4)}`);
}

const HANDLERS = { list: cmdList, show: cmdShow, doctor: cmdDoctor, policy: cmdPolicy, budget: cmdBudget, audit: cmdAudit };

async function main(argv) {
  const args = parseArgs(argv);
  const handler = HANDLERS[args.sub];
  if (!handler) {
    console.error(`forge-ops: unknown subcommand "${args.sub}". Allowed: ${SUB.join(', ')}`);
    process.exit(1);
  }
  await handler(args);
}

const HERE = fileURLToPath(import.meta.url);
const ENTRY = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (ENTRY === pathToFileURL(HERE).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('forge-ops: ' + (err?.message ?? err));
    process.exit(1);
  });
}

export { cmdList, cmdShow, cmdDoctor, cmdPolicy, cmdBudget, cmdAudit };
