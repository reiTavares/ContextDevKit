# L4 — Squads of specialized agents

> Level 4. Solves: **"How do we stop every change from falling on a single
> generalist Claude whose monolithic context dilutes each domain's posture?"**

## The problem

L1–L3 give one agent context and coordination. But a monolithic posture:
- accumulates rules from very different domains in one `CLAUDE.md`;
- applies the same mindset to "implement a feature" and "audit a PR against the
  constitution" — different work;
- inflates the context loaded for any task.

## The solution: squads of specialized agents

Agents are grouped into **squads** under `contextkit/squads/`, declared by a manifest
([`contextkit/squads/README.md`](../squads/README.md)). The base squad is `devteam`
(architect, code-reviewer, context-keeper, test-engineer, …); higher levels add
`qa-team`, `security-team`, `design-team`, and more. Each agent is a stack-agnostic
**archetype** you specialize to your project.

## Two tiers — lean executable + rich briefing

| Tier | Path | Consumed by |
| --- | --- | --- |
| Executable frontmatter (auto-load) | `.agents/agents/<name>.md` | Claude Code (the orchestrator) |
| Rich briefing (reference) | `contextkit/squads/<team>/<name>.md` | a human reading; the agent when consulted |

Keeping the briefing out of the agent file keeps the frontmatter compact — fast to
load, cheap to carry — while the depth stays one hop away. Scaffold a briefing with
`/squad brief <agent>`; see coverage with `/squad list`.

## How squads are invoked

**Auto-dispatched** — when a task clearly falls in an agent's domain, the main Claude
delegates via `Agent(subagent_type="<name>")`. The `description` in the agent's
frontmatter drives selection. *Example: "add input validation to this route" → the
backend/service agent.*

**Manual** — in orchestration, or when a session needs a specific posture:
`Agent(subagent_type="code-reviewer", prompt="review this branch against the constitution")`.

**Delegation between agents** — each briefing has a "delegate to" section. An
implementer hands off to the data/schema specialist for a migration; `code-reviewer`
dispatches the right specialist to fix what its report found.

## What each agent carries

1. The slice of the **constitution** that applies to its domain.
2. The **stack points** (libs/configs) it touches — filled per project.
3. Domain-specific **anti-patterns** (bad vs good examples) in the briefing.
4. **Delegation triggers** — when to hand off.

## When to update agents

- Constitution changes → revisit `code-reviewer`'s checklist and the "forbidden"
  sections of the others.
- New library adopted → add it to the relevant agent's "stack you touch".
- Anti-pattern discovered → add it to the rich briefing with an example.
- Squad reorg (merge/split agents, new squad) → an ADR + update the manifest and the
  delegation tables. Use `/squad` to show, route, or grow the roster.

## Quality criterion

After ~20 sessions using the squad, review: were delegations correct? did an agent
need to read another's briefing to continue? was any agent never invoked (a fuzzy or
redundant domain)? did any domain end up ownerless (a gap)? Feed the answers back via
`/retro` (L6).
