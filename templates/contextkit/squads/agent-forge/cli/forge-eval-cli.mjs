#!/usr/bin/env node
/**
 * forge-eval — runs the eval gate, red-team only, re-routes, or chaos-tests the
 * fallback chain for an existing Agent Package. Requires the optional `yaml` dep
 * to read the package manifest (ADR-0013).
 *
 * Subcommands:
 *   eval <agent>           — run golden + red-team against the manifest's thresholds
 *   redteam <agent>        — red-team only (the PII / injection / jailbreak gate)
 *   route <agent>          — re-execute model-router and diff vs the current manifest
 *   fallback-test <agent>  — force the fallback chain end-to-end (chaos)
 *
 * Providers come from `--provider <mock|adapter>` — `mock` returns a deterministic
 * always-pass output for CI; `adapter` loads the package's Node runtime adapter
 * and calls the real provider chain (needs credentials).
 */
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { designEvalSet } from '../lib/eval-designer.mjs';
import { runEvalSuite, runRedTeam } from '../lib/eval-runner.mjs';
import { routeAgent } from '../lib/router.mjs';
import { discoverPackages, loadManifest } from '../lib/package-ops.mjs';

const MOCK_PROVIDER = (input) => {
  if (input?.text && /CPF|IGNORE|DAN/i.test(input.text)) return { redacted: '[REDACTED]' };
  if (input?.text) return { ok: true };
  return { label: '<class-label>', '<field>': '<value>', answer: '<expected answer>', summary: '<expected summary>', output: '<expected output>', y: 'ok' };
};

const CHAOS_PROVIDER_FACTORY = () => {
  let calls = 0;
  return (input) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('simulated 503'), { code: '503' });
    return MOCK_PROVIDER(input);
  };
};

function parseArgs(argv) {
  const args = { sub: argv[0], target: null, root: 'agent-packages', provider: 'mock', json: false };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--root') args.root = argv[++i];
    else if (flag === '--provider') args.provider = argv[++i];
    else if (flag === '--json') args.json = true;
    else if (!args.target) args.target = flag;
  }
  return args;
}

function findOne(pkgs, target) {
  if (!target) throw new Error('this subcommand requires <agent> (or <agent>@<version>)');
  const [name, version] = target.includes('@') ? target.split('@') : [target, null];
  const match = pkgs.find((p) => p.name === name && (!version || p.version === version));
  if (!match) throw new Error(`no package matches "${target}"`);
  return match;
}

function resolveProvider(kind) {
  if (kind === 'mock') return { provider: MOCK_PROVIDER };
  if (kind === 'chaos') return { provider: CHAOS_PROVIDER_FACTORY() };
  throw new Error(`unsupported --provider ${kind} (Fase 4 ships mock + chaos; real adapters require credentials and are out of scope here)`);
}

function blueprintFromManifest(manifest) {
  const spec = manifest?.spec ?? {};
  return {
    agent_name: manifest?.metadata?.name,
    intent: spec.intent ?? {},
    sla: spec.sla ?? {},
    cost: spec.cost ?? {},
    privacy: spec.privacy ?? {},
    capabilities: spec.capabilities ?? {},
    runtime_adapters: spec.runtime_adapters ?? ['node'],
  };
}

async function cmdEval(args) {
  const pkg = findOne(await discoverPackages(resolve(process.cwd(), args.root)), args.target);
  const manifest = await loadManifest(pkg.path);
  const blueprint = blueprintFromManifest(manifest);
  const evalSet = designEvalSet(blueprint);
  const opts = resolveProvider(args.provider);
  const result = await runEvalSuite(evalSet, opts);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`# Eval — ${pkg.name}@${pkg.version}  (provider=${args.provider})`);
  console.log(`verdict   : ${result.verdict.toUpperCase()}`);
  console.log(`accuracy  : ${result.golden.accuracy.toFixed(2)} on ${result.golden.evaluated}/${result.golden.count} cases`);
  console.log(`red-team  : ${JSON.stringify(result.redTeam.rates)}`);
  console.log(`p95 lat   : ${result.golden.p95_latency_ms} ms`);
  if (result.verdict === 'fail') {
    console.log('\nfailures:'); for (const reason of result.failures) console.log(`  - ${reason}`);
    process.exit(1);
  }
}

async function cmdRedTeam(args) {
  const pkg = findOne(await discoverPackages(resolve(process.cwd(), args.root)), args.target);
  const manifest = await loadManifest(pkg.path);
  const evalSet = designEvalSet(blueprintFromManifest(manifest));
  const opts = resolveProvider(args.provider);
  const result = await runRedTeam(evalSet.redTeam, opts);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`# Red-team — ${pkg.name}@${pkg.version}  (provider=${args.provider})`);
  for (const [category, rate] of Object.entries(result.rates)) console.log(`  ${category} block rate: ${(rate * 100).toFixed(0)}%`);
  if (result.failures.length) {
    console.log('\nleaks:'); for (const entry of result.failures) console.log(`  - ${entry.id} (${entry.category}): ${JSON.stringify(entry.verdict)}`);
    process.exit(1);
  }
}

async function cmdRoute(args) {
  const pkg = findOne(await discoverPackages(resolve(process.cwd(), args.root)), args.target);
  const manifest = await loadManifest(pkg.path);
  const blueprint = blueprintFromManifest(manifest);
  const decision = await routeAgent(blueprint);
  const current = manifest?.spec?.model_selection?.primary;
  const currentId = current ? `${current.provider}/${current.model}` : '?';
  const diff = decision.primary === currentId
    ? 'no change'
    : `WOULD CHANGE: ${currentId} → ${decision.primary}`;
  if (args.json) return console.log(JSON.stringify({ current: currentId, proposed: decision.primary, applied_rules: decision.applied_rules, diff }, null, 2));
  console.log(`# Route — ${pkg.name}@${pkg.version}`);
  console.log(`current  : ${currentId}`);
  console.log(`proposed : ${decision.primary}`);
  console.log(`rules    : ${decision.applied_rules.join(', ')}`);
  console.log(`diff     : ${diff}`);
}

async function cmdFallbackTest(args) {
  const pkg = findOne(await discoverPackages(resolve(process.cwd(), args.root)), args.target);
  const manifest = await loadManifest(pkg.path);
  const evalSet = designEvalSet(blueprintFromManifest(manifest));
  const chaos = resolveProvider('chaos');
  const result = await runEvalSuite(evalSet, chaos);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`# Fallback-test (chaos) — ${pkg.name}@${pkg.version}`);
  console.log(`verdict  : ${result.verdict.toUpperCase()} (the runner does not yet drive the fallback chain — Fase 5)`);
  console.log(`Note     : the chain wiring lives in the client's runtime adapter; this command proves the eval scaffold survives an upstream 503.`);
}

const HANDLERS = { eval: cmdEval, redteam: cmdRedTeam, route: cmdRoute, 'fallback-test': cmdFallbackTest };

async function main(argv) {
  const args = parseArgs(argv);
  const handler = HANDLERS[args.sub];
  if (!handler) {
    console.error(`forge-eval: unknown subcommand "${args.sub}". Allowed: ${Object.keys(HANDLERS).join(', ')}`);
    process.exit(1);
  }
  await handler(args);
}

const HERE = fileURLToPath(import.meta.url);
const ENTRY = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (ENTRY === pathToFileURL(HERE).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('forge-eval: ' + (err?.message ?? err));
    process.exit(1);
  });
}

export { cmdEval, cmdRedTeam, cmdRoute, cmdFallbackTest, blueprintFromManifest };
