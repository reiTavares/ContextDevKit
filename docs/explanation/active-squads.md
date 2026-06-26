# Active agent squads

_Why ContextDevKit turned its declared agent squads into an actively-routed, governed orchestration layer — deterministic routing, posture activation, stack-aware playbooks, and a compliance gate at pre-commit._

## The problem: squads existed, but nothing drove them

By Level 4+ the kit already shipped a roster of specialized agents grouped into
squads — `devteam`, `qa-team`, `design-team`, `security-team`, `compliance-team`,
`ops-team`, `growth-team`, `agent-forge`. They were **declared**: a manifest, a
folder, a `/squad` command that could list them. But they were **passive**.
Nothing connected the work you were actually doing to the squad that should own it.

That gap had three concrete costs:

- **Context dilution.** Touching an auth middleware and a database schema in the
  same session loaded no security or privacy posture. The agent reasoned as a
  generalist with no specialist lens.
- **No stack-customized playbooks.** A squad's expertise lived as prose in a
  manifest, not as a guide tuned to *this* project's stack and conventions.
- **Uncoordinated parallel work.** High-risk files could be edited without any
  record that the right specialist posture was even considered, and the L5 gate
  had no way to ask "was this change reviewed under the posture it needed?"

The active squads design closes that gap: keep the squads, but wrap them in a thin,
deterministic, **governed** orchestration layer rather than relying on the AI
remembering to wear the right hat.

## The mental model: routing → posture → playbook → gate

The system reads as a short pipeline. A change (a file diff or a stated intent)
is **routed** to the squads that own it; the relevant squad **postures** are
recorded in the session; the matching **playbook** sections are assembled into a
token-light context; and at the pre-commit boundary an **auditor** checks that
high-risk edits were made under the posture they require. Four pillars carry it.

### 1. Dynamic playbook templates — scaffolded per squad

During onboarding the kit scaffolds eight playbooks under
[`workflows/playbooks/squads/`](../../templates/contextkit/workflows/playbooks/squads/)
— one per squad (`squad-security.md`, `squad-compliance.md`, `squad-qa.md`,
`squad-frontend.md`, `squad-ops.md`, `squad-growth.md`, `squad-devteam.md`,
`squad-agent-forge.md`). Each is a compact, stack-aware brief: who is on the
squad, and the handful of best-practices that posture enforces (a security
playbook is about secret hygiene and L5 clearance; a compliance playbook is about
PII and consent). These are templates the project owns and edits, not advice
buried in source.

### 2. The metadata registry — paths + keywords → squads

[`squads-registry.json`](../../templates/contextkit/policy/squads-registry.json)
is the routing table. Each row maps a squad and its lead agent to a **playbook**,
a set of **path patterns** (`auth/`, `.env`, `prisma/schema.prisma`,
`.github/workflows/`, `src/components/`…), and a set of **intent keywords**
(`token`, `lgpd`, `deploy`, `wcag`, `coverage`…). Routing is deterministic: a
file path or an intent phrase either matches a row or it doesn't. There is no
model call in the routing decision — that is the point. The table is **extensible
via `config.json`**: a `squads` override there replaces the shipped registry, so
a project can teach the router its own conventions without forking the kit.

### 3. The context director — token-minimized posture at boot

[`squad-director.mjs`](../../templates/contextkit/tools/scripts/squad-director.mjs)
runs at session boot. It reads `git status`, matches the touched files (and any
stated intent) against the registry, and assembles a posture context from **only
the matched squads' playbooks** — not the whole library. It does two more things:

- A **PII scan** of schema-like files (`.prisma`, anything under `db/` or named
  `schema`) for fields such as `email`, `cpf`, `phone`. A hit auto-activates the
  `compliance-team` posture even when no keyword was typed.
- A **coverage check** against `package.json`: if the stack contains something
  with no agent (Stripe, Redis, an AWS SDK) it suggests scaffolding a specialist
  via `agent-forge`, rather than silently leaving the gap.

