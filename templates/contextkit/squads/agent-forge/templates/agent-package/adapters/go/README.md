# {{AGENT_NAME}} — Go adapter

```go
import agent "{{MODULE_PATH}}/{{AGENT_NAME}}-agent"

a, err := agent.CreateAgent("../../manifest.yaml")
```

Reads `manifest.yaml` for model selection, governance, and tools. Carries its own
dependencies (runs in YOUR project). See the package root `README.md` + `governance/`.
