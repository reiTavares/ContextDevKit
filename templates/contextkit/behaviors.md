# Behavioral Discipline — how the agent *acts* while coding

> The behavioral companion to [`best-practices.md`](./best-practices.md).
> `best-practices.md` says **what good code looks like** (structure, naming,
> errors); this file says **how to behave while producing it** (clarify before
> coding, stay surgical, loop to a verified goal). The constitution in `CLAUDE.md`
> has absolute priority; this file expands its behavioral clauses.
>
> **Source & credit.** Adapted from
> [Andrej Karpathy's observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876)
> via the MIT-licensed `karpathy-guidelines` skill. Generalized to ContextDevKit's
> voice and reconciled with the constitution.
>
> **Tradeoff (stated honestly).** These guidelines bias toward **caution over
> raw speed**. For trivial, unambiguous tasks, use judgment — don't perform a
> ceremony the work doesn't need. The discipline is a guardrail, not a tax.

---

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs — *before* the diff.**

- **State assumptions explicitly.** If the request has gaps (scope, format,
  fields, volume, privacy), name what you're assuming. If an assumption is
  load-bearing and you're unsure, **ask** instead of guessing.
- **Present interpretations; don't pick silently.** "Make the search faster" can
  mean latency, throughput, or perceived speed — lay out the options with their
  rough cost and let the user choose.
- **Push back when warranted.** If a simpler approach exists, say so. If the ask
  conflicts with an immutable rule or an ADR, refuse and explain — silently
  complying with a bad instruction is not service.
- **Stop on genuine confusion.** Name what's unclear and ask. One clarifying
  question now beats a wrong 200-line diff later.

**Fits the kit.** This is the moment-to-moment companion to `/new-adr` (decide
the big call *before* implementing) and `/dev-start` (lock the objective). The
`architect` and `product-owner` agents exist precisely to resolve ambiguity —
route to them when the unknown is design or scope.

## 2. Simplicity first

**The minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked. No flags, options, or "configurability"
  nobody requested.
- **No abstraction for single-use code.** A strategy pattern / factory / base
  class earns its place when a *second* real consumer appears — not before.
- No error handling for impossible scenarios; handle the failures that can
  actually happen at the boundary (constitution §4).
- If you wrote 200 lines and 50 would do, rewrite it. Ask: *"Would a senior
  engineer call this overcomplicated?"* If yes, simplify before showing it.

**Fits the kit.** This is constitution §9 ("build what is asked; defer the
rest") and §1 (complexity & cohesion) as an *in-the-moment* habit. The line
budget there is an **advisory signal, not a hard rule** — never add an
abstraction, helper, or file just to satisfy a number, and never preserve
mixed responsibilities just to avoid one. The trap is **timing**: the
over-engineered version isn't "wrong" — it adds complexity *before it's
needed*. Add it later, when the requirement is real.

## 3. Surgical changes

**Touch only what the task requires. Clean up only your own mess.**

- **Don't "improve" adjacent code, comments, or formatting.** Don't refactor what
  isn't broken on the way past.
- **Match the surrounding style — even if you'd do it differently.** Quote style,
  type-hint usage, naming cadence, spacing: conform to the file you're in. A diff
  that reformats is a diff that hides its real change.
- **Every changed line traces to the request.** If you can't explain a line by
  the task, it shouldn't be in the diff.
- **Orphans:** remove imports/variables/functions *your* change made unused.
  **Don't** delete pre-existing dead code unless asked — *mention* it instead.

**Fits the kit (the one real tension).** The constitution rewards refactoring by
responsibility (§1, §2) and the kit ships `/analyze-code-ia-practices`,
`/tech-debt-sweep`, and `/dev-start "refactor X"`. That is not a contradiction:
**refactoring is a deliberate, scoped task — never an opportunistic side effect
of an unrelated change.** When you spot a real structural smell mid-task, note it
and offer a focused follow-up; don't fold it into the current diff. `/dev-start`
already locks scope and blocks opportunistic refactors — this rule makes the same
discipline always-on, even without it.

## 4. Goal-driven execution

**Define a verifiable success criterion. Loop until it's met.**

- **Turn vague tasks into checkable goals.** "Add validation" → "tests for the
  invalid inputs, then make them pass." "Fix the bug" → "a test that reproduces
  it, then make it green." "Refactor X" → "the suite is green before and after."
- **Reproduce before you fix.** Write the failing test that captures the bug
  *first* — it proves you understood it and guards against its return (this is
  `/bug-hunt`'s root-cause-first stance, and constitution-grade for any fix).
- **State a brief plan for multi-step work**, each step paired with its check:
  ```
  1. <step> → verify: <check>
  2. <step> → verify: <check>
  ```
- **Loop independently on strong criteria.** A clear success test lets you
  iterate without pestering the user; a weak one ("make it work") guarantees
  rework. Don't claim done until the check is green — report honestly if it isn't.

**Fits the kit.** This ties together what the kit already provides: `/bug-hunt`
(root cause first), the QA squad (`/test-plan`, `/scaffold-tests`, `/qa-signoff`),
`best-practices.md` §H7 (behavior tests that catch the bug), and the TodoWrite
plan. This rule is the thread that connects them on every task.

---

## These guidelines are working if…

- clarifying questions arrive **before** implementation, not after a wrong diff;
- diffs are smaller and every line traces to the request;
- fewer rewrites for overcomplication;
- fixes ship with a test that fails without them.

See [`behaviors-examples.md`](./behaviors-examples.md) for concrete before/after
diffs of each anti-pattern.
