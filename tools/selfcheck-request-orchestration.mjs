/**
 * Self-check — Automatic Request Orchestration W1 (WF0038, ADR-0107).
 *
 * Asserts the request-level orchestration foundations are internally sound:
 *   1.  request-classify / request-envelope / request-orchestrator import cleanly
 *   2.  zero-dep invariant on all three modules + defaults-orchestration
 *   3.  classifyRequest: trivial typo → trivial complexity, needsDebate false
 *   4.  classifyRequest: material business decision → primary 'business',
 *       intent 'material-decision', needsDebate true, materiality ≥ 0.6
 *   5.  classifyRequest: architectural+material → primary 'decision'
 *   6.  classifyRequest fail-open: bad input → conservative implementation verdict
 *   7.  buildEnvelope: schemaVersion '1.0.0', sha256 textHash, schema-complete
 *   8.  orchestrate: trivial → directExecutionAllowed true, deliberation not required
 *   9.  orchestrate: material business at grade 4 → deliberation required
 *   10. orchestrate: grade-2 material → deliberation NOT auto-required (propose-only)
 *   11. parseOverrides recognizes 'do not debate this'
 *   12. config: ORCHESTRATION_DEFAULTS wired + autoInvoke.standardRequests + threshold
 *
 * Zero runtime dependencies — node:* only (relative import of modules under test).
 *
 * @module selfcheck-request-orchestration
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXEC = 'templates/contextkit/runtime/execution';
const CONFIG = 'templates/contextkit/runtime/config';

/**
 * Scans a module for non-relative, non-node: imports (zero-dep invariant).
 * @param {string} modPath absolute path
 * @returns {Promise<string|null>} error string or null
 */
async function zeroDepError(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return `could not read: ${err?.message ?? err}`; }
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) return `imports from "${m[1]}"`;
  }
  return null;
}

/**
 * Runs the Request Orchestration W1 self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root (absolute path)
 * @returns {Promise<void>}
 */
