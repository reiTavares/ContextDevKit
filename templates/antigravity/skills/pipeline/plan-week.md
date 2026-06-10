# Skill: plan-week

> Rank the DevPipeline backlog into an explained top-N — what to pick up next, by WSJF × SLA-urgency × advisor-lane.
> Argument: [--top N | --all | --json]
# 🗓️ Plan the week

Turn the backlog into an **ordered, explained plan** instead of a judgement call.
Each backlog ticket gets a deterministic **plan score** from three signals the kit
already records — **priority** (P0–P3, the dominant band), **SLA urgency** (overdue
dominates, then proximity to the due date), and **lane weight** (a `type: bug` or
`source: advise:security` finding outranks a same-priority chore). A ticket with
open dependencies sinks below everything actionable — its blockers surface first.

Run it and act on **<user-specified argument>** (default: top 5):

```
node contextkit/tools/scripts/plan-next.mjs [--top N] [--all] [--json]
```

Then:

1. **Read the ranked list.** Lead with the single top pick and its one-line
   rationale (the `score` is the composite; the bits before it are *why*).
2. **Call out anything blocked** — those need their dependencies cleared first
   (`/pipeline` shows the `↘ blocked by N` edges; `/plan-week` lists the ids).
3. **Offer the next action, don't take it:** `/dev-start "#<id>"` on the top pick
   (which moves it `backlog → working` and starts a session). If the top pick is
   architectural-tier, draft `/new-adr` first — `/dev-start` will refuse otherwise.

The ranking is **read-only** — it never moves a ticket. It is the planning lens;
`/pipeline` and `/dev-start` are how work actually flows.
