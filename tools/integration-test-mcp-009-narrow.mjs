/**
 * integration-test-mcp-009-narrow.mjs — MCP-009 AC#3: narrowing invariants
 *
 * Covers:
 *   Suite 5 — activation can ONLY NARROW the manifest ceiling, never widen it:
 *     5.1 server absent from manifest → not in result
 *     5.2 disabled server in manifest → not in result
 *     5.3 manifest restricts tool list → tool intersection respects ceiling
 *     5.4 (5.5) navigate survives intersection when in both rule + manifest
 *     5.5 (5.5 alt) manifest read-only+screenshot ceiling enforced
 *     5.6 unknown task → empty result (no always-on default)
 *     5.7 empty manifest → empty result
 *
 * Standalone: node tools/integration-test-mcp-009-narrow.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import { FULL_MANIFEST, loadActivationModule } from './integration-test-mcp-009-helpers.mjs';

const SUITE_LABEL = 'MCP-009 narrowing invariants (integration)';
const rep = reporter();

const { resolveActivationSync } = await loadActivationModule(rep, SUITE_LABEL);

// ── Suite 5 — AC#3: narrowing invariants ─────────────────────────────────────
console.log('\n[Suite 5] AC#3 — activation can only NARROW, never WIDEN the manifest ceiling');

// 5.1 Server absent from manifest must NOT appear in result
{
  const manifestNoPlaywright = FULL_MANIFEST.filter((e) => e.id !== 'playwright');
  const ids = resolveActivationSync({ taskType: 'fix-ui' }, manifestNoPlaywright)
    .servers.map((s) => s.id);
  !ids.includes('playwright')
    ? rep.ok('5.1 playwright absent from manifest → not exposed (cannot widen)')
    : rep.bad('5.1 playwright appeared when absent from manifest — WIDEN VIOLATION');
}

// 5.2 Disabled server in manifest must NOT appear in result
{
  const manifestDisabled = FULL_MANIFEST.map((e) =>
    e.id === 'playwright' ? { ...e, disabled: true } : e);
  const ids = resolveActivationSync({ taskType: 'fix-ui' }, manifestDisabled)
    .servers.map((s) => s.id);
  !ids.includes('playwright')
    ? rep.ok('5.2 playwright disabled in manifest → not exposed')
    : rep.bad('5.2 disabled playwright appeared — disabled flag not respected');
}

// 5.3 Manifest restricts tool list → intersection must not exceed manifest ceiling
{
  const manifestNarrow = FULL_MANIFEST.map((e) =>
    e.id === 'playwright' ? { ...e, allowedTools: ['navigate', 'screenshot'] } : e);
  const pwTools = resolveActivationSync({ taskType: 'fix-ui' }, manifestNarrow)
    .allowedTools['playwright'] ?? [];
  const CEILING = new Set(['navigate', 'screenshot']);
  const widened = pwTools.filter((t) => !CEILING.has(t));
  widened.length === 0
    ? rep.ok('5.3 playwright tools intersected with manifest ceiling (click/fill excluded)')
    : rep.bad(`5.3 tool list widened past manifest ceiling: ${JSON.stringify(widened)}`);

  // 5.4 navigate is in both the rule and the manifest — it survives the intersection
  pwTools.includes('navigate')
    ? rep.ok('5.4 navigate (in both rule + manifest) survives the intersection')
    : rep.bad('5.4 navigate missing from intersection — narrowing too aggressive');
}

// 5.5 Mode ceiling: manifest read-only overrides rule write → only screenshot survives
{
  const manifestRO = FULL_MANIFEST.map((e) =>
    e.id === 'playwright' ? { ...e, mode: 'read-only', allowedTools: ['screenshot'] } : e);
  const pwTools = resolveActivationSync({ taskType: 'fix-ui' }, manifestRO)
    .allowedTools['playwright'] ?? [];
  const excess = pwTools.filter((t) => t !== 'screenshot');
  excess.length === 0
    ? rep.ok('5.5 manifest read-only+screenshot-only ceiling enforced (write rule narrowed)')
    : rep.bad(`5.5 tool leak past read-only manifest ceiling: ${JSON.stringify(excess)}`);
}

// 5.6 No always-on default: unmatched task → empty result
{
  const result = resolveActivationSync({ taskType: 'completely-unknown-xyz-9999' }, FULL_MANIFEST);
  result.servers.length === 0
    ? rep.ok('5.6 unknown task → servers=[] (no always-on default)')
    : rep.bad(`5.6 unknown task leaked servers: ${JSON.stringify(result.servers.map((s) => s.id))}`);
}

// 5.7 Empty manifest → empty result (cannot widen past an empty manifest)
{
  const result = resolveActivationSync({ taskType: 'fix-ui' }, []);
  result.servers.length === 0 && Object.keys(result.allowedTools).length === 0
    ? rep.ok('5.7 empty manifest → servers=[], allowedTools={} (narrowing from zero is zero)')
    : rep.bad(`5.7 empty manifest produced unexpected result: ${JSON.stringify(result.servers)}`);
}

// ── Finish ────────────────────────────────────────────────────────────────────
rep.finish(SUITE_LABEL);
