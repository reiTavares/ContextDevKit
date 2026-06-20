/**
 * Self-check — Request Orchestration W2 registries + selection (WF0038, ADR-0107 §9/§10/§16).
 *
 * Asserts the Agent Capability Registry, Playbook Capability Registry, the
 * deterministic agent scoring and the bounded playbook section compiler are sound:
 *   1.  request-agent-select / playbook-compile import cleanly + zero-dep
 *   2.  agent-capability-registry.json parses, ≥ 20 agents, required §9 fields
 *   3.  playbook-registry.json parses, ≥ 10 playbooks, required §16 fields
 *   4.  selectAgents: high-risk security request → security selected with reasons
 *   5.  selectAgents: material business → council has product-owner + architect,
 *       synthesizer is DISTINCT from every council voice (§11/§18)
 *   6.  selectAgents: trivial → anti-trigger excludes reviewers (empty/direct)
 *   7.  selectPlaybooks: security context → squad-security selected
 *   8.  extractSections: finds a named section (emoji-heading tolerant)
 *   9.  compilePlaybookContext: respects the token budget, never whole-file
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module selfcheck-request-registries
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXEC = 'templates/contextkit/runtime/execution';
const POLICY = 'templates/contextkit/policy';

/** Zero-dep import scan. */
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
 * Runs the W2 registry + selection self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runRequestRegistryChecks({ ok, bad }, { KIT }) {
  console.log('Checking Request Orchestration W2 (registries + selection)...');

  const selectPath = resolve(KIT, EXEC, 'request-agent-select.mjs');
  const compilePath = resolve(KIT, EXEC, 'playbook-compile.mjs');
  const agentRegPath = resolve(KIT, POLICY, 'agent-capability-registry.json');
  const pbRegPath = resolve(KIT, POLICY, 'playbook-registry.json');

  // ── 1. zero-dep + import ──────────────────────────────────────────────────
  for (const [name, p] of [['request-agent-select', selectPath], ['playbook-compile', compilePath]]) {
    const err = await zeroDepError(p);
    err ? bad(`${name}.mjs violates zero-dep: ${err}`) : ok(`${name}.mjs is zero-dep`);
  }
  let selMod; let pbMod;
  try {
    selMod = await import(pathToFileURL(selectPath).href);
    pbMod = await import(pathToFileURL(compilePath).href);
    ok('W2 selection modules import cleanly');
  } catch (err) { bad(`W2 import failed: ${err?.message ?? err}`); return; }
  const { selectAgents } = selMod;
  const { selectPlaybooks, extractSections, compilePlaybookContext } = pbMod;

  // ── 2/3. registries parse + shape ────────────────────────────────────────
  let agentReg; let pbReg;
  try {
    agentReg = JSON.parse(await readFile(agentRegPath, 'utf-8'));
    pbReg = JSON.parse(await readFile(pbRegPath, 'utf-8'));
  } catch (err) { bad(`registry parse failed: ${err?.message ?? err}`); return; }

  const a0 = agentReg.agents?.[0] ?? {};
  Array.isArray(agentReg.agents) && agentReg.agents.length >= 20
    && ['capabilities', 'intents', 'pathPatterns', 'riskTriggers', 'antiTriggers', 'preferredRole', 'modelTier'].every((k) => k in a0)
    ? ok(`agent-capability-registry: ${agentReg.agents.length} agents, §9 fields present`)
    : bad('agent-capability-registry: too few agents or missing §9 fields');

  const pb0 = pbReg.playbooks?.[0] ?? {};
  Array.isArray(pbReg.playbooks) && pbReg.playbooks.length >= 10
    && ['intents', 'contexts', 'requiredSections', 'sourcePath', 'riskTriggers'].every((k) => k in pb0)
    ? ok(`playbook-registry: ${pbReg.playbooks.length} playbooks, §16 fields present`)
    : bad('playbook-registry: too few playbooks or missing §16 fields');

  // ── 4. high-risk security selection ──────────────────────────────────────
  const secCls = { primaryType: 'implementation', intent: 'security-review', complexity: 'feature', risk: 'high', needsDebate: false };
  const secSel = selectAgents(secCls, { paths: ['src/auth/login.ts'] }, {}, agentReg);
  (secSel.lead === 'security' || secSel.reviewers.includes('security') || secSel.reasonCodes.some((r) => r.includes('security')))
    ? ok('selectAgents: high-risk security request → security selected')
    : bad(`selectAgents security wrong: lead=${secSel.lead} reviewers=${secSel.reviewers}`);

  // ── 5. material business council + distinct synthesizer ──────────────────
  const bizCls = { primaryType: 'business', intent: 'material-decision', complexity: 'architectural', risk: 'high', needsDebate: true };
  const bizSel = selectAgents(bizCls, { paths: [] }, { deliberations: { council: { min: 3, max: 6 } } }, agentReg);
  const councilOk = bizSel.council.includes('product-owner') && bizSel.council.includes('architect') && bizSel.council.length >= 3;
  const synthDistinct = bizSel.synthesizer && !bizSel.council.includes(bizSel.synthesizer);
  councilOk && synthDistinct
    ? ok(`selectAgents: material business → council=[${bizSel.council.join(',')}], synthesizer '${bizSel.synthesizer}' distinct`)
    : bad(`selectAgents business wrong: council=${JSON.stringify(bizSel.council)} synth=${bizSel.synthesizer}`);

  // ── 6. trivial anti-trigger ──────────────────────────────────────────────
  const trivCls = { primaryType: 'documentation', intent: 'documentation', complexity: 'trivial', risk: 'low', needsDebate: false };
  const trivSel = selectAgents(trivCls, { paths: [] }, {}, agentReg);
  trivSel.council.length === 0
    ? ok('selectAgents: trivial/doc → no council (anti-trigger respected)')
    : bad(`selectAgents trivial wrong: council=${JSON.stringify(trivSel.council)}`);

  // ── 7. playbook selection ────────────────────────────────────────────────
  const pbSel = selectPlaybooks(secCls, { paths: ['src/auth/x.ts'] }, pbReg);
  pbSel.selected.some((pb) => pb.id === 'squad-security')
    ? ok('selectPlaybooks: security context → squad-security selected')
    : bad(`selectPlaybooks wrong: ${pbSel.selected.map((p) => p.id).join(',')}`);

  // ── 8. extractSections (emoji-heading tolerant) ──────────────────────────
  const md = '# Title\n\n## 👥 Members\nalice, bob\n\n## 📝 Best Practices\ndo the thing\n';
  const ex = extractSections(md, ['👥 Members', 'Missing Section']);
  ex.found.length === 1 && ex.found[0].text.includes('alice') && ex.missing.includes('Missing Section')
    ? ok('extractSections: finds named section, reports missing')
    : bad(`extractSections wrong: found=${ex.found.length} missing=${JSON.stringify(ex.missing)}`);

  // ── 9. token budget ──────────────────────────────────────────────────────
  const compiled = compilePlaybookContext(pbSel.selected, { root: KIT, maxTokens: 50 });
  compiled.injectedTokens <= 50
    ? ok(`compilePlaybookContext: respects token budget (${compiled.injectedTokens} ≤ 50)`)
    : bad(`compilePlaybookContext exceeded budget: ${compiled.injectedTokens}`);
}
