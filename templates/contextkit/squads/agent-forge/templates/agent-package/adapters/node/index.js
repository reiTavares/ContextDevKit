// Node runtime adapter for this Agent Package. Implements the common AgentRuntime
// interface; reads ../../manifest.yaml as the source of truth. Switching provider
// = editing the manifest, not this file.
//
//   interface AgentRuntime {
//     invoke(input): Promise<AgentOutput>
//     invokeStream(input): AsyncIterable<AgentChunk>
//     preflight(): Promise<HealthReport>      // checks the fallback-chain providers
//     estimate(input): CostEstimate
//     onEvent(handler): Unsubscribe           // audit events (governance/audit.schema.json)
//   }
//
// Fase 4 hook: SHADOW-EVAL — sample ~5% of production calls through the golden
// rubric and surface accuracy drift. The wiring lives here; the actual eval
// scoring is delegated to the package's evals/ + agent-forge's eval-runner.
// Sample rate is read from quality.policy.yaml.eval_gates.drift_monitoring.sample_pct.

import { randomInt } from 'node:crypto';

/**
 * Fase 4 shadow-eval scaffold. The packager generates this STUB; the client wires
 * the real provider chain + sample_pct from quality.policy.yaml + reports drift to
 * the observability sink declared by the package.
 *
 *   const shadow = createShadowEval({
 *     samplePct: 5,                            // from quality.policy.yaml
 *     runOne: async (input, expected) => 1.0,  // returns accuracy in [0, 1]
 *     onDrift: (event) => metrics.emit(event), // accuracy_drop_pct, etc.
 *   });
 *   shadow.maybeSample(input, expected);       // call inside invoke()
 */
export function createShadowEval({ samplePct = 5, runOne, onDrift } = {}) {
  let totalSeen = 0;
  let totalSampled = 0;
  let cumulativeAccuracy = 0;
  return {
    maybeSample: async (input, expected) => {
      totalSeen += 1;
      if (randomInt(0, 100) >= samplePct) return;
      if (typeof runOne !== 'function' || expected == null) return;
      totalSampled += 1;
      const score = await runOne(input, expected);
      cumulativeAccuracy += Number(score) || 0;
      const rolling = cumulativeAccuracy / totalSampled;
      if (typeof onDrift === 'function') onDrift({ rolling_accuracy: rolling, total_sampled: totalSampled, total_seen: totalSeen });
    },
    stats: () => ({ rolling_accuracy: totalSampled ? cumulativeAccuracy / totalSampled : null, total_sampled: totalSampled, total_seen: totalSeen }),
  };
}

export function createAgent(/* { manifestPath, credentials } */) {
  throw new Error('agent-forge: Node adapter is a Fase 1 stub — wire the provider SDK + the shadow-eval hook above per your runtime.');
}
