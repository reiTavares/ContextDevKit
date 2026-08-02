#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = resolve(HERE, 'subagent-routing-policy.json');

function selectorToken(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

/** @returns {'low'|'moderate'|'high'|'xhigh'|'critical'|null} */
export function normalizeComplexity(value) {
  const token = selectorToken(value);
  if (['low', 'small', 'simple', 'trivial', 'baixa', 'baixo'].includes(token)) return 'low';
  if (['moderate', 'medium', 'feature', 'moderada', 'moderado', 'media', 'medio'].includes(token)) return 'moderate';
  if (['high', 'large', 'complex', 'architectural', 'alta', 'alto'].includes(token)) return 'high';
  if (['xhigh', 'xl', 'x-large', 'very-high', 'veryhigh', 'muito-alta', 'muito-alto'].includes(token)) return 'xhigh';
  if (['critical', 'critica', 'critico'].includes(token)) return 'critical';
  return null;
}

/** @returns {'low'|'moderate'|'high'|'xhigh'|'critical'|null} */
export function normalizeRisk(value) {
  const token = selectorToken(value);
  if (['low', 'minor', 'baixa', 'baixo'].includes(token)) return 'low';
  if (['moderate', 'medium', 'normal', 'moderada', 'moderado', 'media', 'medio'].includes(token)) return 'moderate';
  if (['high', 'elevated', 'alta', 'alto'].includes(token)) return 'high';
  if (['xhigh', 'very-high', 'veryhigh', 'muito-alta', 'muito-alto'].includes(token)) return 'xhigh';
  if (['critical', 'critica', 'critico'].includes(token)) return 'critical';
  return null;
}

export function validateGlobalPolicy(policy) {
  const complexities = policy.canonicalComplexities ?? [];
  const risks = policy.canonicalRisks ?? [];
  const expected = [
    ...complexities.filter((complexity) => complexity !== 'critical')
      .flatMap((complexity) => risks.filter((risk) => risk !== 'critical').map((risk) => `${complexity}|${risk}`)),
    ...risks.map((risk) => `critical|${risk}`),
  ];
  const actual = Object.keys(policy.matrix ?? {});
  if (expected.length !== 21 || actual.length !== 21 || expected.some((key) => !actual.includes(key))) {
    throw new Error('global subagent policy must contain the exact 21-route matrix');
  }
  for (const [key, route] of Object.entries(policy.matrix)) {
    if (!policy.models?.[route.model]?.includes(route.effort) || !route.ruleId) {
      throw new Error(`unsupported route capability at ${key}`);
    }
    if ((route.effort === 'ultra') !== (key === 'critical|critical' && route.model === 'gpt-5.6-sol')) {
      throw new Error(`ultra invariant violated at ${key}`);
    }
  }
}

export function loadGlobalPolicy(path = POLICY_PATH) {
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const policy = JSON.parse(raw);
  validateGlobalPolicy(policy);
  return { policy, hash: createHash('sha256').update(raw).digest('hex') };
}

function findContextKitResolver(startPath) {
  let cursor = resolve(startPath);
  const root = parse(cursor).root;
  while (true) {
    const candidate = resolve(cursor, 'contextkit', 'tools', 'scripts', 'model-policy.mjs');
    if (existsSync(candidate)) return { resolver: candidate, projectRoot: cursor };
    if (cursor === root) return null;
    cursor = dirname(cursor);
  }
}

function refusedReceipt(base, fallbackCode, reasons) {
  return { ...base, decision: 'refuse', ruleId: null, model: null, effort: null, fallbackCode, reasons };
}

export function resolveGlobalRoute({ complexity, risk, agent = 'default', projectRoot = process.cwd(), policyPath = POLICY_PATH }) {
  const { policy, hash } = loadGlobalPolicy(policyPath);
  const normalizedComplexity = normalizeComplexity(complexity);
  const normalizedRisk = normalizeRisk(risk);
  const contextKit = findContextKitResolver(projectRoot);
  const base = {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    policyHash: hash,
    authority: contextKit ? `contextkit:${contextKit.resolver}` : `global:${policyPath}`,
    environment: contextKit ? 'contextkit' : 'global-fallback',
    agent,
    rawClassification: { complexity: complexity ?? null, risk: risk ?? null },
    normalizedClassification: { complexity: normalizedComplexity, risk: normalizedRisk },
  };
  if (!normalizedComplexity || !normalizedRisk) {
    return refusedReceipt(base, 'classification-incomplete-or-invalid', ['both canonical dimensions are required']);
  }
  const key = `${normalizedComplexity}|${normalizedRisk}`;
  const globalRoute = policy.matrix[key];
  if (!globalRoute) return refusedReceipt(base, 'route-unmapped', [`no route for ${key}`]);

  if (contextKit) {
    const child = spawnSync(process.execPath, [contextKit.resolver, 'tier', 'fast', '--host', 'codex', '--complexity', normalizedComplexity, '--risk', normalizedRisk], {
      cwd: contextKit.projectRoot, encoding: 'utf8', timeout: 30000,
    });
    if (child.error || child.status !== 0) {
      return refusedReceipt(base, 'contextkit-refused', [`ContextKit resolver exit=${child.status ?? 'error'}`]);
    }
    let projectRoute;
    try { projectRoute = JSON.parse(String(child.stdout).trim()); }
    catch { return refusedReceipt(base, 'contextkit-malformed', ['ContextKit resolver did not emit canonical JSON']); }
    if (projectRoute.decision !== 'dispatch' || projectRoute.model !== globalRoute.model || projectRoute.effort !== globalRoute.effort || projectRoute.ruleId !== globalRoute.ruleId) {
      return refusedReceipt(base, 'contextkit-policy-drift', ['ContextKit route differs from the global matrix']);
    }
  }

  return {
    ...base,
    decision: 'dispatch',
    ruleId: globalRoute.ruleId,
    model: globalRoute.model,
    effort: globalRoute.effort,
    fallbackCode: contextKit ? null : 'contextkit-absent',
    reasons: [contextKit ? 'contextkit-route-validated' : 'global-fallback-route'],
  };
}

function cliArgs(argv) {
  const value = (name) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : null; };
  return {
    complexity: value('complexity'), risk: value('risk'), agent: value('agent') ?? 'default',
    projectRoot: value('project-root') ?? process.cwd(), pretty: argv.includes('--pretty'),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const options = cliArgs(process.argv.slice(2));
    const receipt = resolveGlobalRoute(options);
    console.log(JSON.stringify(receipt, null, options.pretty ? 2 : 0));
    if (receipt.decision !== 'dispatch' || !receipt.model || !receipt.effort || !receipt.ruleId) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ decision: 'error', error: error?.message ?? String(error) }));
    process.exitCode = 3;
  }
}
