// GENERATED in Fase 1 by packager. Node runtime adapter for this Agent Package.
// Implements the common AgentRuntime interface; reads ../../manifest.yaml as the
// source of truth. Switching provider = editing the manifest, not this file.
//
// interface AgentRuntime {
//   invoke(input): Promise<AgentOutput>
//   invokeStream(input): AsyncIterable<AgentChunk>
//   preflight(): Promise<HealthReport>   // checks the fallback-chain providers
//   estimate(input): CostEstimate
//   onEvent(handler): Unsubscribe        // audit events (see governance/audit.schema.json)
// }

export function createAgent(/* { manifestPath, credentials } */) {
  throw new Error('agent-forge: Node adapter is a Fase 1 stub — not yet generated.');
}
