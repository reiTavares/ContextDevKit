# Example — fallback chain in action (Node)

```js
import { createAgent } from '../adapters/node/index.js';

const agent = createAgent({
  manifestPath: '../manifest.yaml',
  credentials: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,   // a DIFFERENT provider — outage defense
  },
});

// preflight() checks every provider in the fallback chain is reachable.
const health = await agent.preflight();
if (!health.ok) console.warn('degraded:', health);

// If the primary returns 5xx / times out, the adapter follows
// governance/fallback-chain.yaml automatically. A safety block does NOT fall back.
agent.onEvent((e) => { if (e.fallback_triggered) console.log('fell back to', e.model_used); });

const out = await agent.invoke({ {{input_field}}: '{{example input}}' });
console.log(out);
```
