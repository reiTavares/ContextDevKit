# Vibe-Coding Best Practices

> The actionable rubric `/analyze-code-ia-practices` checks against. It mirrors
> the constitution in `CLAUDE.md` — keep them consistent. Tune the numbers to
> your project (and `vibekit/config.json` → `l5.lineBudget`).

## 1. File size: 280 lines (+10% tolerance ≈ 308)

No source file should exceed **280 useful lines** in principle; up to **~308**
is tolerated only when splitting would break a genuinely cohesive unit — and
then you record the cohesion reason in a header comment.

**> 308 is a hard smell → refactor.** But refactor with **engineering judgment,
never sloppily.** Forbidden: "it got big, so I split it into file2.ts and
file3.ts at random line boundaries." Required: split by **responsibility**.

Intelligent refactor moves, in order of preference:
- **Extract a unit with one job** — a service/use-case, a pure helper module, a
  custom hook (UI state/effects), a sub-component (a `renderX()` becomes a real
  component), a validator/schema module, a mapper/adapter.
- **Promote inline render functions** (`renderHeader()`, `renderList()`) to real
  components.
- **Lift complex state** (`> 2 useState + ≥ 1 effect`) into a custom hook.
- **Separate layers** — transport (route/controller) vs business (service) vs
  data (repository/ORM). If business logic leaked into a controller, that's the
  split, not an arbitrary line cut.

If a smaller split would cause premature abstraction, **don't** — document the
cohesion and move on. 280 triggers analysis, it is not a guillotine.

## 2. Single Responsibility

Each function/module/component does **one** thing. A name needing "And"/"Or"/"E"
(`validateAndSave`, `fetchAndTransform`) signals two jobs → split.

## 3. Separation of concerns

- Visual logic ≠ business logic. Components stay "dumb"; logic lives in hooks/
  services/helpers.
- Transport layer dispatches; it never contains business rules.
- Side effects (IO, network, clock, randomness) are isolated and injectable.

## 4. Naming

Descriptive, explicit names. Banned without a qualifier: `data`, `temp`, `obj`,
`val`, `x`, `arr`, `result`. Readability beats clever/compact code.

## 5. Errors

Validate at the boundary, fail fast with typed/descriptive errors. Never swallow
exceptions silently; never leak stack traces to end users.

## 6. Documentation

Doc-comment non-trivial business logic, hooks, and public functions
(`@param`/`@returns`/`@throws`). Comments explain the **why**, not the obvious
**what**. A good name is the first layer of docs.

## 7. Tests

Critical paths and failure modes earn tests that would actually catch the bug.
See the QA squad (`/test-plan`, `/scaffold-tests`, `/qa-signoff`).

---

The deterministic scanner (`tech-debt-scan.mjs`) flags candidates against §1, §2,
§6 and §3 (React state-loops). `/analyze-code-ia-practices` runs it, then applies
the judgment the regex can't — proposing the *right* refactor per file.
