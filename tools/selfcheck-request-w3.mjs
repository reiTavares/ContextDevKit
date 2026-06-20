/**
 * Self-check — Request Orchestration W3 activation (WF0038, ADR-0107 §4/§13/§21).
 *
 * Asserts the activation layer is sound:
 *   1.  request-directive.mjs imports cleanly + zero-dep
 *   2.  renderDirective: material business → "DELIBERATION REQUIRED" + council voices
 *   3.  renderDirective: trivial-direct → '' (silent, over-orchestration guard)
 *   4.  comparePlannedActual: required debate, 0 council dispatched → debate missing
 *   5.  comparePlannedActual: required debate, quorum dispatched → ok
 *   6.  comparePlannedActual: planned lead not dispatched → missingSpecialists
 *   7.  hook wiring: execution-contract-hook imports orchestrate/saveEnvelope/renderDirective
 *   8.  completion-gate wiring: imports loadEnvelope + comparePlannedActual
 *   9.  settings-compose still registers execution-contract-hook (regression)
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module selfcheck-request-w3
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXEC = 'templates/contextkit/runtime/execution';
const HOOKS = 'templates/contextkit/runtime/hooks';

async function read(p) { try { return await readFile(p, 'utf-8'); } catch { return ''; } }

/**
 * Runs the W3 activation self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runRequestW3Checks({ ok, bad }, { KIT }) {
  console.log('Checking Request Orchestration W3 (activation)...');

  const directivePath = resolve(KIT, EXEC, 'request-directive.mjs');
  const directiveSrc = await read(directivePath);
  /^import\s/m.test(directiveSrc) && !/from\s+['"`](?!\.|node:)/m.test(directiveSrc)
    ? ok('request-directive.mjs is zero-dep')
    : bad('request-directive.mjs zero-dep check failed');

  let dir; let orchMod; let envMod;
  try {
    dir = await import(pathToFileURL(directivePath).href);
    orchMod = await import(pathToFileURL(resolve(KIT, EXEC, 'request-orchestrator.mjs')).href);
    envMod = await import(pathToFileURL(resolve(KIT, EXEC, 'request-envelope.mjs')).href);
    ok('W3 modules import cleanly');
  } catch (err) { bad(`W3 import failed: ${err?.message ?? err}`); return; }
  const { renderDirective, comparePlannedActual } = dir;
  const { orchestrate } = orchMod;

  // ── 2. material directive ────────────────────────────────────────────────
  const bizSignals = {
    tier: 'architectural', domain: 'general', needsAdr: true, work: { nature: 'business' },
    decisionNeed: { materialityScore: 0.86, needVerdict: 'NEEDS_DECISION', triple: { primaryContext: { type: 'business' } } },
  };
  const cfg4 = { autonomy: { grade: 4 }, deliberations: { active: true, council: { min: 3, max: 6 } }, routing: { mode: 'shadow' }, orchestration: { playbooks: { maxContextTokens: 3000 } } };
  const bizEnv = orchestrate({ requestId: 'req-b', requestText: 'Should this be a standalone paid product?', signals: bizSignals, context: { businessId: 'BIZ-0001' } }, { root: KIT, config: cfg4 });
  const dirOut = renderDirective(bizEnv);
  dirOut.includes('DELIBERATION REQUIRED') && /council:/.test(dirOut) && dirOut.includes('CONTEXTKIT-ORCHESTRATION')
    ? ok('renderDirective: material business → DELIBERATION REQUIRED + council')
    : bad(`renderDirective material wrong: ${dirOut.slice(0, 80)}`);

  // ── 3. trivial silent ────────────────────────────────────────────────────
  const trivSignals = { tier: 'trivial', domain: 'general', needsAdr: false, work: { kind: 'maintenance' } };
  const trivEnv = orchestrate({ requestId: 'req-t', requestText: 'fix this typo', signals: trivSignals }, { root: KIT, config: cfg4 });
  renderDirective(trivEnv) === ''
    ? ok('renderDirective: trivial-direct → silent (no directive)')
    : bad('renderDirective: trivial produced a directive (over-orchestration)');

  // ── 4/5/6. planned-vs-actual ─────────────────────────────────────────────
  const planned = { agents: { lead: 'product-owner', council: ['product-owner', 'architect', 'growth'], reviewers: ['code-reviewer'] }, deliberation: { required: true }, classification: { intent: 'material-decision' } };
  const none = comparePlannedActual(planned, []);
  none.requiredDebateMissing === true && !none.ok
    ? ok('comparePlannedActual: required debate, 0 dispatched → debate missing')
    : bad('comparePlannedActual: did not flag missing debate');

  const quorum = comparePlannedActual(planned, ['product-owner', 'architect', 'code-reviewer']);
  quorum.requiredDebateMissing === false
    ? ok('comparePlannedActual: quorum dispatched → debate satisfied')
    : bad('comparePlannedActual: false-flagged a satisfied debate');

  const missLead = comparePlannedActual({ agents: { lead: 'ux-designer', council: [], reviewers: [] }, deliberation: { required: false } }, ['architect']);
  missLead.missingSpecialists.includes('ux-designer')
    ? ok('comparePlannedActual: missing lead specialist detected')
    : bad('comparePlannedActual: missed an undispatched lead');

  // ── 7/8/9. wiring regressions ────────────────────────────────────────────
  const hookSrc = await read(resolve(KIT, HOOKS, 'execution-contract-hook.mjs'));
  /orchestrate/.test(hookSrc) && /saveEnvelope/.test(hookSrc) && /renderDirective/.test(hookSrc)
    ? ok('execution-contract-hook wires orchestrate + saveEnvelope + renderDirective')
    : bad('execution-contract-hook missing orchestration wiring');

  const gateSrc = await read(resolve(KIT, HOOKS, 'completion-gate.mjs'));
  /loadEnvelope/.test(gateSrc) && /comparePlannedActual/.test(gateSrc)
    ? ok('completion-gate wires planned-vs-actual check')
    : bad('completion-gate missing planned-vs-actual wiring');

  const composeSrc = await read(resolve(KIT, 'templates/contextkit/runtime/config/settings-compose.mjs'));
  /execution-contract-hook\.mjs/.test(composeSrc)
    ? ok('settings-compose still registers execution-contract-hook (regression)')
    : bad('settings-compose no longer registers the request hook');

  // ── 10. orchestration gated by minLevel in the hook (inert below L7) ─────
  /orch\.minLevel/.test(hookSrc) && /orch\??\.enabled/.test(hookSrc)
    ? ok('hook gates orchestration on enabled + minLevel (inert below L7)')
    : bad('hook does not gate orchestration on minLevel');

  // ── 11. completion-gate deny is mode-gated (advisory only nudges, §2) ────
  /mode !== 'advisory'/.test(gateSrc)
    ? ok('completion-gate deny is mode-gated (advisory never blocks, ADR §2)')
    : bad('completion-gate deny is NOT mode-gated — advisory could over-block');
}
