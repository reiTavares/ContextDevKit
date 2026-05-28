/**
 * package-ops — shared helpers for every `/forge-*` maintenance command.
 * Pure + zero-dep on the JSON side; YAML reads are gated on `lib/yaml.mjs`
 * (optional dep, ADR-0013). The `/forge-*` CLIs share these so the inspection
 * + mutation surface stays consistent.
 *
 * The Agent Package directory convention: `<root>/<name>@<semver>/manifest.yaml`.
 * `discoverPackages(root)` walks the registry without loading any YAML — it
 * matches the directory shape — so a missing `yaml` dep does not break listing.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PKG_RE = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/;

/** List every `<name>@<semver>` directory under `root`. Pure JSON, no YAML needed. */
export async function discoverPackages(root) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = PKG_RE.exec(entry.name);
    if (!match) continue;
    out.push({ name: match[1], version: match[2], path: join(root, entry.name) });
  }
  return out.sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

/** Read `manifest.yaml` for one package via the optional yaml dep (ADR-0013). */
export async function loadManifest(pkgPath) {
  const { parseYaml } = await import('./yaml.mjs');
  const raw = await readFile(join(pkgPath, 'manifest.yaml'), 'utf-8');
  return parseYaml(raw);
}

/** Read `.agentforgerc` (zero-dep JSON; reports `null` if the file is missing). */
export async function loadProvenance(pkgPath) {
  try {
    const raw = await readFile(join(pkgPath, '.agentforgerc'), 'utf-8');
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** One-line summary suitable for `/forge-list` output, derived from manifest + provenance. */
export function summarize(pkg, manifest, provenance) {
  const primary = manifest?.spec?.model_selection?.primary;
  const primaryId = primary ? `${primary.provider}/${primary.model}` : '?';
  const evalStamped = manifest?.metadata?.provenance?.eval_passed_at;
  const evalMark = evalStamped ? '✅ eval' : '⚠️  unevaluated';
  return `${pkg.name}@${pkg.version}  ${primaryId}  ${evalMark}` + (provenance?.provenance?.eval_run ? `  (run ${provenance.provenance.eval_run})` : '');
}

/** Doctor: structural checks against an APF directory. Returns `{ ok, problems[] }`. */
export async function diagnosePackage(pkgPath) {
  const problems = [];
  const expectedFiles = ['manifest.yaml', 'README.md', '.agentforgerc',
    'prompts/system.canonical.md', 'tools/schemas.canonical.json',
    'governance/cost.policy.yaml', 'governance/compliance.policy.yaml',
    'governance/quality.policy.yaml', 'governance/fallback-chain.yaml',
    'evals/golden.jsonl', 'evals/thresholds.yaml'];
  for (const rel of expectedFiles) {
    try {
      await stat(join(pkgPath, rel));
    } catch {
      problems.push(`missing: ${rel}`);
    }
  }
  for (const rel of ['governance/cost.policy.yaml', 'governance/compliance.policy.yaml', 'governance/quality.policy.yaml']) {
    try {
      const body = await readFile(join(pkgPath, rel), 'utf-8');
      if (body.includes('{{') && body.includes('}}')) problems.push(`${rel} still carries {{TOKEN}} placeholders`);
    } catch {
      /* already reported above */
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Compose the aggregate monthly budget across every package — for `/forge-budget`. */
export function aggregateBudgets(manifests) {
  let target = 0;
  let hardCap = 0;
  const perAgent = [];
  for (const manifest of manifests) {
    const cost = manifest?.spec?.cost ?? {};
    const monthlyTarget = Number(cost.monthly_budget_usd ?? 0);
    const perCallCap = Number(cost.max_usd_per_call ?? 0);
    const monthlyCap = Math.round(monthlyTarget * 1.5);
    target += monthlyTarget;
    hardCap += monthlyCap;
    perAgent.push({ name: manifest?.metadata?.name, target: monthlyTarget, hardCap: monthlyCap, perCallCap });
  }
  return { totals: { monthly_target_usd: target, monthly_hard_cap_usd: hardCap }, perAgent };
}