export async function runRequestOrchestrationChecks({ ok, bad }, { KIT }) {
  console.log('Checking Automatic Request Orchestration W1 (WF0038, ADR-0107)...');

  const classifyPath = resolve(KIT, EXEC, 'request-classify.mjs');
  const envelopePath = resolve(KIT, EXEC, 'request-envelope.mjs');
  const orchPath = resolve(KIT, EXEC, 'request-orchestrator.mjs');
  const defOrchPath = resolve(KIT, CONFIG, 'defaults-orchestration.mjs');

  // ── 2. zero-dep invariant ────────────────────────────────────────────────
  for (const [name, p] of [['request-classify', classifyPath], ['request-envelope', envelopePath],
    ['request-orchestrator', orchPath], ['defaults-orchestration', defOrchPath]]) {
    const err = await zeroDepError(p);
    err ? bad(`${name}.mjs violates zero-dep: ${err}`) : ok(`${name}.mjs is zero-dep`);
  }

  // ── 1. clean import ──────────────────────────────────────────────────────
  let classifyMod; let envMod; let orchMod; let cfgMod;
  try {
    classifyMod = await import(pathToFileURL(classifyPath).href);
    envMod = await import(pathToFileURL(envelopePath).href);
    orchMod = await import(pathToFileURL(orchPath).href);
    cfgMod = await import(pathToFileURL(resolve(KIT, CONFIG, 'defaults.mjs')).href);
    ok('request-* modules import cleanly');
  } catch (err) {
    bad(`request-* import failed: ${err?.message ?? err}`);
    return;
  }
  const { classifyRequest } = classifyMod;
  const { buildEnvelope, ENVELOPE_SCHEMA_VERSION } = envMod;
  const { orchestrate, parseOverrides } = orchMod;
  const { DEFAULT_CONFIG } = cfgMod;

  // ── 3. trivial typo ──────────────────────────────────────────────────────
  const trivialSignals = { tier: 'trivial', domain: 'general', needsAdr: false, work: { kind: 'maintenance' } };
  const trivial = classifyRequest(trivialSignals, { requestText: 'fix this typo' });
  trivial.complexity === 'trivial' && trivial.needsDebate === false
    ? ok('classifyRequest: trivial typo → trivial complexity, no debate')
    : bad(`classifyRequest trivial wrong: complexity=${trivial.complexity} needsDebate=${trivial.needsDebate}`);

  // ── 4. material business decision ────────────────────────────────────────
  const bizSignals = {
    tier: 'architectural', domain: 'general', needsAdr: true, work: { nature: 'business' },
    decisionNeed: { materialityScore: 0.86, needVerdict: 'NEEDS_DECISION', triple: { primaryContext: { type: 'business' } } },
  };
  const biz = classifyRequest(bizSignals, { businessId: 'BIZ-0001', requestText: 'Should this become a standalone paid product or stay in the platform?' });
  biz.primaryType === 'business' && biz.intent === 'material-decision' && biz.needsDebate === true && biz.materialityScore >= 0.6
    ? ok('classifyRequest: material business → business/material-decision/needsDebate')
    : bad(`classifyRequest business wrong: ${JSON.stringify({ p: biz.primaryType, i: biz.intent, d: biz.needsDebate, m: biz.materialityScore })}`);

  // ── 5. architectural decision ────────────────────────────────────────────
  const archSignals = {
    tier: 'architectural', domain: 'general', needsAdr: true, work: {},
    decisionNeed: { materialityScore: 0.7, triple: { primaryContext: { type: 'platform' } } },
  };
  const arch = classifyRequest(archSignals, { requestText: 'Which database architecture should we adopt: postgres or dynamo?' });
  arch.primaryType === 'decision'
    ? ok('classifyRequest: architectural+material → primary decision')
    : bad(`classifyRequest arch wrong: primary=${arch.primaryType}`);

  // ── 6. fail-open ─────────────────────────────────────────────────────────
  const failOpen = classifyRequest(null, null);
  failOpen.primaryType === 'implementation' && Array.isArray(failOpen.reasonCodes)
    ? ok('classifyRequest: fail-open → conservative implementation verdict')
    : bad('classifyRequest fail-open did not degrade safely');

  // ── 7. buildEnvelope ─────────────────────────────────────────────────────
  const env = buildEnvelope({ requestId: 'req-1', requestText: 'hello', classification: biz, context: { businessId: 'BIZ-0001' }, autonomy: {}, routing: {}, receivedAt: '2026-06-20T00:00:00Z' });
  ENVELOPE_SCHEMA_VERSION === '1.0.0' && env.request.textHash.startsWith('sha256:') && env.context.primaryType === 'business' && env.schemaVersion === '1.0.0'
    ? ok('buildEnvelope: schema 1.0.0, sha256 textHash, schema-complete')
    : bad(`buildEnvelope wrong: schema=${env.schemaVersion} hash=${env.request.textHash?.slice(0, 12)}`);

  // ── 8. orchestrate trivial ───────────────────────────────────────────────
  const cfg4 = { autonomy: { grade: 4 }, deliberations: { active: true }, routing: { mode: 'shadow' } };
  const oTrivial = orchestrate({ requestId: 'req-t', requestText: 'fix this typo', signals: trivialSignals }, { config: cfg4, level: 7 });
  oTrivial.routing.directExecutionAllowed === true && oTrivial.deliberation?.required === false
    ? ok('orchestrate: trivial → direct execution, no debate')
    : bad(`orchestrate trivial wrong: direct=${oTrivial.routing.directExecutionAllowed} debate=${oTrivial.deliberation?.required}`);

  // ── 9. orchestrate material business at grade 4 ──────────────────────────
  const oBiz = orchestrate({ requestId: 'req-b', requestText: 'Should this become a standalone paid product?', signals: bizSignals, context: { businessId: 'BIZ-0001' } }, { config: cfg4, level: 7 });
  oBiz.deliberation?.required === true && oBiz.autonomy.effectiveGrade === 4
    ? ok('orchestrate: material business @grade4 → deliberation required')
    : bad(`orchestrate business wrong: debate=${oBiz.deliberation?.required} grade=${oBiz.autonomy.effectiveGrade}`);

  // ── 10. grade-2 material → propose-only ──────────────────────────────────
  const cfg2 = { autonomy: { grade: 2 }, deliberations: { active: true }, routing: { mode: 'shadow' } };
  const oBiz2 = orchestrate({ requestId: 'req-b2', requestText: 'Should this become a paid product?', signals: bizSignals, context: { businessId: 'BIZ-0001' } }, { config: cfg2, level: 7 });
  oBiz2.deliberation?.required === false && oBiz2.autonomy.effectiveGrade === 2
    ? ok('orchestrate: grade-2 material → not auto-required (propose-only, no silent elevation)')
    : bad(`orchestrate grade-2 wrong: debate=${oBiz2.deliberation?.required} grade=${oBiz2.autonomy.effectiveGrade}`);

  // ── 11. parseOverrides ───────────────────────────────────────────────────
  parseOverrides('Please do not debate this, just do it').includes('no-debate')
    ? ok('parseOverrides: recognizes "do not debate"')
    : bad('parseOverrides failed to recognize "do not debate"');

  // ── 12. config wiring ────────────────────────────────────────────────────
  const orch = DEFAULT_CONFIG.orchestration;
  orch && orch.enabled === true && orch.specialists?.maxParallelAgents === 5
    && DEFAULT_CONFIG.deliberations?.autoInvoke?.standardRequests === true
    && DEFAULT_CONFIG.deliberations?.materialityThreshold === 0.6
    ? ok('config: orchestration defaults + autoInvoke.standardRequests + materialityThreshold wired')
    : bad('config: orchestration/deliberations defaults not wired as expected');
}
