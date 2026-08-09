---
description: Start a mutation-focused session on one objective and keep its scope bounded.
argument-hint: <session objective>
---

# Focused development

Use **$ARGUMENTS** as the single objective for this session.

1. Classify the interaction. Conversation and read-only exploration are no-op:
   do not create a task, workflow, ledger, receipt, or durable context. If the
   intent is unclassified, ask one short question in the user's language.
2. On mutation, resolve existing work before creating anything. Resume an
   explicit active reference. For a single strong inferred match, ask one short
   confirmation unless the owner already requested auto-resume. Do not reopen
   completed work without explicit intent. When an explicitly selected task is
   still in `backlog` and the owner asked to begin it, use
   `pipeline.mjs start <id> --tasks <scope>` against its canonical JSON scope.
3. Query Project Map first when it can locate the named symbol/path. Missing,
   stale, partial, or unanswered graph results immediately fall back to `rg`,
   `Grep`, `Glob`, or equivalent search; graph-first never blocks exploration.
4. Use the economy bootstrap only as a bounded recommendation:
   ```bash
   node contextkit/tools/scripts/economy/dev-start-bootstrap.mjs --objective -- "$ARGUMENTS"
   ```
   Render a reported checkpoint with `resume-pack.mjs`. Run Task Compiler only
   for an exact Project Map match. Neither result authorizes or denies work.
   For an unlinked mutation, read the bounded project summary once with
   `node contextkit/tools/scripts/context-pack.mjs --profile dev-start`; open
   full sources only when that summary identifies a relevant file.
5. Classify nature as `business`, `operation`, `none`, or `unclassified`, then
   choose `direct`, `batch`, or `workflow` from task topology. `none` is normal.
   One to three cohesive tasks are direct; four to twelve related unordered
   tasks are batch; dependencies, waves, multi-session work, cutover, or
   rollback require workflow.
6. State explicit in-scope and out-of-scope boundaries. Preserve unrelated
   dirty files and active workspace claims. Reclassify if the real work expands
   materially beyond those boundaries.
7. If the objective links a workflow, load the canonical governed context
   before the first write. It must include `workflow.json`,
   `workflow-state.json`, PRD, SPEC, decisions, `pipeline/tasks.json`, and the
   relevant reports. Never substitute the retired 3.x plan artifact, Markdown
   frontmatter, a physical lane, or `done/` discovery.
8. Keep routing and specialist selection advisory. Continue with the active
   agent when a model recommendation, receipt, specialist, or swarm is absent.
   LGPD observations are shadow-only. Use a swarm only when parallel work is
   genuinely useful; only a real host technical limit constrains it.
9. Implement the minimum complete change, run focused tests first, then the
   appropriate broader suite and QA sign-off. Only the deterministic guarded
   domains may deny: QA at `done`, an applicable Class A DDD invariant, or new
   high/critical technical debt introduced by the current diff.
10. At the end, report the exact diff, validation receipts, remaining risk, and
    whether anything was committed. Register the session only when productive
    mutation occurred.

The current owner instruction is the authority for action. Capability level,
model route, owner preference, and former autonomy grades do not grant consent.
