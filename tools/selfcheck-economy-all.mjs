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
import { runTcTelemetryChecks }        from './selfcheck-tc-telemetry.mjs';
import { runTcIntentChecks }           from './selfcheck-tc-intent.mjs';
import { runTcRelatedChecks }          from './selfcheck-tc-related.mjs';
import { runTcRouteChecks }            from './selfcheck-tc-route.mjs';
import { runTcValidateChecks }         from './selfcheck-tc-validate.mjs';
import { runTcAcceptChecks }           from './selfcheck-tc-accept.mjs';
import { runTcCacheChecks }            from './selfcheck-tc-cache.mjs';
import { runTcTransformChecks }        from './selfcheck-tc-transform.mjs';
import { runTcScaffoldChecks }         from './selfcheck-tc-scaffold.mjs';
import { runTcRecipeRunnerChecks }     from './selfcheck-tc-recipe-runner.mjs';
import { runTcDispatchChecks }         from './selfcheck-tc-dispatch.mjs';

/**
 * Runs all economy-stack feature self-checks in order. The tc-* ladder runners
 * (WF0022 Wave 1: telemetry · intent/ambiguity · related/closure · router ·
 * result-validator · acceptance-gate · content-cache; Wave 2: transform+codemod)
 * are aggregated here so selfcheck.mjs stays under budget.
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
  await runTcTelemetryChecks({ ok, bad }, { KIT });
  await runTcIntentChecks({ ok, bad }, { KIT });
  await runTcRelatedChecks({ ok, bad }, { KIT });
  await runTcRouteChecks({ ok, bad }, { KIT });
  await runTcValidateChecks({ ok, bad }, { KIT });
  await runTcAcceptChecks({ ok, bad }, { KIT });
  await runTcCacheChecks({ ok, bad }, { KIT });
  await runTcTransformChecks({ ok, bad }, { KIT });
  await runTcScaffoldChecks({ ok, bad }, { KIT });
  await runTcRecipeRunnerChecks({ ok, bad }, { KIT });
  await runTcDispatchChecks({ ok, bad }, { KIT });
}
