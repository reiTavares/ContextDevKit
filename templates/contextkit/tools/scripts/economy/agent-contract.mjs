/**
 * agent-contract.mjs — Single source of the agent-facing output contract for
 * the QA squad (ECON-03, WF0020 Economy Runtime, ADR-0082).
 *
 * WHY this exists as its own module: the QA squad spans multiple host-specific
 * copies (templates/claude/agents/qa-*.md, templates/antigravity/agents/qa-*.md,
 * etc.). Hand-editing 115+ per-host files would introduce drift within a sprint.
 * Instead, this module owns the ONE canonical markdown block that any host
 * generator would inject. A companion drift check (`auditAgentContractDrift` in
 * agent-contract-drift.mjs) reports which existing files diverge from or are
 * missing the canonical block — actual injection is deferred to the generation
 * pipeline (Phase 2).
 *
 * Split note: filesystem I/O (the drift auditor) lives in agent-contract-drift.mjs
 * to keep this file within the 308-line constitution ceiling (§1 +10% tolerance).
 * The two modules form one logical unit; this file is the consumer entry point.
 *
 * Design constraints:
 *   - Advisory + fail-open: drift audit skips unreadable files (never false-pass).
 *   - Zero runtime dependencies — node:* only.
 *   - UNREGISTERED: no hook/boot wiring in Phase 1.
 *   - No hardcoded "contextkit/" in resolve()/join() calls.
 *
 * Public surface:
 *   QA_SQUAD_AGENTS              — the 6 canonical agent names (re-exported for consumers)
 *   resolveAgentContract(n,c,o)  — effective contract for a named agent
 *   renderContractSection(c)     — canonical ## Output Contract markdown block
 *   auditAgentContractDrift(r)   — re-exported from agent-contract-drift.mjs
 *   econCheckAgentContract(r)    — CI check suite → {name,pass,detail}[]
 */

import { resolveContract } from './output-contract.mjs';

// auditAgentContractDrift is declared below to avoid a circular import:
// agent-contract-drift imports renderContractSection from here, so we cannot
// import auditAgentContractDrift at the top level. Instead, we lazy-import it
// inside econCheckAgentContract (the only consumer in this file) and re-export
// it via a thin wrapper so external callers can import it directly if needed.

// ---------------------------------------------------------------------------
// Squad roster
// ---------------------------------------------------------------------------

/**
 * The 6 canonical QA squad agent names. Phase-1 source of truth; Phase-2
 * generators iterate over this list to produce per-host .md files.
 *
 * @type {readonly string[]}
 */
export const QA_SQUAD_AGENTS = Object.freeze([
  'qa-orchestrator',
  'qa-unit',
  'qa-integration',
  'qa-fuzzer',
  'qa-perf',
  'qa-e2e',
]);

// ---------------------------------------------------------------------------
// resolveAgentContract
// ---------------------------------------------------------------------------

/**
 * Returns the effective output contract for a named QA squad agent.
 *
 * Delegates entirely to resolveContract (output-contract.mjs) — the override
 * floor (critical/high must stay null) is enforced there.
 *
 * @param {string} agentName - One of QA_SQUAD_AGENTS (reserved for per-agent
 *   routing in a future Phase-2 dispatch table; currently used as a key lookup
 *   in perAgentOverrides).
 * @param {object|null|undefined} cfg - Full ContextDevKit config object.
 * @param {Record<string, object>} [perAgentOverrides={}]
 *   Map from agent name to partial override block. If the agent name is present,
 *   that override is forwarded to resolveContract.
 * @returns {typeof import('./economy-defaults.mjs').ECONOMY_DEFAULTS['output']}
 * @throws {import('./output-contract.mjs').ContractFloorViolation}
 *   When the per-agent override attempts to cap critical or high findings.
 */
export function resolveAgentContract(agentName, cfg, perAgentOverrides = {}) {
  const safeOverrides =
    perAgentOverrides && typeof perAgentOverrides === 'object' && !Array.isArray(perAgentOverrides)
      ? perAgentOverrides
      : {};
  return resolveContract(cfg, safeOverrides[agentName]);
}

