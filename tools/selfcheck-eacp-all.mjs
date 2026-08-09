/**
 * EACP self-check aggregator — runs all EACP cluster runners in order.
 *
 * Cohesion note: this module exists solely to aggregate the EACP-cluster
 * selfcheck wiring so that the main selfcheck.mjs runner stays under the
 * 308-line budget (constitution §1 +10% tolerance). One concern, one seam.
 *
 * Zero runtime dependencies — node:* only (imports are all relative).
 */
import { runEacpChecks }             from './selfcheck-eacp.mjs';
import { runEacpCostChecks }         from './selfcheck-eacp-cost.mjs';
import { runEacpPressureChecks }     from './selfcheck-eacp-pressure.mjs';
import { runEacpBudgetChecks }       from './selfcheck-eacp-budget.mjs';
import { runEacpRoutingChecks }      from './selfcheck-eacp-routing.mjs';
import { runEacpAutonomyChecks }     from './selfcheck-eacp-autonomy.mjs';
import { runEacpBenchmarkChecks }    from './selfcheck-eacp-benchmark.mjs';
import { runEacpBaselineChecks }     from './selfcheck-eacp-baseline.mjs';
import { runEacpPrivacyChecks }      from './selfcheck-eacp-privacy.mjs';
import { runEacpCostScenarioChecks } from './selfcheck-eacp-cost-scenarios.mjs';
import { runEacpQuotaStoreChecks }   from './selfcheck-eacp-quota-store.mjs';
import { runEacpReportingChecks }    from './selfcheck-eacp-reporting.mjs';
import { runEacpStatisticsChecks }   from './selfcheck-eacp-statistics.mjs';
import { runEacpSubscriptionChecks } from './selfcheck-eacp-subscription.mjs';
import { runEacpOutcomesChecks }     from './selfcheck-eacp-outcomes.mjs';
import { runEacpPilotChecks }        from './selfcheck-eacp-pilot.mjs';

/**
 * Runs all EACP cluster self-checks in order.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runAllEacpChecks({ ok, bad }, { KIT }) {
  await runEacpChecks({ ok, bad }, { KIT });
  await runEacpCostChecks({ ok, bad }, { KIT });
  await runEacpPressureChecks({ ok, bad }, { KIT });
  await runEacpBudgetChecks({ ok, bad }, { KIT });
  await runEacpRoutingChecks({ ok, bad }, { KIT });
  await runEacpAutonomyChecks({ ok, bad }, { KIT });
  await runEacpBenchmarkChecks({ ok, bad }, { KIT });
  await runEacpBaselineChecks({ ok, bad }, { KIT });
  await runEacpPrivacyChecks({ ok, bad }, { KIT });
  await runEacpCostScenarioChecks({ ok, bad }, { KIT });
  await runEacpQuotaStoreChecks({ ok, bad }, { KIT });
  await runEacpReportingChecks({ ok, bad }, { KIT });
  await runEacpStatisticsChecks({ ok, bad }, { KIT });
  await runEacpSubscriptionChecks({ ok, bad }, { KIT });
  await runEacpOutcomesChecks({ ok, bad }, { KIT });
  await runEacpPilotChecks({ ok, bad }, { KIT });
}
