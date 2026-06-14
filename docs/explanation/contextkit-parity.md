# The ContextKit parity import

_Why ContextDevKit ported eight generic-engineering features from `nolrm/contextkit` — and how each one stays advisory, level-aware, and incapable of breaking real work._

## Why import these at all

There is a second, unrelated project that happens to share a name: `nolrm/contextkit`
(`@nolrm/contextkit`, author Marlon Maniti). A deep read of *all* of its files —
not just its docs — surfaced a useful asymmetry. That kit is **horizontal**: it
spreads thin context across nine AI tools and prompt pipelines. ContextDevKit is
**vertical and deep**: governance *enforced* by hooks, ADRs, durable memory,
levels 1–7, autonomy grades, the forge, and the pipeline/ship/swarm stack.

The asymmetry was the point. The other kit had eight pieces of polished *generic
engineering* — real-time formatting, multi-language push gates, friendly install,
cloud issue→PR, a promotion threshold for new rules, a context budget, idempotent
file injection, and a fan of context bridges — that are **orthogonal to our
governance** and reinforce the "treat vibe coding as engineering" half of the kit.
None of it competes with our enforcement story; all of it fills a gap. That is
what ADR-0060 decided to import, and ADRs 0061 through 0068 each own one feature.

The whole batch shares three non-negotiable properties, because anything else
would violate the constitution:

- **Zero runtime dependencies on the hot path.** Every new hook and runtime script
  uses only `node:*` — no npm package can creep into the runtime (immutable rule 1).
- **Level-aware, never surprising.** Enforcers turn on *by level*, but in a
  warn-first posture; they only block on an explicit escalation.
- **Warn-first, fail-open.** A hook that cannot run reports "skipped" and exits 0.
  A missing toolchain is never counted as a failure (rules 2 and 8).

The umbrella ADR also recorded the explicit **rejections**: `ck note` (already
covered by our sessions/memory layer) and the strict-TS `types/` helper (too
niche). Importing is a decision; so is declining.

### The central tension, and how it was resolved

Two immutable rules pull against an "on-by-level" enforcer. Rule 8 says **default
to refuse, opt-in to permit** — a feature should be off until something proves it
should be on. Rule 2 says **hooks never break real work**. A push gate that turns
on at a level and blocks would honour neither.

ADR-0060 reconciles this with a single posture used by every enforcer in the batch:
**warn-first**. Turning on by level only earns the feature the right to *speak*;
blocking requires a second, explicit signal (`strictLevel`, a higher level, or an
opt-in flag). A detection miss always degrades to "skipped", never to a false
negative. The level dial decides *visibility*; an explicit threshold decides
*enforcement*.

## The eight features

