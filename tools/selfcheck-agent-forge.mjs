/**
 * Self-check assertions specific to the `agent-forge` squad (ADR-0012, ADR-0013).
 *
 * Split out of `selfcheck-checks.mjs` once the squad gained a third dedicated
 * check (`checkRouterEngine`) — a real responsibility seam, not a premature
 * split. The squad will add more checks across Fases 1–5; this file grows with it.
 *
 * Same contract as `selfcheck-checks.mjs`: every function takes the reporter
 * `rep` ({ ok, bad }) plus only what it needs. Entry point:
 * `runAgentForgeChecks(rep, KIT)`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listMjs } from './selfcheck-checks.mjs';

/** Capability matrix parses (BOM-safe, zero-dep) with unique, well-formed ids
 *  from allowed providers (ADR-0012, constraints 5-6). */
async function checkCapabilityMatrix(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge capability matrix...');
  const rel = 'templates/vibekit/squads/agent-forge/router/capability-matrix.json';
  const raw = await readFile(resolve(KIT, rel), 'utf-8').catch(() => '');
  let matrix;
  try {
    matrix = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    bad(raw ? 'capability matrix does not parse' : `capability matrix missing: ${rel}`);
    return;
  }
  if (typeof matrix.updated !== 'string' || !Array.isArray(matrix.models) || !matrix.models.length) {
    bad('capability matrix needs an `updated` date + a non-empty `models[]`');
    return;
  }
  ok(`capability matrix parses (${matrix.models.length} models, updated ${matrix.updated})`);
  const allowed = new Set(matrix.allowed_providers || []);
  const seen = new Set();
  const flaws = [];
  for (const model of matrix.models) {
    const id = model?.id;
    if (typeof id !== 'string' || !/^[a-z0-9-]+\/[\w.-]+$/.test(id)) { flaws.push(`malformed id ${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) flaws.push(`duplicate id ${id}`);
    seen.add(id);
    if (allowed.size && !allowed.has(id.split('/')[0])) flaws.push(`disallowed provider ${id}`);
    if (!model.tier) flaws.push(`${id} missing tier`);
  }
  flaws.length ? flaws.forEach((flaw) => bad(`matrix: ${flaw}`)) : ok('matrix ids unique, well-formed, from allowed providers, tiered');
}

/** Rule 1 + ADR-0013: the L1-3 hot path never imports the optional `yaml` dep. */
async function checkHotPathNoYaml(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking the hot path stays yaml-free (rule 1)...');
  const importsYaml = /\bimport\b[^\n]*['"]yaml['"]|require\(\s*['"]yaml['"]/;
  const offenders = [];
  for (const file of await listMjs(resolve(KIT, 'templates/vibekit/runtime'))) {
    if (importsYaml.test(await readFile(file, 'utf-8').catch(() => ''))) offenders.push(file.replace(KIT, '').replaceAll('\\', '/'));
  }
  offenders.length ? offenders.forEach((o) => bad(`hot-path yaml import: ${o}`)) : ok('hot path imports no yaml dep (ADR-0013)');
}

/** Runs every agent-forge-specific check in order. */
export async function runAgentForgeChecks(rep, KIT) {
  await checkCapabilityMatrix(rep, KIT);
  await checkHotPathNoYaml(rep, KIT);
}