When nothing matches, it falls back to `devteam` — there is always a posture.

### 4. The compliance auditor — the pre-commit gate

[`squad-audit.mjs`](../../templates/contextkit/tools/scripts/squad-audit.mjs) is
the enforcement half. It is wired into the pre-commit
[`guard.mjs`](../../templates/contextkit/tools/scripts/guard.mjs) gate (and CI):
when an edit lands on an **L5 high-risk path**, `guard.mjs` invokes the auditor
with the session id and the specific target path. The auditor scans for
hardcoded secrets, then checks every gated file (`security-team`,
`compliance-team`, `ops-team`) against the **postures recorded as active in the
session ledger**. A gated high-risk file with no active posture is a hard block;
a gated file outside the L5 set is a warning that names the agent and the
`/squad route` command to load its playbook.

## Why extract only the needed sections — the token economy

Loading all eight playbooks at every boot would be the naive design, and it would
be wrong. Context is finite and metered: every token of posture you inject is a
token unavailable for the actual work, and a direct cost. The director's whole
value is **subtraction** — it computes the small set of squads that the current
diff actually implicates and assembles a context from just those playbook
sections. A session that only touches `src/utils/` gets the `devteam` posture and
nothing else; a session touching `auth/` and a Prisma schema gets security and
compliance, and still skips growth, design, and ops. This is the same
cost-discipline instinct that drives the kit's cost-tiered model routing (see
[model-tier-routing-study.md](model-tier-routing-study.md)): spend the expensive
resource only where it changes the outcome.

## `route` vs `activate`, and why the gate stays local

The two verbs are deliberately different operations:

- **`/squad route`** is **read-only deterministic routing.** It runs the director
  against your intent and diff and prints the suggested postures, their playbooks,
  and any agent-forge suggestions. It changes nothing. It answers "who owns this?"
- **`/squad activate`** **records** the detected postures in the **session
  ledger** (`recent.ledger.squads`), merging with any already active. It answers
  "I am now working under these postures" — and that record is exactly what the
  auditor reads.

This split is what makes the gate honest. When `guard.mjs` checks an edit, it
passes the auditor **only the target path it is deciding about**. The auditor
audits that one file against the ledger's active postures — it does **not** sweep
every modified high-risk file in the tree. That scoping (added in v2.6.3, the
"active squad posture gate" fix) prevents cross-file leakage: an unrelated
half-finished change to another high-risk file can no longer block or distort the
decision about the file you are actually committing.

## Graceful fallback: missing coverage suggests forging a specialist

The system never refuses to a dead end. If routing finds no squad for a stack
component, the director surfaces an **agent-forge suggestion** instead of failing
— "your project uses Stripe and has no `stripe` agent; consider `/forge-new`."
Missing coverage becomes a prompt to grow the roster, closing the loop back to
the [agent-forge squad](../SQUADS/agent-forge.md).

## Trade-offs

This is not free. It adds **two helper scripts** (`squad-director.mjs`,
`squad-audit.mjs`) plus a **registry JSON** to the runtime footprint, and
**onboarding has more files to seed** — the eight playbooks and the registry must
be scaffolded and, ideally, tuned to the project. The kit's judgment in ADR-0069
is that the cost is small and bounded (both scripts hold the zero-runtime-dep,
<280-line budget and fail silently), while the upside — automatic specialist
postures, token-minimized context, and a real pre-commit compliance gate — is the
difference between squads that exist and squads that *act*.

## See also

- [Squad — design-team](../SQUADS/design-team.md) — a worked example of a squad's
  roster and how its specialists pair.
- [Squad — agent-forge](../SQUADS/agent-forge.md) — the factory the fallback
  points at when coverage is missing.
- [The deliberation council](deliberation-council.md) and
  [workflow governance](workflow-governance.md) — the other two halves of the
  governed-orchestration story that landed alongside active squads.
- [Model-tier routing study](model-tier-routing-study.md) — the cost-discipline
  rationale that informs how squad context is assembled.
