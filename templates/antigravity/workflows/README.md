# contextkit/workflows — the levels (L1–L6) + playbooks

ContextDevKit's context system operates in **levels**. Each one solves a distinct
problem of humans + Claude sharing one codebase across many sessions. These docs
are the *narrative* layer — the **why** and **how it fits together** — behind the
executable hooks (`contextkit/runtime/hooks/`), skills (`.agents/skills/`),
and config (`contextkit/config.json`).

> These are reference docs; they never run. Behaviour lives in the hooks and
> scripts — this folder explains the design so a human (or Claude) can reason about
> it. Keep a doc in sync **in the same change** that alters its mechanism.

## The levels

| Level | Problem it solves | Doc |
| --- | --- | --- |
| **L1** | Loading the essentials at boot without the user re-explaining. | [`L1-static-loading.md`](L1-static-loading.md) |
| **L2** | Detecting that a session touched important files but was never logged. | [`L2-session-ledger.md`](L2-session-ledger.md) |
| **L3** | Parallel sessions (one dev in many chats, or many devs) without state corruption. | [`L3-multi-session.md`](L3-multi-session.md) |
| **L4** | Domain delegation via a squad of specialized sub-agents. | [`L4-squads.md`](L4-squads.md) |
| **L5** | Turning "architecture before syntax" into executable gates (impact, debt, contracts). | [`L5-proactive.md`](L5-proactive.md) |
| **L6** | Insight, autonomy, and a learning loop on top of the L5 gates. | *capability tier — see below* |

**L6 adds no new hook** — same wiring as L5. It's a capability tier: insight
(`/context-stats`), autonomy (`/ship`), and a learning loop (`/retro` +
`/distill-sessions`). See [`docs/ROADMAP.md`](../../docs/ROADMAP.md) for the rationale.

## Playbooks

Files in [`playbooks/`](playbooks/) describe **reusable working procedures** Claude
follows during a session. Each is the detailed *why / how to read / anti-patterns*
behind a skill — the file in `.agents/skills/` is the operational spec;
the playbook is the judgment around it.

| Playbook | skill(s) | What it governs |
| --- | --- | --- |
| [`tech-debt-sweep.md`](playbooks/tech-debt-sweep.md) | `/tech-debt-sweep` | Reading the deterministic debt scan; resisting "fix it all". |
| [`simulate-impact.md`](playbooks/simulate-impact.md) | `/simulate-impact` | Pre-flight blast-radius analysis before high-risk edits. |
| [`distillation-cycle.md`](playbooks/distillation-cycle.md) | `/distill-sessions` + `/distill-apply` | Turning observed patterns into governed CLAUDE.md rules. |
| [`security-batch.md`](playbooks/security-batch.md) | `/deep-analysis` + `/deps-audit` | The recurring security sweep and how to triage it. |

## Maintenance

- Keep each doc **lean** and under the constitution's file-size budget (280 lines).
- These are stack-agnostic on purpose. Project-specific detail belongs in a scoped
  `CLAUDE.md` or an ADR, not here.
- A stale workflow doc is worse than none — update it when its mechanism changes.
