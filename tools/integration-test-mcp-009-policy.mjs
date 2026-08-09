/**
 * integration-test-mcp-009-policy.mjs — MCP-009 AC#4: degraded mode + policy-deny
 *
 * Covers:
 *   Suite 6 — degraded mode: resolveActivationSync returns mode="degraded",
 *             non-empty warnings, and servers from manifest (no silent over-grant)
 *   Suite 7 — policy-deny path: async resolveActivation with FULL_MANIFEST
 *             (no registry fields → policy denies all; verify fail-closed behavior)
 *
 * Standalone: node tools/integration-test-mcp-009-policy.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import { FULL_MANIFEST, loadActivationModule } from './integration-test-mcp-009-helpers.mjs';

const SUITE_LABEL = 'MCP-009 degraded+policy-deny (integration)';
const rep = reporter();

const { resolveActivation, resolveActivationSync } = await loadActivationModule(rep, SUITE_LABEL);

// ── Suite 6 — AC#4: degraded mode ────────────────────────────────────────────
console.log('\n[Suite 6] AC#4 — degraded mode when policy substrate absent (or skips server)');

// resolveActivationSync always runs in degraded mode (no policy ceiling).
// Verify: mode='degraded', warnings carry the sync-mode note, servers returned.
{
  const result = resolveActivationSync({ taskType: 'fix-ui' }, FULL_MANIFEST);

  result.mode === 'degraded'
    ? rep.ok('6.1 resolveActivationSync always returns mode="degraded" (policy ceiling not applied)')
    : rep.bad(`6.1 expected mode="degraded" from sync, got "${result.mode}"`);

  Array.isArray(result.warnings) && result.warnings.length > 0
    ? rep.ok('6.2 resolveActivationSync: warnings array is non-empty (substrate-absent note present)')
    : rep.bad('6.2 resolveActivationSync: warnings is empty — silent degradation (must log note)');

  const hasSyncNote = result.warnings.some((w) => /sync|policy|degraded|ceiling/i.test(w));
  hasSyncNote
    ? rep.ok('6.3 warnings mention sync/policy/degraded context (no silent over-grant)')
    : rep.bad(`6.3 warnings lack policy-absent note. warnings=${JSON.stringify(result.warnings)}`);

  result.servers.length > 0
    ? rep.ok('6.4 degraded mode: servers still returned (manifest-based, not silent empty)')
    : rep.bad('6.4 degraded mode returned zero servers when manifest has matching entries');
}

// ── Suite 7 — AC#4: policy-deny path (async, fail-closed) ────────────────────
console.log('\n[Suite 7] AC#4 — policy ceiling: entries lacking registry fields → denied (fail-closed)');

{
  // FULL_MANIFEST entries have no risk/pin/capabilities → policy.evaluateServer
  // will deny them (unknown risk → R5 → requiresApproval + unpinned supply chain).
  // The result must still be a valid ActivationResult — not a crash.
  const stderrCapture = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    stderrCapture.push(String(chunk));
    return origWrite(chunk, ...rest);
  };

  let result;
  let threw = false;
  try {
    result = await resolveActivation({ taskType: 'fix-ui' }, FULL_MANIFEST);
  } catch (err) {
    threw = true;
    rep.bad(`7.1 resolveActivation must not throw even when policy denies all: ${err?.message}`);
  } finally {
    process.stderr.write = origWrite;
  }

  if (!threw) {
    rep.ok('7.1 resolveActivation does not throw when policy denies all servers');

    ['full', 'degraded', 'empty'].includes(result.mode)
      ? rep.ok(`7.2 result.mode="${result.mode}" is valid even when servers denied`)
      : rep.bad(`7.2 result.mode="${result.mode}" is not a valid ActivationResult mode`);

    Array.isArray(result.servers)
      ? rep.ok('7.3 result.servers is always an array (even when policy denies all)')
      : rep.bad('7.3 result.servers missing when policy denied all');

    Array.isArray(result.warnings)
      ? rep.ok('7.4 result.warnings is always an array (even when policy denies all)')
      : rep.bad('7.4 result.warnings missing when policy denied all');

    // Policy denies all (full mode) → zero servers; if degraded → servers present.
    if (result.mode === 'full') {
      const serverCount = result.servers.length;
      const hasDenyNote = result.warnings.some((w) =>
        /denied|deny|R5|unpinned|supply.chain|approval/i.test(w));
      serverCount === 0 && hasDenyNote
        ? rep.ok('7.5 full mode: all servers denied (no risk/pin) + warnings carry deny reasons')
        : serverCount > 0
        ? rep.bad(`7.5 full mode: policy should deny entries without registry fields but got ${serverCount} server(s)`)
        : rep.bad(`7.5 full mode: servers=0 but no deny reason in warnings=${JSON.stringify(result.warnings)}`);
    } else if (result.mode === 'degraded') {
      result.servers.length > 0
        ? rep.ok('7.5 degraded mode: servers returned from manifest (policy absent, not silent)')
        : rep.bad('7.5 degraded mode: zero servers when manifest has entries — possible silent denial');
    } else {
      rep.bad('7.5 unexpected empty mode for fix-ui task — rule should match');
    }

    // AC#4: no silent over-grant — warning must appear in result or stderr
    const warnInResult = (result.warnings ?? []).some((w) =>
      /policy|substrate|absent|degraded|deny|denied|R5|supply.chain/i.test(w));
    const warnInStderr = stderrCapture.some((l) =>
      /policy|substrate|absent|degraded|activation/i.test(l));
    warnInResult || warnInStderr
      ? rep.ok('7.6 AC#4: substrate-absent or policy-deny warning emitted (no silent over-grant)')
      : rep.bad('7.6 AC#4: no warning found — silent over-grant risk');
  }
}

// ── Finish ────────────────────────────────────────────────────────────────────
rep.finish(SUITE_LABEL);
