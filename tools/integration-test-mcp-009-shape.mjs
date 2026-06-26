/**
 * integration-test-mcp-009-shape.mjs — MCP-009 AC#1: async shape + boundary validators
 *
 * Covers:
 *   Suite 1 — resolveActivation returns a valid ActivationResult shape (async)
 *   Suite 2 — boundary validators throw TypeError at the boundary (async)
 *
 * Standalone: node tools/integration-test-mcp-009-shape.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import { FULL_MANIFEST, loadActivationModule } from './integration-test-mcp-009-helpers.mjs';

const SUITE_LABEL = 'MCP-009 shape+boundary (integration)';
const rep = reporter();

const { resolveActivation } = await loadActivationModule(rep, SUITE_LABEL);

// ── Suite 1 — AC#1: async resolveActivation shape ────────────────────────────
console.log('\n[Suite 1] AC#1 — async resolveActivation shape');

{
  const result = await resolveActivation({ taskType: 'fix-ui' }, FULL_MANIFEST);

  Array.isArray(result.servers)
    ? rep.ok('1.1 result.servers is an array')
    : rep.bad('1.1 result.servers is not an array');

  (result.allowedTools !== null &&
   typeof result.allowedTools === 'object' &&
   !Array.isArray(result.allowedTools))
    ? rep.ok('1.2 result.allowedTools is a plain object')
    : rep.bad('1.2 result.allowedTools has wrong shape');

  (typeof result.reason === 'string' && result.reason.length > 0)
    ? rep.ok('1.3 result.reason is a non-empty string')
    : rep.bad('1.3 result.reason missing or empty');

  (['full', 'degraded', 'empty'].includes(result.mode))
    ? rep.ok(`1.4 result.mode="${result.mode}" is a valid declared value`)
    : rep.bad(`1.4 result.mode="${result.mode}" is not a valid declared value`);

  Array.isArray(result.warnings)
    ? rep.ok('1.5 result.warnings is an array')
    : rep.bad('1.5 result.warnings missing or not an array');
}

// ── Suite 2 — AC#1: boundary validators throw TypeError ──────────────────────
console.log('\n[Suite 2] AC#1 — async boundary validators throw TypeError (not warn)');

/**
 * Asserts that the given async fn throws a TypeError.
 * @param {string} label
 * @param {() => Promise<unknown>} fn
 */
async function expectReject(label, fn) {
  try {
    await fn();
    rep.bad(`${label} — expected TypeError but did not throw`);
  } catch (err) {
    err instanceof TypeError
      ? rep.ok(label)
      : rep.bad(`${label} — threw ${err?.constructor?.name ?? 'unknown'}, not TypeError`);
  }
}

await expectReject('2.1 null ctx',         () => resolveActivation(null, FULL_MANIFEST));
await expectReject('2.2 array ctx',        () => resolveActivation([], FULL_MANIFEST));
await expectReject('2.3 empty taskType',   () => resolveActivation({ taskType: '' }, FULL_MANIFEST));
await expectReject('2.4 numeric taskType', () => resolveActivation({ taskType: 42 }, FULL_MANIFEST));
await expectReject('2.5 null manifest',    () => resolveActivation({ taskType: 'fix-ui' }, null));
await expectReject('2.6 object manifest',  () => resolveActivation({ taskType: 'fix-ui' }, {}));

// ── Finish ────────────────────────────────────────────────────────────────────
rep.finish(SUITE_LABEL);
