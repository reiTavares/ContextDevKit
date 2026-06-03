/**
 * Self-check assertions for the agent-forge **operations** surface — Fase 4 + 5:
 * package discovery / diagnosis, the rag-designer extension, and the L5 high-risk
 * paths default that gates `agent-packages/**` edits.
 *
 * Split out of `selfcheck-agent-forge.mjs` once the core file (foundational +
 * build-pipeline checks) reached the 308 hard block — a real responsibility seam
 * (build engine vs. running fleet), not a premature split.
 *
 * Entry point: `runAgentForgeOpsChecks(rep, KIT)`.
 */
import { resolve } from 'node:path';

/** package-ops discovers `<name>@<semver>/` dirs without needing yaml; diagnose
 *  flags missing files + unresolved `{{TOKEN}}` placeholders in governance YAMLs. */
async function checkPackageOps(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge package-ops (Fase 4)...');
  const opsUrl = 'file://' + resolve(KIT, 'templates/contextkit/squads/agent-forge/lib/package-ops.mjs').replaceAll('\\', '/');
  let discoverPackages;
  let diagnosePackage;
  try {
    ({ discoverPackages, diagnosePackage } = await import(opsUrl));
  } catch (err) {
    bad(`package-ops import failed: ${err.message}`);
    return;
  }
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'forge-ops-'));
  try {
    mkdirSync(join(root, 'demo@0.1.0/governance'), { recursive: true });
    mkdirSync(join(root, 'demo@0.1.0/prompts'));
    mkdirSync(join(root, 'demo@0.1.0/tools'));
    mkdirSync(join(root, 'demo@0.1.0/evals'));
    mkdirSync(join(root, 'not-a-package'));
    writeFileSync(join(root, 'demo@0.1.0/manifest.yaml'), 'apiVersion: x\n');
    const pkgs = await discoverPackages(root);
    pkgs.length === 1 && pkgs[0].name === 'demo' && pkgs[0].version === '0.1.0'
      ? ok('package-ops.discoverPackages finds <name>@<semver> dirs and skips others (Fase 4)')
      : bad(`discoverPackages wrong: ${JSON.stringify(pkgs)}`);
    const diag = await diagnosePackage(join(root, 'demo@0.1.0'));
    diag.ok === false && diag.problems.some((problem) => problem.includes('missing'))
      ? ok('package-ops.diagnosePackage reports missing required files (Fase 4)')
      : bad(`diagnose wrong: ${JSON.stringify(diag)}`);
    writeFileSync(join(root, 'demo@0.1.0/governance/cost.policy.yaml'), 'budgets:\n  per_call: {{0.015}}\n');
    const diag2 = await diagnosePackage(join(root, 'demo@0.1.0'));
    diag2.problems.some((problem) => problem.includes('placeholders'))
      ? ok('package-ops.diagnosePackage refuses governance YAML with {{TOKEN}} placeholders (Fase 4)')
      : bad(`diagnose missed placeholders: ${JSON.stringify(diag2)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** rag-designer shapes the bundle from blueprint (residency drives backend,
 *  domain drives embedding language, category drives chunk size, complexity drives top_k). */
async function checkRagDesigner(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge rag-designer (Fase 5)...');
  const ragUrl = 'file://' + resolve(KIT, 'templates/contextkit/squads/agent-forge/lib/rag-designer.mjs').replaceAll('\\', '/');
  let designRagConfig;
  try {
    ({ designRagConfig } = await import(ragUrl));
  } catch (err) {
    bad(`rag-designer import failed: ${err.message}`);
    return;
  }
  const onPrem = designRagConfig({ intent: { category: 'rag-answer', complexity: 'high', domain: 'legal-pt-br' }, privacy: { allow_cloud_providers: false, data_residency: 'on-prem' } });
  onPrem.config.index.backend === 'pgvector'
    ? ok('rag-designer routes to pgvector under no-cloud / on-prem (Fase 5)')
    : bad(`rag-designer leaked to cloud backend: ${onPrem.config.index.backend}`);
  onPrem.config.embedding.model === 'multilingual-e5'
    ? ok('rag-designer picks multilingual embedding for non `-en` domain (Fase 5)')
    : bad(`embedding wrong for multilingual domain: ${onPrem.config.embedding.model}`);
  onPrem.config.retrieval.top_k === 12
    ? ok('rag-designer raises top_k for high-complexity intents (Fase 5)')
    : bad(`top_k wrong for complexity=high: ${onPrem.config.retrieval.top_k}`);
  const englishExtraction = designRagConfig({ intent: { category: 'extraction', complexity: 'low', domain: 'finance-en' }, privacy: { allow_cloud_providers: true } });
  englishExtraction.config.embedding.model === 'text-embedding-3-large' && englishExtraction.chunker.chunk_size_tokens === 256
    ? ok('rag-designer picks english embedding + tight chunks for extraction-en (Fase 5)')
    : bad(`english-en + extraction wrong: ${JSON.stringify({ embed: englishExtraction.config.embedding.model, chunk: englishExtraction.chunker.chunk_size_tokens })}`);
}

/** defaults.mjs ships `agent-packages/**` in L5 highRiskPaths so the simulate-impact
 *  gate triggers on forged-agent edits (ADR-0012). */
async function checkL5ForgePath(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking L5 high-risk paths default (Fase 5)...');
  const defaultsUrl = 'file://' + resolve(KIT, 'templates/contextkit/runtime/config/defaults.mjs').replaceAll('\\', '/');
  try {
    const { DEFAULT_CONFIG } = await import(defaultsUrl);
    DEFAULT_CONFIG?.l5?.highRiskPaths?.includes('agent-packages/**')
      ? ok('defaults.l5.highRiskPaths includes agent-packages/** by default (Fase 5)')
      : bad(`agent-packages/** missing from l5.highRiskPaths: ${JSON.stringify(DEFAULT_CONFIG?.l5?.highRiskPaths)}`);
  } catch (err) {
    bad(`defaults.mjs import failed: ${err.message}`);
  }
}

/** Runs every agent-forge operations check in order. */
export async function runAgentForgeOpsChecks(rep, KIT) {
  await checkPackageOps(rep, KIT);
  await checkRagDesigner(rep, KIT);
  await checkL5ForgePath(rep, KIT);
}