// ---------------------------------------------------------------------------
// renderContractSection
// ---------------------------------------------------------------------------

/**
 * Renders the canonical `## Output Contract` markdown section from a resolved
 * contract object.
 *
 * CANONICAL form only — deterministic field order so a diff tool can compare
 * this string against what is embedded in each per-host .md file. Change the
 * content only via a new ADR (WF0020 / ADR-0082).
 *
 * Rules expressed in the block (stable):
 *   - artifact-first: workers write to an artifact first; response = pointer.
 *   - no-echo: workers never re-paste raw tool output.
 *   - per-severity caps: critical and high are UNCAPPED (evidence-preservation).
 *   - evidence rule: every critical/high finding MUST carry evidence (loc + why).
 *
 * @param {{ artifactFirst: boolean, noEcho: boolean, defaultMaxTokens: number,
 *           finalResponseMaxLines: number,
 *           maxFindings: { critical: number|null, high: number|null,
 *                          medium: number|null, low: number|null } }} contract
 * @returns {string} The canonical markdown block (starts with `## Output Contract`).
 */
export function renderContractSection(contract) {
  const mf = contract.maxFindings;
  const capStr = (v) => (v === null || v === undefined ? 'UNCAPPED' : String(v));

  return [
    '## Output Contract',
    '',
    `- **artifact-first**: ${contract.artifactFirst ? 'yes' : 'no'} — write findings to an artifact first; the response is a summary pointer.`,
    `- **no-echo**: ${contract.noEcho ? 'yes' : 'no'} — never re-paste raw tool output into your response.`,
    `- **max tokens (advisory)**: ${contract.defaultMaxTokens}`,
    `- **max response lines**: ${contract.finalResponseMaxLines}`,
    '',
    '### Max findings by severity',
    '',
    `| Severity | Cap |`,
    `| --- | --- |`,
    `| critical | ${capStr(mf.critical)} |`,
    `| high     | ${capStr(mf.high)} |`,
    `| medium   | ${capStr(mf.medium)} |`,
    `| low      | ${capStr(mf.low)} |`,
    '',
    '### Evidence rule',
    '',
    'Every **critical** or **high** finding MUST carry evidence: file path + line',
    'reference + a one-sentence explanation of why it is critical or high.',
    'Findings without evidence are rejected by the qa-orchestrator.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// auditAgentContractDrift — thin re-export wrapper (avoids circular import)
// ---------------------------------------------------------------------------

/**
 * Re-export shim for auditAgentContractDrift.
 *
 * The real implementation lives in agent-contract-drift.mjs (which imports
 * renderContractSection from this file). A top-level import would be circular,
 * so we expose a thin async-loaded wrapper here for callers who import from
 * agent-contract.mjs only.
 *
 * For direct use (e.g., from tests), import from agent-contract-drift.mjs.
 *
 * @param {string} root
 * @returns {ReturnType<import('./agent-contract-drift.mjs').auditAgentContractDrift>}
 */
export async function auditAgentContractDrift(root) {
  const { auditAgentContractDrift: impl } = await import('./agent-contract-drift.mjs');
  return impl(root);
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for ECON-03 (agent-contract module).
 *
 * Assertions:
 *   1. renderContractSection is deterministic + non-empty + contains the
 *      evidence-rule and per-severity caps.
 *   2. resolveAgentContract refuses to cap critical or high (floor enforced).
 *   3. auditAgentContractDrift runs fail-open on a missing directory.
 *   4. QA_SQUAD_AGENTS has exactly 6 entries with the correct names.
 *
 * @param {string} root - Repo root path (forwarded to drift auditor).
 * @returns {Promise<{ name: string, pass: boolean, detail: string }[]>}
 */
export async function econCheckAgentContract(root) {
  const { auditAgentContractDrift: auditImpl } = await import('./agent-contract-drift.mjs');
  const checkResults = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      checkResults.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      checkResults.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} condition @param {string} msg */
  function assert(condition, msg) {
    if (!condition) throw new Error(msg);
  }

  // Check 1: renderContractSection is non-empty and deterministic.
  check('renderContractSection is non-empty and deterministic', () => {
    const contract = resolveContract(null, null);
    const first  = renderContractSection(contract);
    const second = renderContractSection(contract);
    assert(typeof first === 'string' && first.length > 0, 'renderContractSection returned empty string');
    assert(first === second, 'renderContractSection is not deterministic (two calls differ)');
  });

  // Check 2: rendered block starts with ## Output Contract heading.
  check('renderContractSection starts with ## Output Contract', () => {
    const section = renderContractSection(resolveContract(null, null));
    assert(section.startsWith('## Output Contract'), 'section does not start with ## Output Contract');
  });

  // Check 3: rendered block contains the evidence rule.
  check('renderContractSection contains evidence rule', () => {
    const section = renderContractSection(resolveContract(null, null));
    assert(section.includes('evidence') && section.includes('critical'), 'evidence rule missing from rendered section');
  });

  // Check 4: rendered block contains all four severity rows.
  check('renderContractSection contains all four severity rows', () => {
    const section = renderContractSection(resolveContract(null, null));
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      assert(section.includes(sev), `severity row '${sev}' missing`);
    }
  });

  // Check 5: critical and high are labelled UNCAPPED.
  check('renderContractSection labels critical and high as UNCAPPED', () => {
    const section   = renderContractSection(resolveContract(null, null));
    const critLine  = section.split('\n').find((l) => l.includes('critical'));
    const highLine  = section.split('\n').find((l) => l.includes('high'));
    assert(critLine?.includes('UNCAPPED'), 'critical row must say UNCAPPED');
    assert(highLine?.includes('UNCAPPED'), 'high row must say UNCAPPED');
  });

  // Check 6: resolveAgentContract refuses to cap critical.
  check('resolveAgentContract refuses override that caps critical', () => {
    let threw = false;
    try {
      resolveAgentContract('qa-unit', null, { 'qa-unit': { maxFindings: { critical: 1 } } });
    } catch { threw = true; }
    assert(threw, 'expected ContractFloorViolation for critical cap override');
  });

  // Check 7: resolveAgentContract refuses to cap high.
  check('resolveAgentContract refuses override that caps high', () => {
    let threw = false;
    try {
      resolveAgentContract('qa-orchestrator', null, { 'qa-orchestrator': { maxFindings: { high: 2 } } });
    } catch { threw = true; }
    assert(threw, 'expected ContractFloorViolation for high cap override');
  });

  // Check 8: drift auditor is fail-open on a missing directory.
  check('auditAgentContractDrift fail-open on missing directory', () => {
    const result = auditImpl('/nonexistent/__no_such_dir__');
    assert(Array.isArray(result), 'expected array on missing dir');
    assert(!result.some((r) => r.status === 'drift'), 'unexpected drift entries for missing directory');
  });

  // Check 9: drift auditor is fail-open on null root.
  check('auditAgentContractDrift fail-open on non-string root', () => {
    let threw = false;
    try { auditImpl(null); } catch { threw = true; }
    assert(!threw, 'auditAgentContractDrift must not throw on null root');
  });

  // Check 10: QA_SQUAD_AGENTS has exactly 6 entries.
  check('QA_SQUAD_AGENTS has 6 entries', () => {
    assert(QA_SQUAD_AGENTS.length === 6, `expected 6 squad agents, got ${QA_SQUAD_AGENTS.length}`);
  });

  // Check 11: QA_SQUAD_AGENTS contains all expected names.
  check('QA_SQUAD_AGENTS contains all expected names', () => {
    for (const name of ['qa-orchestrator', 'qa-unit', 'qa-integration', 'qa-fuzzer', 'qa-perf', 'qa-e2e']) {
      assert(QA_SQUAD_AGENTS.includes(name), `missing expected agent: ${name}`);
    }
  });

  return checkResults;
}
