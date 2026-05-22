---
description: Show platform telemetry — sessions, drift rate, ADRs, agents, weekly cadence.
---

Show how healthy the VibeDevKit practice is on this project:

```
node vibekit/tools/scripts/stats.mjs
```

Present the output to the user and add a one-line read: is the **drift rate**
trending down (good — sessions are being registered)? Is the cadence steady? Are
ADRs being written for big decisions? Suggest a concrete habit if a metric looks
off (e.g. high drift → remember `/log-session`; zero ADRs on a big change →
`/new-adr`).
