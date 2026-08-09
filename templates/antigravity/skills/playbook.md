# Skill: playbook

> Playbook registry + runner — list/show/run/track the reusable procedures in contextkit/workflows/playbooks/.
> Argument: [list | show <name> | run <name> [note] | runs]
# 📓 Playbook

Manage and run the project's **reusable procedures** (`contextkit/workflows/playbooks/`) —
the *why / how / anti-patterns* behind a skill. This is the managed layer over
that folder: a registry you can list, show, run, and track.

Act on **<user-specified argument>**:

- **list** (default) — `node contextkit/tools/scripts/playbook.mjs list`. Show the
  registry (every playbook + its title). Recommend the right one for the task at hand.
- **show `<name>`** — `node contextkit/tools/scripts/playbook.mjs show <name>`. Print the
  full procedure so you can read it before acting.
- **run `<name>` [note]** — `node contextkit/tools/scripts/playbook.mjs run <name> "<note>"`.
  Records the run in `contextkit/memory/playbook-runs.md` (audit trail) and prints the
  procedure; then **actually execute its steps**, applying its judgment, and report the
  outcome.
- **runs** — `node contextkit/tools/scripts/playbook.mjs runs`. Show the run history.

Composition: other flows reuse this instead of ad-hoc step lists — e.g. `/ship` and the
squads can `run` a playbook (tech-debt-sweep, simulate-impact, distillation-cycle,
security-batch) rather than restating it. Keep playbooks stack-agnostic; project-specific
detail belongs in a scoped `CLAUDE.md` or an ADR.
