# {{AGENT_NAME}} — Python adapter

```python
from agent import create_agent
agent = create_agent(manifest_path="../../manifest.yaml", credentials={ })  # keys
out = agent.invoke({ })  # input per the manifest intent
```

Reads `manifest.yaml` for model selection, governance, and tools. Carries its own
dependencies (runs in YOUR project). See the package root `README.md` + `governance/`.
