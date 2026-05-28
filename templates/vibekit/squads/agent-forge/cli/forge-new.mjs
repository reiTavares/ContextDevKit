#!/usr/bin/env node
/**
 * forge-new — the agent-forge front-door CLI. Reads a blueprint (YAML or JSON),
 * validates + fills defaults, routes via the deterministic engine, and packages
 * the APF v1 under `<out>/<agent-name>@<version>/`. Requires the optional `yaml`
 * dep at runtime when reading a `.yaml` blueprint or writing the manifest
 * (ADR-0013) — the loader surfaces an actionable error if absent.
 *
 * Usage:
 *   node vibekit/squads/agent-forge/cli/forge-new.mjs --blueprint <path> [--out <dir>] [--version <semver>]
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fillDefaults, validateBlueprint } from '../lib/architect.mjs';
import { packageAgent } from '../lib/packager.mjs';
import { routeAgent } from '../lib/router.mjs';

const USAGE = `Usage: forge-new --blueprint <path> [--out <dir>] [--version <semver>]

Reads the blueprint, validates + fills defaults, routes to a provider via the
deterministic engine, and writes a new Agent Package under
  <out>/<agent-name>@<version>/   (default: agent-packages/<name>@0.1.0)

YAML blueprints require the optional \`yaml\` dep (ADR-0013) — run \`npm i yaml\`.
`;

function parseArgs(argv) {
  const out = { blueprint: null, out: 'agent-packages', version: '0.1.0' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--blueprint' || k === '-b') out.blueprint = argv[++i];
    else if (k === '--out' || k === '-o') out.out = argv[++i];
    else if (k === '--version' || k === '-v') out.version = argv[++i];
    else if (k === '--help' || k === '-h') out.help = true;
  }
  return out;
}

/** Parse a blueprint file — `.json` zero-dep, `.yaml`/`.yml` via the optional yaml loader. */
async function readBlueprint(path) {
  const text = (await readFile(path, 'utf-8')).replace(/^﻿/, '');
  if (path.endsWith('.json')) return JSON.parse(text);
  const { parseYaml } = await import('../lib/yaml.mjs');
  return parseYaml(text);
}

/**
 * Programmatic entry — forges a new APF from an already-parsed blueprint object.
 * Used by the integration test (no YAML dep needed at parse time) and by the CLI
 * (after it parses the file).
 */
export async function forgeNew(rawBlueprint, outDir, opts = {}) {
  const validation = validateBlueprint(rawBlueprint);
  if (!validation.ok) {
    const err = new Error('blueprint validation failed:\n  - ' + validation.errors.join('\n  - '));
    err.validation = validation;
    throw err;
  }
  const blueprint = fillDefaults(rawBlueprint);
  const decision = await routeAgent(blueprint, opts.routerOpts);
  let evalResult = null;
  if (opts.runEval) {
    const { designEvalSet } = await import('../lib/eval-designer.mjs');
    const { runEvalSuite } = await import('../lib/eval-runner.mjs');
    evalResult = await runEvalSuite(designEvalSet(blueprint), opts.runEval);
  }
  const version = opts.version ?? '0.1.0';
  const targetDir = resolve(outDir, `${blueprint.agent_name}@${version}`);
  const summary = await packageAgent(blueprint, decision, targetDir, { ...opts, version, evalResult });
  return { blueprint, decision, summary, evalResult };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.blueprint) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  const blueprintPath = resolve(process.cwd(), args.blueprint);
  const raw = await readBlueprint(blueprintPath);
  const { decision, summary } = await forgeNew(raw, resolve(process.cwd(), args.out), { version: args.version });
  console.log('✅ Agent Package forged:');
  console.log('   ' + summary.targetDir);
  console.log('   primary: ' + decision.primary + (decision.fallback ? ' · fallback: ' + decision.fallback : ' · (no cross-provider fallback)'));
  console.log('   blueprint_hash: ' + summary.provenance.blueprint_hash.slice(0, 16));
  console.log('\nNext: review the manifest, then run the (Fase 3) eval gate before shipping.');
}

const HERE = fileURLToPath(import.meta.url);
const ENTRY = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (ENTRY === pathToFileURL(HERE).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('forge-new: ' + (err?.message ?? err));
    process.exit(1);
  });
}
