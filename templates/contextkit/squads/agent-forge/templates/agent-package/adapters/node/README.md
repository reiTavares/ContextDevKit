# {{AGENT_NAME}} — Node adapter

```js
import { createAgent } from './index.js';
const agent = createAgent({ manifestPath: '../../manifest.yaml', credentials: { /* keys */ } });
const out = await agent.invoke({ /* input per the manifest intent */ });
```

The adapter reads `manifest.yaml` for model selection, governance, and tools. It carries
its own dependencies (it runs in YOUR project, not in ContextDevKit). See the package root
`README.md` for the model rationale and `governance/` for the enforced policies.
