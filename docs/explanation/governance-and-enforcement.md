# Governance and enforcement: why the harness, not the prompt

_Why ContextDevKit enforces its rules through Claude Code hooks and CI gates rather than trusting the AI to follow instructions — and what the posture of "refuse by default, permit explicitly" means in practice._

## Background

The central tension in AI-assisted development is that the same capability that makes a language model useful — the ability to reason, plan, and generate — also makes it capable of reasoning its way around constraints it was asked to respect. A model that is told "do not commit directly to main" can produce a compelling argument for why, in this particular case, the rule should not apply. A model that is told "always write a test before editing production code" can convince itself that the change is small enough to be obviously correct. The more capable the model, the more fluent the rationalisation.

This is not a flaw in any specific model; it is a structural property of instruction-following systems operating under contextual pressure. Rules that live in a system prompt or a README are *requests with authority*. They work most of the time, especially for well-calibrated models following clear instructions. But "most of the time" is not an adequate reliability target for governance — the cases where rules break down are precisely the cases where the consequences of the deviation are largest.

ContextDevKit's answer is to move as many governance rules as possible out of the prompt and into the harness: the hooks that execute before and after tool calls, the CI gates that block merges, the engine guards that refuse to advance state without verified artifacts. The model can still reason and plan freely; it simply finds that certain actions are not available until the conditions for them are met. The constraint is structural rather than advisory.

## Core idea

The key insight is that not all governance rules are equally checkable. Some rules are **objective and structural**: a test file either exists with content or it does not; a workflow either has a completed PRD or it does not; a commit message either follows the conventional format or it does not. These are binary facts about the filesystem or git state that a script can evaluate in milliseconds. Other rules are **subjective and contextual**: is this the right abstraction? Is the documentation clear enough? Is this scope appropriate for the business goal? These require judgment, and a script cannot make them reliably.

ContextDevKit's posture is to enforce the objective rules mechanically and to advise on the subjective ones. The commit-message hook blocks a non-conforming commit — there is no rationalisation available. The L5 mutation guard blocks source edits while pre-ship planning phases are open — the gate does not negotiate. The workflow phase gate refuses to advance without the required artifact — the refusal is structural. By contrast, the AI is trusted (and expected) to exercise judgment on questions of design quality, code clarity, and scope appropriateness, because those are genuinely beyond the reach of a script.

This split-by-checkability posture has a practical consequence: when you encounter a governance failure in ContextDevKit, it is almost always in one of two categories. Either the enforcement is in the right place (the hook or gate) but the condition is wrong (it is blocking something it should not, or failing to block something it should), in which case the fix is in the enforcement code. Or the rule was only advisory (it lived in a prompt or a README) and a model under pressure did not follow it, in which case the fix is to move the rule into the harness. The diagnosis question is always: "where does this rule actually live?"

## Key design decisions and trade-offs

**Decision: hooks run on every session, not on demand**

Claude Code hooks are registered in the project's settings and execute automatically — before tool calls, after tool calls, after session end — without requiring the model to invoke them. This is the foundational property of harness-based governance. An enforcement mechanism that the agent has to remember to trigger is not enforcement; it is a reminder. The boot-context hook loads project memory automatically, not because the model was told to read it, but because the harness runs it. The session-end hook can detect drift and prompt for logging automatically. The commit-message hook fires on every commit regardless of who (or what) is committing.

The cost of this automatic execution is that every hook is on a critical path. A hook that fails with a hard exit can break real developer work. This is why ContextDevKit's hooks are written to **exit 0 on error** — any runtime failure in the hook infrastructure itself is logged and skipped, never propagated as a session-breaking crash. The hook's job is to enforce or advise; it is never permitted to block work because of its own internal error.

**Decision: refuse by default, permit explicitly**

The governance posture throughout the platform is that the default state of any action or assertion is *unproved* — not assumed, not guessed, not "probably fine." Only a verified condition moves it to *permitted*. This shows up everywhere: the workflow phase gate does not assume a PRD is good enough; it checks structural completeness. The business case approval gate does not assume an approval occurred; it verifies a provenance hash. The autonomy economy does not assume actions were within scope; it records what the hooks actually permitted.

This is a deliberate inversion of the optimistic default that most advisory systems use ("assume pass unless explicitly failed"). The optimistic default is fragile: a missing check, a skipped hook, or a silent error produces a false positive — the system reports "compliant" when compliance was never verified. ContextDevKit's posture means that a missing check produces "unknown" or "blocked," not "passed." This is more expensive in friction for the well-behaved case (you have to do the thing, not just assert you did it), but it eliminates the failure mode where the governance signal is corrupted by the very absence it was supposed to catch.

**Decision: enforcement applies to all agents equally, not just Claude**

The hooks and gates in ContextDevKit are implemented in the Node.js harness, not in Claude-specific prompting. This means the same rules apply when the project is worked on by a different model, a different CLI, or an automation script that calls the tools directly. A governance rule that only holds when Claude specifically is running is not a rule; it is a Claude-specific preference. The platform's design goal is that governance is a property of the project, not a property of the current model session.

In practice, this means the enforcement code must be host-agnostic: no model-specific API calls, no assumptions about the model's instruction-following capability, no use of the model's judgment to decide whether a gate should fire. The gate fires based on facts about the repo state. The model's job is to produce the work that makes those facts true; the harness's job is to verify that they are.

**Decision: advisory signals are still valuable — they just do not masquerade as enforcement**

Not every rule belongs in a hard gate. Some governance properties are important to surface but too context-dependent to block on mechanically: a file that is getting long (approaching the line-budget threshold, but not yet over it), a prompt structure that could benefit from caching, a test suite that has been passing but has not been run since a significant refactor. These are surfaced as *advisory* signals — the platform notes them and the developer or agent decides what to do — rather than as blocking gates.

The important property is that the advisory signal is honest about what it is. It does not count as a governance pass. The session receipt records what was enforced (hook verdicts, gate outcomes) separately from what was advised (coach nudges, drift warnings). A reader of the session history can distinguish "the gate blocked this and was overridden with --force" from "the coach noticed this and it was not addressed." Both are information; neither is hidden.

## What this does NOT cover

This explanation addresses the *philosophy and structure* of ContextDevKit's enforcement model — why enforcement is in the harness, what the split-by-checkability posture means, and why refuse-by-default was chosen. It does not describe the implementation of any specific hook, gate, or CI check. Those are implementation-level details covered in the reference documentation for each module.

It also does not address the *configuration* of enforcement levels — how to set autonomy grades, which gates apply at which level, or how to apply `--force` overrides intentionally and with proper recording. That is covered in [docs/LEVELS.md](../LEVELS.md).

Finally, this explanation is about internal governance — the rules the platform enforces on the development process itself. It does not address application-layer security (what the software being built should enforce), which is a separate domain entirely.

## Further reading

- [docs/explanation/workflow-governance.md](./workflow-governance.md) — a concrete example of the enforcement model applied: how workflow phase gates are implemented and why they live in the engine.
- [docs/explanation/the-three-economies.md](./the-three-economies.md) — how autonomy is measured as a resource, and how the autonomy economy records what the harness actually permitted.
- [docs/explanation/deliberation-council.md](./deliberation-council.md) — the mechanism for governing high-stakes decisions that require more than a binary gate: convening a debate before acting.
- [docs/LEVELS.md](../LEVELS.md) — the autonomy level system that determines which enforcement gates are active at each level.