| # | Feature (ADR) | The gap it closed | How it stays safe |
| --- | --- | --- | --- |
| F1 | [Auto-format hook](#f1--auto-format-hook-adr-0061) (0061) | quality only at push time | advisory, always exit 0 |
| F2 | [Pre-push quality gates](#f2--multi-language-pre-push-quality-gates-adr-0062) (0062) | pre-push only did conflict checks | warn-below / block-at |
| F3 | [Hook-manager coexistence](#f3--hook-manager-coexistence-adr-0063) (0063) | install clobbered existing pipelines | suggest, don't overwrite |
| F4 | [Marker-idempotent injection](#f4--marker-based-idempotent-injection-adr-0067) (0067) | no safe way to re-inject into user files | own one marked region only |
| F5 | [CI Squad action](#f5--ci-squad-action-adr-0064) (0064) | no cloud issue→PR loop | opt-in, draft PR only |
| F6 | [Context budget + `@`-imports](#f6--context-budget--imports-adr-0066) (0066) | no per-task context guidance | read-only guidance |
| F7 | [Standards promotion threshold](#f7--standards-promotion-threshold-adr-0065) (0065) | one-off patterns became rules | ≥3 occurrences to promote |
| F8 | [Multi-platform bridges](#f8--multi-platform-context-bridges-adr-0068) (0068) | context reached 3 hosts only | context-only, opt-in per tool |

### F1 — Auto-format hook ([ADR-0061](../../contextkit/memory/decisions/0061-posttooluse-format-lint-hook.md))

The other kit runs format + lint:fix after *every* edit in a session. We already
had a PostToolUse slot at level 2+ (track-edits) but nothing that formatted. The
new `auto-format.mjs` runs the project's formatter/linter right after each
Edit/Write at level ≥ 4, reusing the stack/package-manager detection that
`scaffold-tests.mjs` already carries.

Its design posture is the whole point: it is **advisory**. When a toolchain is
present it auto-fixes; when none is found it reports "skipped"; and it **always
exits 0**. A formatter problem must never break the agent's real work. The payoff
is that code leaves the session already formatted, so the push never carries a
"chore: format" debt. The cost is per-edit time, which is why `excludePaths`
exists to keep it off irrelevant paths.

### F2 — Multi-language pre-push quality gates ([ADR-0062](../../contextkit/memory/decisions/0062-multilang-prepush-quality-gates.md))

Our `pre-push` only did a conflict pre-check. `quality-gates.mjs` detects the
stack (ten languages plus a generic fallback) and runs the appropriate
lint/format/typecheck/build/test — **scoped to the monorepo packages the push
actually touches**, so a one-file change does not run the whole tree.

This is the warn-first contract made concrete, and the cleanest illustration of
the level/threshold split:

| Condition | Behaviour |
| --- | --- |
| below `minLevel` or `enabled:false` | silent, exit 0 |
| `minLevel ≤ level < strictLevel` | run gates, print failures, **exit 0** (warn) |
| `level ≥ strictLevel` | a failing gate **exits 1** (block) |
| tool not installed | reported **skipped**, never a failure |

It runs from the pre-push wrapper *after* the conflict check, and the orchestration
(config, thresholds, push-range, summary) is deliberately split from the
per-language matrix in `quality-gate-runners.mjs` to respect the line budget.
`CONTEXT_SKIP_QGATES=1` is the documented escape hatch.

### F3 — Hook-manager coexistence ([ADR-0063](../../contextkit/memory/decisions/0063-hook-manager-coexistence.md))

Our installer used to back up to `.bak` and install on top — correct, but hostile
to a repo that already runs Husky, Lefthook, simple-git-hooks, or a custom
`core.hooksPath`. F3 adds detection: when an existing manager is found, the install
**emits a suggested integration line** instead of a silent clobber, and keeps the
`.bak` backup as the safe fallback. The destructive-but-safe default is untouched;
the change is purely about not surprising a repo that already has a pipeline.

### F4 — Marker-based idempotent injection ([ADR-0067](../../contextkit/memory/decisions/0067-marker-idempotent-injection.md))

F4 is plumbing, not a user-facing feature — and it is the **enabler for F8**.
Several generated artifacts must be rewritten on every install without touching
the user's prose around them. Overwriting the whole file clobbers user edits;
appending every time duplicates. So `marker-inject.mjs` delimits a
ContextDevKit-owned region with inert HTML-comment markers —
`<!-- ContextDevKit:start -->` … `<!-- ContextDevKit:end -->` — and rewrites
**only** what lives between them. Everything outside is user-owned and preserved
verbatim, which makes a re-install byte-idempotent.

Its defensive contract follows rule 2 to the letter: it never throws on malformed
input. No markers means append a fresh block; a start without an end is treated as
no block (append fresh); duplicate starts collapse to the first start..first-end
span, and stray markers are left as user content — *we never delete what we cannot
prove is ours.*

### F5 — CI Squad action ([ADR-0064](../../contextkit/memory/decisions/0064-ci-squad-issue-to-pr.md))

We had `/gh-triage` (issue→backlog) and local `/ship` and `/swarm`, but no headless
cloud loop. F5 is a GitHub Action that, when an issue is labelled `squad-ready`,
runs the headless pipeline and opens a **draft** PR; a vague issue gets a comment
asking for acceptance criteria rather than a bad PR, and re-applying the label
re-triggers it.

The safety here is layered and deliberate. It **ships out of the default tree** —
installed only with `--ci-squad` (or the interactive prompt) — so nothing reaches
the cloud by accident. It needs an `ANTHROPIC_API_KEY` repo secret to function. And
it only ever opens a *draft*: review and merge stay human. Nothing fires without
the explicit label.

### F6 — Context budget + `@`-imports ([ADR-0066](../../contextkit/memory/decisions/0066-context-budget-and-at-imports.md))

The other kit keeps its constitution lean with `@`-imports that Claude loads on
demand, plus a "context budget" telling the agent *which* files to load per task.
We inject context via hooks but had no per-task budget. F6 adds lightweight
`@`-imports to `CLAUDE.md.tpl` (keeping the constitution thin) and a
`context-budget` skill that advises which context to load per task type:
**always / on-demand / skip**.

This one is **read-only guidance** — a posture, not an enforcer. It mutates nothing
and gates nothing; it lowers token cost by telling the agent what to *not* read.
The one caveat the ADR is honest about: `@`-imports are a Claude Code mechanic, so
on the other hosts they degrade to plain textual references.

### F7 — Standards promotion threshold ([ADR-0065](../../contextkit/memory/decisions/0065-standards-promotion-threshold.md))

A cheap but meaningful prompt refinement. `/distill-sessions` now only proposes a
new CLAUDE.md rule once a pattern has **≥3 evidenced occurrences** — an explicit
anti-"rule-of-one" gate. Below the threshold the pattern is logged as an
*observation*, not promoted to a rule. Complementing it, `/retro` deprecates a
superseded rule by **strikethrough** (`~~old rule~~ — deprecated: reason. Use X.`)
rather than deleting it, so the standards stay a living document with history
intact rather than a graveyard. The trade-off is patience: a legitimate pattern
with fewer than three sightings waits longer to become a rule. That is the point.

### F8 — Multi-platform context bridges ([ADR-0068](../../contextkit/memory/decisions/0068-multiplatform-bridges-six-tools.md))

The largest feature, and the one with the genuine architectural tension. The other
kit generates bridge files for nine tools; we extended to **six additional** tools
beyond our three native hosts — Cursor, GitHub Copilot, Gemini, Windsurf, Aider,
and Continue — each writing its own file format through `marker-inject.mjs`
(`.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `GEMINI.md`,
`.windsurfrules`, `CONVENTIONS.md`, `.continue/`, etc.).

It is **opt-in per tool** via `bridges.enabled`: an empty list — the default —
ships zero bridges. A missing or throwing installer is reported skipped, never a
failed install. And the bridges write idempotently, so a re-install updates the
marked block and leaves the rest of the file alone.

## Why bridges get context but not governance

This is the subtle architectural point, and it was assumed openly in ADR-0068
rather than papered over. Our governance is *enforced* — it lives in hooks, and
those hooks are specific to the three **native** hosts (Claude Code, Antigravity,
Codex), wired through the `host-adapter.mjs` registry. The six bridged tools have
no equivalent hook surface we control. So they receive the **CONTEXT layer only**:
they read the same project memory, constitution, and conventions, but nothing
*forces* compliance.

The honest risk is a wrong expectation — a user might assume Cursor or Copilot is
"governed" the way Claude is. The mitigation is not technical but documentary: the
bridge content and the docs state explicitly that these tools get context, not
enforcement. The alternative — faking enforcement on a host whose hooks we don't
own — would be the false-positive that rule 8 forbids. Context-only is the
*truthful* posture: it shares everything we can prove we share, and claims nothing
we cannot enforce.

## How this fits the immutable rules

Every feature in the batch was shaped by the constitution rather than bolted onto
it:

- **Zero hot-path deps (rule 1).** `auto-format.mjs`, `quality-gates.mjs`,
  `marker-inject.mjs`, and the bridge installers use only `node:*`. No npm package
  entered the runtime; Levels 1–3 still run in a project with nothing installed.
- **Hooks never break work (rule 2).** Auto-format always exits 0; quality-gates
  warns before it ever blocks; marker-inject never throws on malformed input and
  never deletes content it cannot prove is its own.
- **Default to refuse (rule 8).** Enforcement is opt-in (an explicit `strictLevel`,
  a higher level, `--ci-squad`, a per-tool `bridges.enabled`), a detection miss is
  "skipped" rather than a false pass, and the bridges refuse to claim a governance
  they cannot deliver.
- **Every addition ships with a test (rule 3).** Each feature added an
  `integration-test-*.mjs` harness plus a selfcheck wiring entry, so a regression
  fails `npm run ci` before it can ship.

The result is parity on the generic-engineering surface that ContextDevKit was
missing — real-time quality, push-time quality, friendly adoption, cloud
automation, and a far wider context reach — without conceding a single one of the
rules that make the kit *engineering* rather than vibes.
