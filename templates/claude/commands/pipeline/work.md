---
description: Business-driven methodology entry point — classify (intake), create/advance an Operation or Business work context, and drive the intake → operation → nested-workflow flow. Host-neutral; dry-run by default.
argument-hint: "intake \"<objective>\" | operation \"<title>\" [--apply] | status --id OP-#### | approve|revise|reject --id BIZ-#### | link|promote|reconcile"
allowed-tools: Bash(node:*)
---

`/work` is the **native Claude Code entry point** for the Business-driven
methodology (BIZ-0001 / WF-0036). Use it to START an operation the right way —
classify the request, then create the Operation/Business work context and its
nested workflow — instead of improvising.

> ⚠️ **Do NOT call `node ctx.mjs ...` or `node cdx.mjs ...` here.** Those are the
> **Antigravity** (`ctx`) and **Codex** (`cdx`) runners — they may not even exist
> in a Claude-only install. From Claude Code always invoke the host-neutral script
> directly: `node contextkit/tools/scripts/work.mjs <verb>`.

## When to use

- **Starting any non-trivial request** — run `intake` first to get the Work Nature
  (business vs operation), Tier, Execution Ceremony and business match. This is the
  standing intake obligation from `CLAUDE.md`.
- **Creating an Operation** (fix / maintain / execute within something that exists).
- **Advancing a Business** through its lifecycle (approve/revise/reject — approval
  needs `--actor human`).

## Posture

**Dry-run by default** (constitution §8). A mutator (`operation`, `approve`, …)
writes nothing until you pass `--apply`. `intake` is read-only — its receipt IS
the output. Always read the receipt and act on it; never assume a write happened.

## The flow (intake → operation → nested workflow)

```bash
# 1. Classify the objective (read-only — returns nature/tier/ceremony/business match)
node contextkit/tools/scripts/work.mjs intake "<your objective>"

# 2a. Operation work (direct/batch): create the OP-#### context
node contextkit/tools/scripts/work.mjs operation "<title>" --intent IMPROVE          # dry-run
node contextkit/tools/scripts/work.mjs operation "<title>" --intent IMPROVE --apply  # write

# 2b. A workflow nests UNDER its owner (BIZ/OP) — never central [[workflow-must-nest-under-owner]]:
node contextkit/tools/scripts/workflow.mjs new <slug> --owner OP-####

# 3. Inspect / advance a Business work context
node contextkit/tools/scripts/work.mjs status  --id BIZ-0001
node contextkit/tools/scripts/work.mjs approve --id BIZ-0001 --actor human --apply
```

## All verbs

`intake` · `operation` · `status` · `approve` · `revise` · `reject` · `render` ·
`link` · `unlink` · `promote` · `reconcile` · `start` · `close` · `validate`

Run `node contextkit/tools/scripts/work.mjs <verb> --help` style by invoking the
verb; the receipt names the next corrective step on any refusal.

## Steps for you (the agent)

1. Run `intake` with the user's objective; report nature / tier / ceremony / business match.
2. If it is **operation** work, create the `OP-####` with `operation` (dry-run, show
   the plan, then `--apply` once confirmed).
3. Nest any workflow under the owner with `workflow.mjs new <slug> --owner <id>`.
4. For **business** changes, an accepted governing ADR is required before material
   work (decision coverage) — pair with `/new-adr`.
