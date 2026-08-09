# Reference: Slash commands

Every slash command the platform ships, grouped by domain. Generated from the command registry.

<!-- BEGIN AUTO-GENERATED: commands (docs-generate.mjs, ADR-0115) — edits inside are overwritten -->

_80 slash commands across 8 domains._

### audit

| Command | What it does |
| --- | --- |
| `/analyze-code-ia-practices` | Review the codebase against the best-practices rubric and propose INTELLIGENT refactors (not random splits). |
| `/audit` | One-pass health audit — runs doctor, a tech-debt sweep, and a QA status check; summarizes top actions. |
| `/contract-check` | Detect breaking changes to the public contract (removed/renamed exports) vs the baseline. |
| `/deep-analysis` | Global read-only analysis across code, security, dependencies, and likely defects. |
| `/deps-audit` | Read-only dependency and supply-chain audit with optional explicit report output. |
| `/security-setup` | Scaffold GitHub-native security and inspect alerts without creating hidden task state. |
| `/seo-audit` | SEO + AISO audit — runs the two static analysers and summarises findings. Refuse-on-SPA for landing pages. (ADR-0025) |
| `/tech-debt-sweep` | Audit the codebase against the constitution — deterministic scan + your interpretation. |
| `/validate-doc` | Quality gate for our own planning artifacts (ADRs / roadmap) — measurability, trade-offs, no placeholders. Advisory, never blocks. |

### forge

| Command | What it does |
| --- | --- |
| `/forge-audit` | Tally the audit log for a forged Agent Package — call counts by outcome, fallback rate, cost summary. Read-only. (agent-forge squad) |
| `/forge-budget` | Aggregate monthly target + hard-cap across every forged Agent Package — the consolidated cost view. Read-only. (agent-forge squad) |
| `/forge-deprecate` | Stamp `metadata.deprecated_at` into a forged Agent Package's manifest and recommend an ADR for the reason. Atomic write; dry-run by default. (agent-forge squad) |
| `/forge-doctor` | Integrity check across every forged Agent Package — required files present, no {{TOKEN}} placeholders left in governance YAMLs. Read-only; exits non-zero on any problem. (agent-forge squad) |
| `/forge-eval` | Run the eval gate (golden + red-team) for one forged Agent Package against its thresholds. Default provider is a deterministic mock for CI; --provider chaos exercises an upstream-503. (agent-forge squad) |
| `/forge-fallback-test` | Chaos-test the fallback path for one forged Agent Package by simulating a primary 503 on the first call. Verifies the eval scaffold survives upstream failures. (agent-forge squad) |
| `/forge-killswitch` | Toggle quality.policy.yaml's `kill_switch.enabled` (on\|off) for one forged Agent Package. Atomic write; dry-run by default. (agent-forge squad) |
| `/forge-list` | List every forged Agent Package under agent-packages/ (or --root <dir>) with version + routed primary model + eval-stamp status. Read-only. (agent-forge squad) |
| `/forge-new` | Forge a new portable Agent Package — interviews the dev (architect), routes to a provider (router), renders per-provider files (prompt-engineer + tool-designer), and packages the APF v1 under agent-packages/<name>@<semver>/. (agent-forge squad) |
| `/forge-policy` | Print the resolved cost / compliance / quality policies + fallback chain for one forged Agent Package. Read-only. (agent-forge squad) |
| `/forge-redteam` | Run red-team only (prompt injection / jailbreak / PII leak) for one forged Agent Package. Useful between releases without re-paying for a full golden run. (agent-forge squad) |
| `/forge-refresh-matrix` | Bump router/capability-matrix.json's `updated` date and report the model count. Dry-run by default; pass --write to apply. Real price/model changes require an ADR. (agent-forge squad) |
| `/forge-route` | Re-execute the model-router against the current capability-matrix + decision-rules for one Agent Package and DIFF vs the live manifest. Read-only — no manifest is touched. (agent-forge squad) |
| `/forge-show` | Display the manifest, provenance, and last eval timestamp for one forged Agent Package. Read-only. (agent-forge squad) |

### general

