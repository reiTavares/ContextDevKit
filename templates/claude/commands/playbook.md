---
description: Playbook registry + runner — list/show/run/track the reusable procedures in vibekit/workflows/playbooks/.
argument-hint: [list | show <name> | run <name> [note] | runs]
---

# 📓 Playbook

Manage and run the project's **reusable procedures** (`vibekit/workflows/playbooks/`) —
the *why / how / anti-patterns* behind a slash command. This is the managed layer over
that folder: a registry you can list, show, run, and track.

Act on **$ARGUMENTS**:

- **list** (default) — `node vibekit/tools/scripts/playbook.mjs list`. Show the
  registry (every playbook + its title). Recommend the right one for the task at hand.
- **show `<name>`** — `node vibekit/tools/scripts/playbook.mjs show <name>`. Print the
  full procedure so you can read it before acting.
- **run `<name>` [note]** — `node vibekit/tools/scripts/playbook.mjs run <name> "<note>"`.
  Records the run in `vibekit/memory/playbook-runs.md` (audit trail) and prints the
  procedure; then **actually execute its steps**, applying its judgment, and report the
  outcome.
- **runs** — `node vibekit/tools/scripts/playbook.mjs runs`. Show the run history.

Composition: other flows reuse this instead of ad-hoc step lists — e.g. `/ship` and the
squads can `run` a playbook (tech-debt-sweep, simulate-impact, distillation-cycle,
security-batch) rather than restating it. Keep playbooks stack-agnostic; project-specific
detail belongs in a scoped `CLAUDE.md` or an ADR.
