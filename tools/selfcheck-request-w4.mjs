/**
 * Self-check — Request Orchestration W4 telemetry + parity (WF0038, ADR-0107 §22/§23/§24).
 *
 *   1.  request-telemetry.mjs imports cleanly + zero-dep
 *   2.  envelopeToRecord: derives agentsPlanned + debateRequired from an envelope
 *   3.  recordOrchestration → readOrchestrationTelemetry roundtrip (temp root)
 *   4.  orchestrationEffectiveness: per-agent selectionCount + playbook tallies
 *   5.  host-agnostic parity: the orchestration core modules carry no host-specific
 *       branching (council behavior identical across Claude/Codex/Antigravity, §22)
 *   6.  hook records telemetry (recordOrchestration wired)
 *   7.  clean-clone: new runtime modules + registries live under templates/contextkit
 *       (the installer copies that tree wholesale → greenfield installs get them)
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module selfcheck-request-w4
 */
import { readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXEC = 'templates/contextkit/runtime/execution';
async function read(p) { try { return await readFile(p, 'utf-8'); } catch { return ''; } }

/**
 * Runs the W4 telemetry + parity self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runRequestW4Checks({ ok, bad }, { KIT }) {
  console.log('Checking Request Orchestration W4 (telemetry + parity)...');

  const telPath = resolve(KIT, EXEC, 'request-telemetry.mjs');
  const telSrc = await read(telPath);
  /^import\s/m.test(telSrc) && !/from\s+['"`](?!\.|node:)/m.test(telSrc)
    ? ok('request-telemetry.mjs is zero-dep')
    : bad('request-telemetry.mjs zero-dep check failed');

  let tel;
  try { tel = await import(pathToFileURL(telPath).href); ok('request-telemetry.mjs imports cleanly'); }
  catch (err) { bad(`request-telemetry import failed: ${err?.message ?? err}`); return; }
  const { envelopeToRecord, recordOrchestration, readOrchestrationTelemetry, orchestrationEffectiveness } = tel;

  // ── 2. envelopeToRecord ──────────────────────────────────────────────────
  const envelope = {
    requestId: 'req-x', context: { primaryType: 'business' },
    classification: { intent: 'material-decision', complexity: 'architectural', risk: 'high', materialityScore: 0.86 },
    deliberation: { required: true },
    agents: { lead: 'product-owner', council: ['product-owner', 'architect', 'growth'], reviewers: ['code-reviewer'] },
    playbooks: [{ id: 'squad-security', sections: ['👥 Members', '📝 Best Practices'] }],
    routing: { mode: 'shadow' }, autonomy: { effectiveGrade: 4 },
  };
  const rec = envelopeToRecord(envelope, ['product-owner', 'architect']);
  rec.debateRequired === true && rec.agentsPlanned.includes('architect') && rec.playbookSections === 2 && rec.agentsDispatched.length === 2
    ? ok('envelopeToRecord: derives planned/dispatched/debate/sections')
    : bad(`envelopeToRecord wrong: ${JSON.stringify({ d: rec.debateRequired, p: rec.agentsPlanned.length, s: rec.playbookSections })}`);

  // ── 3. roundtrip (temp root under gitignored runs/) ──────────────────────
  const tmpRoot = join(KIT, 'runs', 'w4-telemetry-selftest');
  try {
    await rm(tmpRoot, { recursive: true, force: true });
    recordOrchestration(tmpRoot, envelope, ['product-owner', 'architect']);
    recordOrchestration(tmpRoot, { ...envelope, requestId: 'req-y' }, ['product-owner']);
    const records = readOrchestrationTelemetry(tmpRoot);
    records.length === 2 && records[0].requestId === 'req-x'
      ? ok('recordOrchestration → readOrchestrationTelemetry roundtrip (2 records)')
      : bad(`telemetry roundtrip wrong: ${records.length} records`);

    // ── 4. effectiveness ────────────────────────────────────────────────────
    const eff = orchestrationEffectiveness(records);
    eff.agents['product-owner']?.selectionCount === 2 && eff.agents['product-owner']?.dispatchCount === 2
      && eff.playbooks['squad-security']?.selectionCount === 2 && eff.totals.debatesRequired === 2
      ? ok('orchestrationEffectiveness: agent + playbook tallies correct')
      : bad(`effectiveness wrong: ${JSON.stringify(eff.agents['product-owner'])} pb=${JSON.stringify(eff.playbooks['squad-security'])}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }

  // ── 5. host-agnostic parity ──────────────────────────────────────────────
  const coreModules = ['request-orchestrator.mjs', 'request-classify.mjs', 'request-agent-select.mjs', 'playbook-compile.mjs', 'request-directive.mjs'];
  let hostLeak = null;
  for (const m of coreModules) {
    const src = await read(resolve(KIT, EXEC, m));
    // The pure core must not branch on a specific host name (host handling is
    // isolated in host-adapter.mjs, used only by the thin hook adapter).
    if (/['"`](codex|antigravity)['"`]/i.test(src)) { hostLeak = m; break; }
  }
  hostLeak
    ? bad(`host-agnostic parity violated: ${hostLeak} hardcodes a host name`)
    : ok('host-agnostic parity: orchestration core has no host-specific branching (§22)');

  // ── 6. hook records telemetry ────────────────────────────────────────────
  const hookSrc = await read(resolve(KIT, 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs'));
  /recordOrchestration/.test(hookSrc)
    ? ok('execution-contract-hook records orchestration telemetry')
    : bad('execution-contract-hook missing telemetry recording');

  // ── 7. clean-clone / install presence ────────────────────────────────────
  const installArtifacts = [
    `${EXEC}/request-orchestrator.mjs`, `${EXEC}/request-telemetry.mjs`,
    'templates/contextkit/policy/agent-capability-registry.json',
    'templates/contextkit/policy/playbook-registry.json',
    'templates/contextkit/runtime/config/defaults-orchestration.mjs',
  ];
  const missing = installArtifacts.filter((p) => !existsSync(resolve(KIT, p)));
  missing.length === 0
    ? ok('clean-clone: all orchestration artifacts under templates/contextkit (installer-copied)')
    : bad(`clean-clone: missing source artifacts: ${missing.join(', ')}`);
}
