# Playbook: security-batch

> Reusable procedure. Follow the steps below when invoked.

---
phases:
  - pipeline
  - ship
squads:
  - security-team
---
# Playbook — Security batch (recurring security sweep)

> Operational specs: [`.agents/skills/deep-analysis.md`](../../../.agents/skills/deep-analysis.md)
> and [`.agents/skills/deps-audit.md`](../../../.agents/skills/deps-audit.md).
> This page is the **why**, the **recurring rhythm**, and how to **triage** the output.

## Why it exists

Security review tends to happen reactively — after an incident, or never. A *batch*
turns it into a scheduled, artifact-producing sweep, so risk is found before it ships
and the findings live in the backlog, not in a lost chat.

The kit makes security **active, not reactive**: a SessionStart trigger reminds you
to run `/deep-analysis` every N sessions (`securityMode.everyNSessions`, on by
default). This playbook is what you do when that reminder fires — or before a release
that touches a sensitive surface.

## The batch, in order

1. **Dependency & supply chain** — `/deps-audit`: lockfile present and respected,
   versions pinned, known CVEs, license posture. Owned by the **security-team**
   (`security` for AppSec, `infra-security` for IaC/cloud, `devops` for delivery).
2. **Global sweep** — `/deep-analysis`: aggregates every deterministic scanner
   (tech-debt, deps, contract) into one report, then adds judgment — a security pass,
   an architecture pass, a bug pass.
3. **Triage into the backlog** — every finding becomes a DevPipeline task
   (`/pipeline`) with a severity (S1–S4) and an SLA, so nothing is "noted and
   forgotten".
4. **Promote the systemic ones to ADRs** — a recurring class of finding (not a
   one-off) is a decision, not a ticket: `/new-adr`.

## How to triage

- **Severity over volume.** One S1 (auth bypass, secret exposure, RCE) outranks
  twenty nits. Sort by blast radius, not by count.
- **Trust boundaries first.** Findings at input boundaries (auth, deserialization,
  external webhooks, file upload) outrank internal hygiene.
- **A scanner finding is a lead, not a verdict.** Deterministic scanners produce
  false positives; confirm before filing an S1.
- **Pin the fix to an owner.** Each accepted finding → a backlog task with an owner
  and an SLA, or an explicit, recorded "won't fix (why)".

## Anti-patterns

1. **Running the batch and never triaging.** A report nobody turns into tasks is
   theatre. The deliverable is backlog items, not a markdown file.
2. **Fixing low-severity nits while an S1 waits.** Severity ordering is the whole
   point.
3. **Suppressing a CVE by ignoring the advisory.** Upgrade, replace, or record an
   accepted-risk decision with an expiry — never silently mute.
4. **Treating every finding as an ADR.** One-offs are tickets; only the recurring,
   systemic class earns an ADR.
5. **Disabling security mode "because it's noisy".** Tune `everyNSessions` instead;
   turning it off removes the signal exactly when it matters.

## Cadence & configuration

`securityMode` lives in `contextkit/config.json` (`active`, `everyNSessions`). Tune via
`/context-config set`. Pair the batch with a release: run it before closing a version
(`/close-version`) that touched auth, crypto, dependencies, or infra.

## Relation to other components

- **`/tech-debt-sweep`** — health vs security: the sweep's `security` profile is a
  fast pre-filter; the batch is the deep pass.
- **`/simulate-impact`** — fire it before implementing a fix on a high-risk path.
- **Contract-drift gate** — a security fix that changes a public signature still
  needs a `BREAKING CHANGE:` footer.
