/**
 * Request Orchestration self-check aggregator (WF0038, ADR-0107).
 *
 * Cohesion note: aggregates the request-orchestration feature selfchecks so the
 * main selfcheck.mjs stays under the 308-line budget (one import, one call). New
 * waves (W3 activation, W4 parity) add their runner here, not in selfcheck.mjs.
 *
 * Zero runtime dependencies — node:* only (relative imports).
 *
 * @module selfcheck-request-all
 */
import { runRequestOrchestrationChecks } from './selfcheck-request-orchestration.mjs';
import { runRequestRegistryChecks } from './selfcheck-request-registries.mjs';
import { runRequestW3Checks } from './selfcheck-request-w3.mjs';
import { runRequestW4Checks } from './selfcheck-request-w4.mjs';
import { runRequestW5Checks } from './selfcheck-request-w5.mjs';
import { runRequestW6Checks } from './selfcheck-request-w6.mjs';

/**
 * Runs all Automatic Request Orchestration self-checks in order (W1 foundations,
 * W2 registries + selection).
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runAllRequestOrchestrationChecks(reporter, ctx) {
  await runRequestOrchestrationChecks(reporter, ctx);
  await runRequestRegistryChecks(reporter, ctx);
  await runRequestW3Checks(reporter, ctx);
  await runRequestW4Checks(reporter, ctx);
  await runRequestW5Checks(reporter, ctx);
  await runRequestW6Checks(reporter, ctx);
}