| Command | What it does |
| --- | --- |
| `/advise` | Read-only, six-lane improvement scan across architecture, product, security, UX, and growth. |
| `/autonomy-report` | Show or verify a stored Session Autonomy Receipt (token/autonomy/cost) for a session. |
| `/bug-hunt` | Investigator mode — find root cause before writing any new feature code. |
| `/claude-md` | Ensure every app/module has its own scoped CLAUDE.md, then fill each with real local rules. |
| `/close-version` | Close the current version in the CHANGELOG ([Unreleased] → [X.Y.Z]) and tag it. |
| `/context-budget` | Context budget — guidance on WHICH context files to load per task type (always / on-demand / skip) to keep token cost low. Read-only advice. (ADR-0066) |
| `/context-refresh` | Regenerate the dynamic full-project snapshot (.context-snapshot.md). |
| `/context-stats` | Show platform telemetry — sessions, drift rate, ADRs, agents, weekly cadence. |
| `/dashboard` | Visual dashboard — pipeline lanes + ADRs + sessions + roadmap + CHANGELOG. Snapshot HTML by default; live SSE-driven view with --watch. |
| `/debate` | Open a multi-agent deliberation — a council of specialist voices debate a hard question with tiered research, a synthesizer converges, the result feeds an ADR. (ADR-0035 / ADR-0070) |
| `/distill-apply` | L5 — apply a reviewed .distillation-proposal.md to CLAUDE.md and record an ADR for the cycle. |
| `/distill-sessions` | L5 — analyze recent sessions and propose refinements to CLAUDE.md (writes a proposal, applies nothing). |
| `/docs-reindex` | Apply/maintain the Diátaxis docs spine — ensure the four buckets and regenerate docs/README.md. Idempotent, never moves or loses files. |
| `/domain` | Domain Engineering diagnostic — optional CMIS/DAS/profile recommendations. Observation-only; never mutates or blocks. |
| `/fable` | Manual premium tier (ADR-0052) — run ONE task on Claude Fable 5, the deliberately expensive/limited model. Explicit-only; never automatic. |
| `/fleet` | Fleet mode — one control plane over many ContextDevKit repos (portfolio stats, cross-repo audit, CLAUDE.md rule-drift). |
| `/landing-page` | Landing-page architect + conversion squad — interview-first, anti-cookie-cutter, deterministic scaffold (lp-scaffold/lp-build), LGPD by default. (ADR-0023 + ADR-0050) |
| `/log-session` | Register the current session (creates a session file + updates CHANGELOG). Use at the end. |
| `/media-gen` | Generate images (Nano Banana) or video (Veo) via Google AI Studio. Refuses cleanly without credentials. (ADR-0024) |
| `/new-adr` | Generate, validate, and explicitly accept a canonical ContextDevKit ADR. |
| `/playbook` | Playbook registry + runner — list/show/run/track the reusable procedures in contextkit/workflows/playbooks/. |
| `/predictions-review` | Close the predicted-vs-actual loop from the current Git diff. |
| `/project-map` | Deterministic, stack-agnostic structural map of the project (modules, frontend/backend, symbol inventory) — durable memory the agent reads instead of re-exploring. |
| `/roadmap` | Create/manage the product roadmap (the what/why). New project: build it with the user. Existing: find or analyze→propose. |
| `/simulate-impact` | L5 pre-flight — map the blast radius of a change BEFORE editing high-risk paths. |
| `/squad` | Show/route/grow/audit the agent squads — the roster, playbooks, active routing, and onboarding config. |
| `/state` | Quick summary of current project state (latest session + Unreleased + key rules) |
| `/token-report` | Token economy & usage insight — report Claude Code token usage per session/week with budget warnings. |
| `/tune-agents` | Propose evidence-backed refinements to agent briefings without applying them. |

### mcp

| Command | What it does |
| --- | --- |
| `/mcp` | Manage Model Context Protocol (MCP) servers — discover, add (curated), health-check, audit, and sync host configs from the curated registry. |

### pipeline

| Command | What it does |
| --- | --- |
| `/dev-start` | Start a mutation-focused session on one objective and keep its scope bounded. |
| `/pipeline` | Manage tasks in one canonical ContextDevKit 4 JSON scope. |
| `/pipetest` | Deterministic QA gate for explicitly scoped canonical testing tasks. |
| `/plan-week` | Rank canonical backlog tasks by explicit priority and dependency readiness. |
| `/retro` | Read-only learning review that proposes governance improvements from durable evidence. |
| `/runs` | List recent task transitions + pipeline runs from the state.json substrate (ADR-0015 Part C). Read-only, token-light. |
| `/ship` | L6 — autonomous feature pipeline. Drives the full squad: design → implement → review → test → log. Checkpoints can be manual or automatic. |
| `/swarm` | Coordinate conditionally required parallel work over explicit, disjoint task scopes. |
| `/work` | Business-driven methodology entry point — classify (intake), create/advance an Operation or Business work context, and drive the intake → operation → nested-workflow flow. Host-neutral; dry-run by default. |
| `/workflow` | Create, load, validate, render, and advance a canonical Workflow v2 package. |
| `/workflow-assist` | Workflow Navigator — shows the current phase, deliverables, and next commands for an ADR-0057 workflow. Read-only; never mutates state. |

### qa

| Command | What it does |
| --- | --- |
| `/qa-signoff` | QA — final verdict. Run the suite, check critical-path coverage vs target, write a PASS/NEEDS-WORK report. |
| `/scaffold-tests` | QA — materialize tests for the given files, routing each slice to the right specialist. |
| `/test-plan` | QA — generate a 3-layer test plan (happy / edge / failure) for a scope, before writing test code. |
| `/visual-test` | Visual / browser-driven testing harness — scaffold + run screenshot/visual-regression checks (qa-e2e + design-team). |

### setup

| Command | What it does |
| --- | --- |
| `/aidevtool-from0` | Bootstrap a brand-new (empty) project from zero — product idea, interactive questionnaire, stack suggestion, roadmap, best practices. |
| `/context-config` | Inspect or edit contextkit/config.json (ledger path lists, L5 high-risk paths, distill params). |
| `/context-doctor` | Diagnose this project's ContextDevKit install (node, config, hook wiring, git hooks, onboarding). |
| `/context-level` | Show or change the ContextDevKit activation level (1–7). |
| `/setupcontextdevkit` | One-shot intelligent onboarding — inspects the project and self-configures ContextDevKit to it. |

### vcs

| Command | What it does |
| --- | --- |
| `/changelog-social` | Turn a finished CHANGELOG release into announcement copy (release notes + short social posts). Drafts only — never posts. |
| `/claim` | Reserve path(s) for this session so parallel sessions get a cross-claim warning. |
| `/draft-changelog` | Draft a [Unreleased] CHANGELOG skeleton from Conventional Commits since the last tag. Drafts only — never writes the file. |
| `/gh-triage` | Triage open GitHub issues into one explicit canonical task scope. |
| `/git` | Version-control command — git workflow + connect a remote (GitHub/GitLab/other) with the CLI, fully integrated. |
| `/release` | Release this session's claim(s) — a specific path, or all of them. |
| `/worktree-new` | Create a git worktree + branch for a parallel session on the same machine. |

<!-- END AUTO-GENERATED: commands -->
