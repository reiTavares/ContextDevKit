# Squads — how the sub-agents are organized

> The sub-agents in `.claude/agents/` (installed at **Level 4**) aren't a loose
> pile — they're organized into **squads** with distinct jobs, and a coordination
> rule for when they disagree. This is the roster + the rules. Manage it with
> `/squad`. Enable the squads relevant to your project; ignore the rest.

## The squads

### 🛠️ devteam — constructive (builds + reviews)
Ships code and guards the constitution. Members:

| Agent | When to use |
| --- | --- |
| `architect` | Cross-cutting design, choosing a pattern, planning a migration — *before* code |
| `code-reviewer` | Pre-merge audit against `CLAUDE.md` (style, structure, SRP, immutable rules) |
| `context-keeper` | The platform itself: ADRs, sessions, glossary, hooks, commands, memory |
| `security` | Auth, secrets, crypto, trust boundaries, dependency risk, security review |
| `test-engineer` | Test strategy + writing tests, raising coverage, regression for a bug |
| _(add yours)_ | Domain agents you scaffold: `backend`, `frontend`, `db`, … (from `_TEMPLATE.md`) |

### 🧪 qa-team — adversarial (verifies behaviour under stress)
A red team with a different epistemic axis: it audits *behaviour*, not style.
Single entry point is the orchestrator.

| Agent | Tier | When to use |
| --- | --- | --- |
| `qa-orchestrator` | 1 | The router + sign-off. `/test-plan`, `/scaffold-tests`, `/qa-signoff` |
| `qa-unit` | 1 | Fast isolated unit tests (mocked deps) |
| `qa-integration` | 1 | Cross-boundary tests (HTTP/DB/queue/fs) |
| `qa-fuzzer` | 1 | Property-based / adversarial input on parsers, validators, auth |
| `qa-perf` | 2 | Benchmarks/profiling once a hot path is identified |
| `qa-e2e` | 2 | Critical user journeys through the real UI |

### 🔐 security-team — security & infra (DevSecOps)
The system's safety net: application security **and** the infrastructure and
supply chain it runs on. Enable on any project that ships to real users (i.e.
almost all). Owns the security best-practices bar and the dependency policy.

| Agent | When to use |
| --- | --- |
| `security` | AppSec: auth, secrets, crypto, input/trust boundaries, **dependency & supply-chain risk** (pinning, CVEs, licenses), threat modeling, security review |
| `devops` | Infra & delivery security: CI/CD, build/deploy, environments, secrets management, observability, release safety, infra hardening |
| _(add yours)_ | `sre` (reliability/incident), `dependency-auditor` (lockfile/CVE/license), `iac` (Terraform/k8s policy) as the system grows |

`security` and `devops` are **shared** with devteam/ops-team — security is a
cross-cutting concern, not a silo. On a Critical/High finding, security-team can
**block a release** (veto on the L5/L6 gates for high-risk paths).

### ⚖️ compliance-team — data protection & law
Enable when the product handles personal data (especially of Brazilian residents).

| Agent | When to use |
| --- | --- |
| `privacy-lgpd` | LGPD (Lei 13.709/2018): legal basis, consent, data-subject rights (Art. 18), retention/deletion, DPO, incidents/ANPD, processors. Standardized Brazilian-law skills. |
| _(add yours)_ | `gdpr`, `soc2`, `hipaa`, `accessibility-law` … per your jurisdiction/market |

### 🎨 design-team — UI/UX
Enable when the product has a user interface.

| Agent | When to use |
| --- | --- |
| `ux-designer` | Flows, information architecture, interaction, usability (incl. empty/error states) |
| `ui-designer` | Visual design + design system/tokens, layout, responsive behaviour |
| `accessibility` | WCAG 2.1 AA: semantics, keyboard, screen readers, contrast, focus |

### 📋 product-team & ⚙️ ops-team (starters included)
| Agent | Squad | When to use |
| --- | --- | --- |
| `product-owner` | product-team | Roadmap shaping, prioritization, requirements (stories + acceptance criteria) |
| `devops` | ops-team | CI/CD, build/deploy, environments, secrets, observability, release safety |

## Sovereignty (who decides when they conflict)

- **`code-reviewer` (devteam)** owns **style + the constitution** (ADR-0008-style).
- **`qa-orchestrator` (qa-team)** owns **behaviour + test sign-off**.
- **`security` (security-team)** owns **the security bar** — it can block a
  release on a Critical/High finding, regardless of the other squads.
- On conflict, **devteam decides** until the project reaches a maturity milestone
  you define — then quality gates can harden (see `/vibe-level`, the L5/L6 gates).

## Growing a squad

- **Add an agent** → copy `.claude/agents/_TEMPLATE.md`, give it a sharp
  `description` (that's how routing works), and list it here under its squad.
- **Rich briefing (two-tier, optional)** → a lean agent in `.claude/agents/` +
  a deep briefing in `vibekit/squads/<squad>/<agent>.md` (from `_BRIEFING.md.tpl`)
  for full anti-patterns and recipes. Use `/squad brief <agent>`.
- **New squad** → add a section here under the same convention.
  Use `/squad new-squad <name>`.

### More squads worth adding (templates / suggestions)
Scaffold any of these with `/squad new-squad <name>` when the project needs it:
- **docs-team** — `tech-writer` (READMEs, API docs, ADR prose, changelog clarity).
- **data-team** — `data-engineer` / `analytics` (schemas, pipelines, event tracking).
- **growth-team** — `seo` / `growth` (acquisition, funnels, instrumentation).
- **support-team** — `support-engineer` (triage, repro, runbooks from incidents).
- jurisdiction add-ons for compliance-team — `gdpr`, `hipaa`, `soc2`.

The orchestration commands (`/ship`, `/test-plan`, `/scaffold-tests`,
`/qa-signoff`) fan work out to these squads.
