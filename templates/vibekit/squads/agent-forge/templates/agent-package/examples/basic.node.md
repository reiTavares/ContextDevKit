# Example — basic call (Node)

```js
import { createAgent } from '../adapters/node/index.js';

const agent = createAgent({
  manifestPath: '../manifest.yaml',
  credentials: { anthropic: process.env.ANTHROPIC_API_KEY },
});

const out = await agent.invoke({ {{input_field}}: '{{example input}}' });
console.log(out);
```

The provider, model, retries, caching, and budgets all come from `manifest.yaml` +
`governance/`. To run on a different provider, edit `spec.model_selection.primary` —
this code does not change.
