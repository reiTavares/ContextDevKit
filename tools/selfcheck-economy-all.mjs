/**
 * Economy self-check aggregator — runs the economy-stack feature runners in order.
 *
 * Cohesion note: aggregates the economy/project-map economy feature selfchecks so
 * the main selfcheck.mjs stays under the 308-line budget. One concern, one seam.
 * Covers: project-map --find (WS1), tc-packet work-packet (WS2), session-start
 * activation (WS3), dispatch-plan helper (WS4), auto-activate config defaults (WS5).
 *
 * Zero runtime dependencies — node:* only (imports are all relative).
 */
import { runProjmapFindChecks }       from './selfcheck-projmap-find.mjs';
import { runTcPacketChecks }          from './selfcheck-tc-packet.mjs';
import { runEconomyActivationChecks } from './selfcheck-economy-activation.mjs';
import { runEconomyDispatchChecks }   from './selfcheck-economy-dispatch.mjs';
import { runEconomyAutoActivateChecks } from './selfcheck-economy-autoactivate.mjs';
import { runEconomySavingsChecks }    from './selfcheck-economy-savings.mjs';

/**
 * Runs all economy-stack feature self-checks in order.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runAllEconomyChecks({ ok, bad }, { KIT }) {
  await runProjmapFindChecks({ ok, bad }, { KIT });
  await runTcPacketChecks({ ok, bad }, { KIT });
  await runEconomyActivationChecks({ ok, bad }, { KIT });
  await runEconomyDispatchChecks({ ok, bad }, { KIT });
  await runEconomyAutoActivateChecks({ ok, bad }, { KIT });
  await runEconomySavingsChecks({ ok, bad }, { KIT });
}
