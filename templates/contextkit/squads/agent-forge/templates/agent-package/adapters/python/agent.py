"""GENERATED in Fase 2 by packager. Python runtime adapter for this Agent Package.

Implements the common AgentRuntime interface; reads ../../manifest.yaml as the source
of truth. Switching provider = editing the manifest, not this file.

    class AgentRuntime(Protocol):
        def invoke(self, input) -> AgentOutput: ...
        def invoke_stream(self, input) -> Iterable[AgentChunk]: ...
        def preflight(self) -> HealthReport: ...     # checks the fallback-chain providers
        def estimate(self, input) -> CostEstimate: ...
        def on_event(self, handler) -> Unsubscribe: ...  # audit events
"""


def create_agent(manifest_path: str = "../../manifest.yaml", credentials: dict | None = None):
    raise NotImplementedError("agent-forge: Python adapter is a Fase 2 stub — not yet generated.")
