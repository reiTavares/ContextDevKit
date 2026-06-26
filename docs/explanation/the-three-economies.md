# The three economies: token, cost, and autonomy

_Why a development platform that runs AI agents needs to track three distinct resource dimensions — and how they relate to keeping AI-assisted work both efficient and governed._

## Background

When a developer uses a traditional tool — a linter, a compiler, a test runner — the resource model is simple: wall-clock time and compute. The tool either finishes or it does not; if it is slow, you optimize it; if it breaks, you fix it. AI-assisted development changes this in two uncomfortable ways.

First, AI inference is neither free nor instantaneous, and the cost structure is non-obvious. A long context window costs more per call than a short one; cached prefixes cost far less than uncached tokens; a routing decision that chooses a capable-but-expensive model for a trivial task burns budget that could have funded a deeper analysis somewhere else. If the platform does not track this, it cannot reason about it — and in practice, untracked costs grow invisibly until someone notices the bill.

Second, AI agents have variable autonomy: sometimes you want a model to execute a task end-to-end without asking; sometimes you want it to propose and wait; sometimes you want a human veto at each step. The degree of autonomy is itself a resource — granting too little means constant interruption; granting too much means consequential decisions happen without the right level of review. A platform that does not model autonomy explicitly cannot enforce meaningful governance around it.

ContextDevKit addresses both problems by naming three distinct economies and tracking them separately, because they measure different things and correcting one does not correct the others.

## Core idea

**The token economy** is the unit-level accounting layer. It tracks raw token consumption — prompt tokens, completion tokens, and the cache hits that reduce effective cost — across the session and across the project lifetime. The point of tracking this is not to create anxiety about individual calls; it is to make the consumption *visible* so patterns emerge. A task that consistently costs ten times more than expected is either over-engineered in its prompting, routing to the wrong model tier, or doing unnecessary work. You cannot see this without measurement.

**The cost economy** is the financial translation of the token economy. Tokens are not fungible across model tiers — a token in a large reasoning model costs an order of magnitude more than the same token in a small fast model — so raw token counts do not tell you the budget story. The cost economy converts token consumption into monetary units, applies a cache-value correction (cache hits have a different cost profile than uncached calls), and produces the figures that actually inform investment decisions: is this agent's output worth what it costs to run? The platform's answer to this is advisory rather than blocking by default, because the right threshold is context-dependent. But it makes the question answerable.

**The autonomy economy** is the governance layer. It tracks, per session and per action, what the AI agent was authorised to do without human review: read-only queries, file edits, test execution, git operations, external calls. Autonomy is not a binary (on or off) but a graded resource, and ContextDevKit's level system (L1 through L7) is fundamentally an autonomy budget: a higher level grants the agent a wider action space, and the platform enforces that the wider space is only granted when the governance conditions that justify it are met. The autonomy economy is what makes it possible to ask, after a session, "what did the agent do on its own?" — and to answer that question from evidence, not from trust.

## Key design decisions and trade-offs

**Decision: measure all three economies, not just cost**

The obvious thing to track is cost. Cost is financial and therefore easy to justify measuring. Token count is one level of abstraction below cost and is the natural granularity for optimization decisions (caching strategy, prompt compression, context management). Autonomy is a governance dimension, not a financial one.

The case for measuring all three is that they catch different failure modes. Cost alone tells you a session was expensive but not *where* the waste was — token-level granularity is needed to locate it. Token counts tell you volume but not whether the volume was appropriate — routing and autonomy signals are needed to assess that. And cost + tokens together tell you nothing about whether the agent operated within its authorised scope, which is a governance question that no financial metric can answer. Each economy is the only measurement sensitive to its failure mode.

**Decision: the cost economy distinguishes gross spend from net savings**

A naive implementation of cost tracking adds up the model invoice per session. ContextDevKit's cost economy goes one step further and computes a *cache savings* figure: how much would the same work have cost without prompt caching, minus what was actually charged. This is not vanity accounting. Cache savings represent real architectural value — a well-structured prompt with stable, cacheable context is not just faster; it is materially cheaper per invocation. The distinction between gross spend and net-of-cache spend is what lets a team measure whether its context architecture is paying off.

The trade-off is that the cache savings figure requires knowing the uncached counterfactual, which means the measurement is only as accurate as the model's reported token breakdown. When that breakdown is unavailable or unreliable, the savings figure is reported as "not measurable" rather than estimated — again following the principle that an honest unknown is safer than a confident wrong number.

**Decision: autonomy is graded and the grade is enforced by the harness, not declared by the agent**

An agent that declared its own autonomy grade would provide no governance. The grade is set by the project configuration (the level installed, the autonomy settings, the per-session override if any), and the harness enforces it through hooks: the pre-tool-use hook can block an action whose scope exceeds the current grade, the post-tool-use hook records what was exercised, and the pre-commit hook can require human confirmation before a git operation lands if the grade calls for it.

This matters because the autonomy economy's governance value is entirely downstream of the grade being trustworthy. If the grade is self-reported, the whole stack degrades to a suggestion. The enforcement is what makes "Grade 3 session" mean something precise: it means the hooks permitted the grade-3 action space, not that the agent believed it was operating at grade 3.

**Decision: the three economies are reported in a session receipt, not only in aggregate**

Aggregate totals (total cost, total tokens, sessions at each autonomy grade) are useful for trend analysis. But a developer who wants to understand a specific session's behaviour needs per-session granularity: what was the token distribution across calls, was caching effective, and what autonomy actions occurred. ContextDevKit produces a session receipt that captures this — a structured record attached to the session log — so that any session can be examined in isolation. This is the difference between a dashboard that summarises and an audit trail that accounts.

## What this does NOT cover

The three economies are a *measurement and governance* layer; they are not a cost-reduction tool in themselves. The platform does not automatically choose cheaper models, compress prompts, or throttle sessions to stay under budget. Those are optimisation decisions that depend on context the platform cannot make on behalf of the project.

This explanation also does not address the *autonomy level configuration* in detail — how to set levels, what each grade permits, and how to override per session. That is covered in [docs/LEVELS.md](../LEVELS.md). The economic accounting described here is the *measurement* side of autonomy, not the configuration side.

Finally, the cost economy tracks AI inference cost specifically. It does not track other operational costs (cloud hosting, storage, CI compute) — those are outside the platform's scope.

## Further reading

- [docs/LEVELS.md](../LEVELS.md) — autonomy grades and the action spaces they authorise.
- [docs/explanation/governance-and-enforcement.md](./governance-and-enforcement.md) — how autonomy is enforced by the harness rather than trusted to the agent.
- [docs/explanation/business-driven-development.md](./business-driven-development.md) — how business cases connect to the investment decisions the cost economy informs.
- [docs/explanation/deliberation-council.md](./deliberation-council.md) — the debate mechanism that governs high-stakes decisions at elevated autonomy grades.
