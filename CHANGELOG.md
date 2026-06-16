# Changelog

All notable changes to ContextDevKit are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
this project follows [Semantic Versioning](https://semver.org/).

> **Two changelogs, two contexts — don't conflate them.**
> *This* file (the repo-root `CHANGELOG.md`) is **ContextDevKit's own product
> changelog**: the release chronology of the kit itself, closed via
> `/close-version` and tagged for release. It is the only changelog tracked in
> this source repo.
> Separately, the installer creates a `docs/CHANGELOG.md` **inside each
> installed project** (rendered from `templates/docs/CHANGELOG.md.tpl`) — that
> one chronicles the *target project's* releases, not the kit's. Every
> `docs/CHANGELOG.md` reference under `templates/**` (in `/log-session`,
> `/close-version`, `/draft-changelog`, etc.) means *that* installed-project
> file, which runs in the target repo — never this product changelog.
> In this repo's dogfood install, `docs/CHANGELOG.md` exists only as a
> gitignored artifact (`.git/info/exclude`) and is never committed.

## [Unreleased]

## [3.0.1] - 2026-06-16

Hotfix release. Closes two defects found in the public `3.0.0`: a P0 config
corruption during `--update`, and the HIGH gap where automatic routing was a
library but never wired into real prompts. No breaking changes; drop-in upgrade.

### Fixed

- **P0 — `--update` could corrupt `config.json` path lists.** The v3.0.0
  installer's path-migration healer treated the first segment of ANY
  non-resolving path as a legacy platform prefix, accepted an empty suffix
  (`dist/` → `contextkit/`), and adopted the rewrite merely because `contextkit/`
  exists on disk after install. *Symptom:* legitimate lists such as
  `["src/","lib/","node_modules/","dist/","build/","coverage/"]` collapsed into
  duplicate `["contextkit/", …]` entries ("migrated N config path(s) onto
  contextkit/"). *Fix:* migration is now allowlist-gated — it rewrites only a
  KNOWN legacy prefix (`vibekit`, single-sourced from the installer's rename map),
  never an empty suffix, only when the rewritten target resolves on disk, and
  never touches globs, URLs, absolute, Windows or variable paths; order-preserving
  and idempotent. `config.json` is now written atomically (tmp + rename, never
  partial) and only when changed, backing up to `config.json.bak` before any
  legacy-path repair. *Compatibility:* fully backward compatible; a clean v3.0.0
  config is left byte-identical. *Rollback:* revert to 3.0.0 (re-introduces the
  bug); no data migration needed. (`tools/install/config-paths.mjs`, `engine.mjs`,
  `fs.mjs`)
- **P0 — recovery for already-affected installs.** `/context-doctor` now detects
  the collapse signature and a new `contextkit/tools/scripts/config-health.mjs`
  diagnoses + safely recovers: states `healthy / suspected_corruption / repairable
  / manual_repair_required / repaired / skipped`, `--json` output, dry-run by
  default. It NEVER invents values — the collapsed strings are unrecoverable from
  the file, so an ambiguous case is `manual_repair_required`; deterministic
  recovery is offered only from a healthy `config.json.bak` and only after
  re-verifying the restored config is itself clean, preserving the corrupted file
  as `config.json.corrupt` evidence.
- **HIGH — automatic routing now runs on real prompts.** In v3.0.0 the ADR-0094
  routing modules (classifier, decision, telemetry) were reachable only from tests
  and the boot banner: the real `UserPromptSubmit` hook built an Execution Contract
  but never classified the prompt, decided a route, or wrote
  `routing-decisions.jsonl` — so `shadow` observed nothing and `/token-report` had
  no data. *Fix:* a thin orchestrator (`runtime/execution/routing-runtime.mjs`)
  composes the canonical modules and the hook now records a real decision per task
  prompt and surfaces the recommendation on the contract. *Host limitation
  (honest by design, ADR-0094 §Decision):* no host can switch the current session's
  model from a hook, so a decision's `applied` is always `false` with an explicit
  reason (`shadow_mode` / `host_does_not_support_in_session_model_switch` / …);
  `recommendedTier`, `selectedTier` and `actualTier` are distinct, no economy is
  ever claimed while `applied=false`, and the full prompt is fingerprinted, never
  stored. Decisions are idempotent per `(session, prompt-fingerprint, policy)` and
  telemetry failure is fail-open (never blocks the prompt).

## [3.0.0] - 2026-06-16

Version 3.0 is the major consolidation release for ContextDevKit's intelligence
layer. It closes out the full **Capability Enforcement program** (PKG-05..07,
CDK-050..077), ships the **Economic & Autonomy Control Plane** (EACP, WF0018)
measurement plane across eight waves, and introduces **automatic per-session
model routing** (ADR-0094) in `shadow` mode — recommend-and-measure-only, never
blocking. The release also ships installer config-section auto-migration on
`--update` (ADR-0095) so existing projects gain new default config blocks without
losing user overrides.

### Added

- **Capability Enforcement PKG-05 — project-map & adaptive context (CDK-050..056,
  WF0026, ADR-0072).** Seven advisory, additive, zero-dep deliverables: configurable
  project-map `roots`/`excludes` with a two-tier exclude model (CDK-050), read-only
  coverage report (CDK-051), deterministic executable context manifest tool
  (CDK-052, boot-hook injection deferred), playbooks scoped by workflow phase/squad
  (CDK-053), zero-dep BM25 lexical retrieval ranking (CDK-054), rule fossilization
  ledger for deprecated rules (CDK-055), and multi-host selective context-load parity
  check across Claude/Codex/agy (CDK-056). All fail-open, UNREGISTERED.

- **Capability Enforcement PKG-06 — multi-host telemetry, compliance, benchmark &
  drift (CDK-060..068, WF0027, ADR-0072).** Nine advisory consumers: native-skill
  resolver (CDK-060), per-host compliance matrix (CDK-061), host telemetry adapter
  consuming EACP usage-events with zero writes under `economics/` (CDK-062),
  per-host financial cost + gross-cache-value report (CDK-063), capability ROI lens
  joining `attributionSkill` → registry aliases → cost (CDK-066), cache-churn health
  correlating wiring-drift with gross cache value (CDK-067), continuous
  tokens-per-completed-task ledger (CDK-065), and wiring-drift guard (CDK-068). All
  zero-dep, UNREGISTERED, fail-open.

- **Capability Enforcement PKG-07 — lineage graph + seven consumers (CDK-070..077,
  WF0029, ADR-0072).** CDK-070 provides the canonical lineage graph; CDK-071..077
  are seven read-only advisory consumers: public ADR projection (`lineage-public`),
  lineage calibration (`lineage-calibration`), executable business rules
  (`lineage-rules`), governance policy index (`policy-registry`), canonical evidence
  taxonomy (`evidence-taxonomy`), engineering scorecard (`engineering-scorecard`),
  and autonomy-readiness v2 (`autonomy-readiness-v2`). Each composes existing signals
  with no new state and zero writes to any source store. Completes the 42/50
  Capability Enforcement program. All UNREGISTERED, fail-open.

- **EACP Wave 1 — economic measurement core (WF0018, ADR-0078/0081).** Zero-hot-path
  `economics/` module cluster: canonical `UsageEvent` schema with bucket-close
  invariant and `toDelta` normalization preventing cumulative-summing errors
  (EACP-01); privacy/retention foundation with local-first, metadata-only defaults
  and opt-out consent gates (EACP-02); sanitized synthetic fixtures proving the
  normalization pipeline (EACP-03). Advisory/measurement-only.

- **EACP Wave 2 — pricing registry & cost semantics (WF0018, ADR-0079).** Versioned
  offline pricing registry with TTL-aware cache prices and confidence tiers
  (EACP-04); cost engine covering actual cost, no-cache cost, gross cache value
  (labeled "provider feature, NOT kit contribution"), routing savings quality-gated,
  and cost-per-QA-green-task (EACP-05); Token Report v2 with additive `financial`
  block — registry absent degrades to `skipped`, never fabricated (EACP-06).

- **EACP Wave 3 — session pressure & context-health advisories (WF0018, ADR-0077/0081).**
  Session-pressure score + band (`healthy|elevated|hot|critical`) with `splitRecommended`
  and actionable recommendations; absent signals degrade to `skipped`, never false
  `healthy` (EACP-07). Repeated-read and map-effectiveness analysis over metadata
  only, paths redacted (EACP-08). Both surfaced via additive Token Report v2 keys.

- **EACP Wave 4 — budgets/cost-guards & model-routing economics (WF0018, ADR-0045/0052/0077).**
  Budget engine evaluating 13 scopes into a `observe→warn→ask→downgrade→split→block`
  mode ladder; its only enforcement coupling is the existing `budgetExhausted` boolean
  the autonomy resolver already consumes (EACP-09). Model-routing economics with
  quality-gated `routingROI` — null + `unknown` confidence when QA signals are absent,
  never a fabricated number — and `fableAudit` documenting the manual-only Fable-5
  premium path (EACP-10). Surfaced via additive Token Report v2 keys.

- **EACP Wave 5 — quota snapshots & the Autonomy Multiplier (WF0018, ADR-0080/0081).**
  Append-only quota snapshots with confidence tiers; most hosts expose no quota API so
  capture is `inferred`, missing percentage degrades to `null` + `unknown` — never
  fabricated (EACP-11). Autonomy Multiplier: `(QA-green tasks per quota unit with
  kit) ÷ (baseline)`, Goodhart-guarded against raw action counts; targets 1.30×/1.50×/
  1.70× are stated as targets only, `claim` is hardcoded `null` until the benchmark
  proves it (EACP-12).

- **EACP Wave 6 — benchmark pilot harness (WF0018, ADR-0080, card #242).** A/B/C
  benchmark harness scaffold (`benchmark-design.mjs`, `benchmark-run.mjs`,
  `benchmark-report.mjs`) with deterministic mock provider, append-only JSONL, and
  independent-QA scoring with evaluator-≠-operator gate. Honesty-gated: the #176/
  CDK-003 baseline is unbuilt, so every real-measurement path returns `skipped`/
  `unknown` and `claim` is always `null` (ADR-0080 evidence tier). Mock runs are
  labeled and excluded from claims.

- **EACP Wave 7 — benchmark baseline harness + ADR-0080/0081 ratification (WF0018).**
  Baseline scaffold extending Wave 6; baseline data pending a real run — claim remains
  null.

- **EACP Wave 8 — routing economics wiring (WF0018).** Final EACP wave wiring
  routing economics into the measurement spine; all ADRs ratified.

- **Automatic model routing for standard sessions (ADR-0094).** Persistent,
  default-on routing posture — Haiku operates, Sonnet executes, Opus decides — active
  in every session (not just `/swarm`), with no re-prompting. New
  `tools/scripts/routing/` module cluster: deterministic `task-classifier.mjs`
  (complexity × risk → executor tier), `routing-decision.mjs` (runner-first
  over-orchestration guard + cost estimate), `routing-config.mjs` (session > project
  > default precedence), `routing-telemetry.mjs` (append-only decision ledger,
  kit-routing economics only — never the provider's cache savings). New `routing:`
  config block defaults to **`shadow`** mode (recommend + measure only;
  `canary`/`active` are deliberate, telemetry-gated promotions). `/token-report`
  gains an additive `routingTelemetry` surface. Fable-5 is never auto-selected.

- **Installer config-section auto-migration on `--update` (ADR-0095).** `npx
  contextdevkit --update` now additively merges new default config sections (e.g. the
  `routing:` block) into an existing project's saved `config.json`, preserving every
  user override; idempotent across runs. A version-aware "Updated vX → vY" notice is
  shown on each successful migration.

### Changed

- **Test suite coverage expanded.** New `selfcheck-routing.mjs` (42 checks, floor
  raised to 1480+) and `integration-test-routing.mjs` (20 acceptance scenarios);
  seven EACP selfcheck runners aggregated behind `selfcheck-eacp-all.mjs` to keep
  `selfcheck.mjs` under the line budget. `npm run ci` green at 63 suites + tech-debt
  0 RED / 375 files.

## [2.8.0] - 2026-06-15

The **Capability Enforcement program** (PKG-01..04, ADR-0072) lands as an
advisory, fail-open, *dormant* substrate, and the kit's own test harness is
re-architected for fast, agent-friendly execution (**WF0024**, ADR-0093). 39
commits since 2.7.0. Every enforcement unit is inert below L5, never blocks in
advisory mode, is fail-open, and ships UNREGISTERED — activation is a deliberate
separate step.

### Added

#### Capability Enforcement — substrate & gates (ADR-0072, advisory & dormant)
- **CDK-020** — canonical capability registry + pure deterministic resolver.
- **CDK-021** — task intake + deterministic execution contract (requiredBefore exploration / write / completion); hermetic intake tests.
- **CDK-022** — tamper-resistant, fingerprinted, metadata-only receipt store.
- **CDK-023** — advisory / guarded / strict enforcement modes + audited bypass (incl. the Grade-4 human floor); ships `advisory` by default.
- **CDK-030** — Mandatory Execution Protocol atop the boot context of all 3 hosts (CLAUDE / Codex `AGENTS` / Antigravity `INSTRUCTIONS`).
- **CDK-031** — `UserPromptSubmit` hook classifies each request and records its execution contract.
- **CDK-032 / 033** — unified `PreToolUse` gate (pure `evaluateAction()`) warns on workflow-before-write + exploration-budget gaps; advisory wrapper.
- **CDK-034 / 035** — indirect-write reconciliation (Bash / formatter / MCP) + persisted broad-search (explore-budget) counter.
- **CDK-040** — completion-evidence `Stop` gate (`completion-gate.mjs` + pure `evaluateCompletion()`): warns when receipts for `requiredBeforeCompletion` are missing; trusts receipts only (anti-theatre — prose never satisfies it); ledger round-trips `activeTask` / `taskCounter` / `completionWarnedAt`.
- **CDK-041** — subagent governance (`subagent-gate.mjs`: `Task` PreToolUse + `SubagentStop` records the declared touch-set, warns on out-of-scope / forbidden writes). v1 limit: spawn counter is last-spawn-wins per task.
- **CDK-042** — compaction continuity (`PreCompact` persists a metadata-only record; `SessionStart` re-surfaces still-outstanding contract obligations).
- **CDK-043** — read-only compliance status-line segment (satisfied / missing completion evidence for the active task).

#### Test execution architecture (WF0024 / ADR-0093) — the kit's own dev harness
- **TEA-001 / 002** — single `tools/test-suites.mjs` registry + `tools/run-suites.mjs`; layered `test:smoke | unit | selfcheck | integration:{core,installer,hosts,workflow,enforcement,ecosystem} | full`. `npm test` behavior **preserved** (full, serial, fail-fast).
- **TEA-003** — compact agent-friendly reporter (one line per suite; failures first; full logs to gitignored `runs/`) + `selfcheck` quiet-on-pass (a count line vs 660+ lines; `--verbose` restores; failures always full).
- **TEA-004** — conservative `test:impact` selector: changed-files × `touches[]` map; false-negative-averse (unmapped path / missing Project Map / config-core / test-infra ⇒ full); explains every include/exclude. Hermetic self-test via an injectable Project-Map signal.
- **TEA-005** — `ci:fast` (PR, single Node, docs/planning path-filtered) / `ci:full` (Node 18/20/22, mandatory before publish, never selector-gated) split; `npm run ci` = `ci:full`.
- **TEA-006** — per-run duration-history telemetry (p50/p95, selection reasons, OBSERVED/DERIVED-tagged), append-only + gitignored; feeds the P10/P11 reports.
- **TEA-007** — README test-scripts table, CONTRIBUTING test-workflow section, `instrucoes.md` pt-BR summary, and the CI `test-fast` / `test` job split.

#### Install & config hardening (PKG-01)
- **CDK-013** — per-section strict config validation that preserves unknown fields.
- **CDK-014** — explicit local-only vs tracked install modes (onboarding guidance, installer banner, `context-doctor` install-mode inspection).

### Fixed
- **CDK-010** — Agent Forge optional-`yaml` test stages the dependency into its fixture so both the yaml-present and yaml-absent branches are exercised.
- **CDK-011** — removed the `git.mjs` ↔ `exclude.mjs` ESM import cycle via a shared `git-paths.mjs`; moved the gitdir-retarget invariant there and wired the install-cycle test into CI.

### Changed
- **CDK-012** — disambiguated the product changelog from the installed-project changelog, guarded by a selfcheck.

## [2.7.0] - 2026-06-13

Governance the engine enforces — three systems that move enforcement from prompt
to code: the **ContextKit parity import** (8 features), the **auto-invoked
deliberation council**, and the **workflow journey gate** (ADR-0060 → ADR-0071).
README restructured around the new arc; four new Diátaxis explanation docs added
under `docs/explanation/`.

### Added — ContextKit parity import (8 features, ADR-0060 → ADR-0068)
- **Auto-format hook (F1, ADR-0061).** A PostToolUse `auto-format.mjs` runs the
  project's formatter/linter right after each Edit/Write at level ≥ 4 (advisory —
  it auto-fixes when a toolchain is present and always exits 0; "skipped" when
  none is found). Wired across all three hosts (Claude/Antigravity/Codex).
- **Multi-language pre-push quality gates (F2, ADR-0062).** `quality-gates.mjs`
  detects the stack (10 languages + generic) and runs lint/format/typecheck/
  build/test, scoped to the monorepo packages a push touches. Warn-first: silent
  below `minLevel`, warn in `minLevel..strictLevel`, blocks at `strictLevel`; a
  missing tool is skipped, never a false failure. Runs from `pre-push` after the
  conflict pre-check. Bypass: `CONTEXT_SKIP_QGATES=1`.
- **Hook-manager coexistence (F3, ADR-0063).** Install detects an existing hook
  manager (husky / simple-git-hooks / custom `core.hooksPath`) and suggests a
  non-destructive integration path instead of silently running side-by-side.
- **CI Squad action (F5, ADR-0064).** An opt-in GitHub Action turns a
  `squad-ready`-labelled issue into a DRAFT PR via the headless pipeline. Ships
  out of the default tree — installed only with `--ci-squad` (or the interactive
  prompt); needs the `ANTHROPIC_API_KEY` repo secret.
- **Standards promotion threshold (F7, ADR-0065).** `/distill-sessions` only
  proposes a new CLAUDE.md rule once a pattern has ≥3 evidenced occurrences;
  `/retro` deprecates superseded rules by strikethrough rather than deletion.
- **`/context-budget` skill + `@`-imports (F6, ADR-0066).** Read-only guidance on
  which context to load per task type (always / on-demand / skip); lightweight
  `@`-imports in `CLAUDE.md.tpl` keep the constitution lean.
- **Marker-based idempotent injection (F4, ADR-0067).** `marker-inject.mjs` owns a
  region between `<!-- ContextDevKit:start/end -->`, preserving the user's content
  around it and staying byte-idempotent across re-installs (the F8 enabler).
- **Multi-platform context bridges (F8, ADR-0068).** Opt-in (`bridges.enabled`)
  context bridges for six more tools — Cursor, GitHub Copilot, Gemini, Windsurf,
  Aider, Continue — written idempotently via marker-inject. These receive the
  CONTEXT layer ONLY; governance enforcement stays on the three native hosts.

### Added - workflow journey gate + numbering + branch-scoped guard (ADR-0071)
- **The `/workflow` journey is now enforced in the engine.** `advance` refuses to
  leave a phase whose deliverables are missing (empty PRD/SPEC, no ADR link, no
  card, no report) and lists the gaps; `--force` is the explicit override, and a
  new `workflow check <id>` reports readiness. Because it lives in the engine
  (`workflow-gate.mjs`), every CLI — Claude, Codex, Gemini — is held to the same bar.
- **Workflows are numbered like ADRs (`NNNN-slug`).** `createWorkflow` stamps the
  next number; `packDir` resolves a workflow by slug OR number; `renumberByStarted`
  migrates existing workflows by start date (oldest = 0001), idempotently, and
  `install.mjs` runs it on fresh + `--update` so installed projects renumber on update.
- **The L5 mutation guard is branch-scoped.** A pre-ship workflow now blocks edits
  only on its own branch (recorded at creation), so a parallel session/worktree no
  longer blocks unrelated work. Covered by `integration-test-workflow-governance.mjs`.

### Added - auto-invoked deliberation gates + tiered specialist council (ADR-0070)
- **Deliberation is now auto-invoked, not manual-only.** Two new autonomy areas
  (`feature-deliberation`, `decision-deliberation`) resolve to `debate` mode at
  grade ≥ 3, so starting a new feature (`/workflow` spec phase) or recording an
  architectural decision (`/new-adr`) auto-convenes a council. The ADR write itself
  stays `manual` at every grade — the deliberation precedes it, never authorizes it.
- **Dynamic specialist council.** New `deliberation-council.mjs` deterministically
  selects a relevant, named specialist roster (architect/security/ux-designer/…) by
  classifying the question into advisor lanes, scaling the count to
  `clamp(matchedLanes, council.min, council.max)` instead of a fixed 3 generic voices.
- **Tiered research swarm.** `/debate` now gathers evidence with cheap `fast`-tier
  (Haiku) scouts before the `reasoning`-tier (Opus) voices argue, with `powerful`-tier
  (Sonnet) verification for hard claims; voices and the synthesizer are never
  downgraded (ADR-0052). Models resolve through `model-policy.mjs`.
- **Broadened nudge + new config.** The `deliberation-nudge` hook also fires on a new
  ADR write; the `deliberations` config gains `council`, `autoInvoke`, and `research`
  blocks. Covered by `integration-test-deliberation.mjs` (20 checks) + selfcheck gates.

## [2.6.3] - 2026-06-13

### Fixed
- **Active squad posture gate:** Persist active squads in the session ledger,
  expose `/squad activate`, and scope `squad-audit` to the target path passed by
  `guard.mjs` so unrelated modified high-risk files no longer leak into the
  current edit decision.
- **Session-start robustness:** Split squad-context boot rendering into a small
  helper so the hook stays under the project file-size budget while preserving
  fail-silent behavior.

## [2.6.2] - 2026-06-13

### Fixed
- **Hooks:** Fixed a ReferenceError in the `session-start.mjs` hook where `resolve` was used without being imported from `node:path`.

## [2.6.1] - 2026-06-13

### Added - active agent squads integration
- **Active Agent Squads orchestration layer.** Introduced deterministic routing (`squads-registry.json` + `/squad route`), stack-aware playbook templates for all 8 squads under `workflows/playbooks/squads/`, and compliance/security auditing via `squad-audit.mjs` and `squad-director.mjs`.
- **Pre-commit L5 Gating.** Hooked the compliance auditor directly into the pre-commit `guard.mjs` gate to block unauthorized edits to L5 high-risk paths without posture activation.

### Changed
- **Docs refresh is now automatic for dogfood and client updates.** The Level 3
  pre-commit hook runs `docs-refresh.mjs` to regenerate `docs/README.md`, and
  `--update` now refreshes `contextkit/README.md` through the conflict-safe
  manifest path while preserving personalized client edits.

## [2.6.0] - 2026-06-13

### Added - stack-aware QA scaffolding
- **`scaffold-tests.mjs`** — a zero-dependency QA planner/scaffolder for
  Node/JavaScript, Python, Go, Rust, and PHP projects. `plan` reports detected
  stacks, runner/framework signals, and happy/edge/failure QA cases; `scaffold`
  is dry-run by default and creates only missing starter harness tests with
  explicit `--write`.
- **QA squad routing now starts from real stack context.** `/test-plan`,
  `/scaffold-tests`, and `qa-orchestrator` run the deterministic stack map before
  delegating to qa-unit, qa-integration, qa-fuzzer, qa-e2e, or qa-perf.
- **Coverage for the new QA tooling.** `integration-test-tooling-qa.mjs` installs
  a fixture with Node, Python, Go, Rust, and PHP manifests, verifies detection,
  proves dry-run-by-default behavior, and checks explicit scaffold writes.

### Changed
- README, architecture, levels, roadmap, and pt-BR usage docs now document the
  stack-aware QA flow and the v2.6 release posture.

## [2.5.0] - 2026-06-12

### Changed - default autonomy grade 3 + grade-4 informed consent (ADR-0058)
- **Default autonomy grade is now 3 (was 2).** Every fresh install lets the AI
  edit, test and move pipeline cards without asking out of the box; ADRs,
  pushes, secrets and high-risk paths still come to you (the floor is unchanged).
  Single-sourced in `defaults.mjs`, `schema.mjs` and the `resolveAutonomy`
  absent-grade fallback; onboarding now pre-selects grade 3.
- **Grade-4 eligibility bar drops the `rollback < 10%` criterion.** A `qa` bounce
  is the QA gate working, not an autonomy failure — counting it penalised honest
  QA use. The bar keeps five objective criteria (≥30 transitions · ≥20 sessions ·
  zero wiring-drift · self-coverage green · attribution present).
- **Grade-4 activation is now explicit informed consent.** `/autonomy 4` shows a
  disclaimer spelling out exactly what grade 4 grants and what stays human, then
  the human signs (`--confirm` is the [y] signature; omitting it is [n]/cancel).
- **No change to swarm or routing.** ADR-0052 model routing is grade-blind;
  ADR-0051 swarm already runs at grade 3 with one human OK per run (kept).

## [2.4.1] - 2026-06-12

### Fixed - workflow report defensiveness (ADR-0057 remediation)
- **No more false-pass on missing git.** `workflow report` now probes
  `git rev-parse --is-inside-work-tree` and writes an explicit
  `SKIPPED: git unavailable / not a repository` Diff summary instead of the old
  "No working tree diff." (which read a missing-git failure as a clean pass —
  violating ADR-0057 decision #7 and the "validators throw, not warn" rule).
- **Report concern split out.** Git + report logic moved from `workflow-pack.mjs`
  (was at the 280-line ceiling) into a new `workflow-report.mjs`; `workflow.mjs`
  stays the thin CLI wrapper. Both files now well under budget.
- **Defensive guards.** `git` spawns carry a timeout; a same-day report refuses
  to overwrite a filled `## Verification` without `--force`; a malformed
  `index.md`/breadcrumb is an explicit refusal naming the path (and a
  `skipped (malformed)` line in `status`/`list`), never silently treated as
  absent; frontmatter parsing tolerates CRLF.

### Fixed - Codex converter fidelity (ADR-0056 remediation)
- **Skill descriptions are adapted.** The Claude→Codex converter now runs skill
  `description` through `adaptContent` (was emitting raw "scoped CLAUDE.md" /
  "Claude Code token usage" text into Codex skills).
- **Correct skill path rewrite.** `.claude/commands/<x>.md` now rewrites to
  `.agents/skills/source-command-<x>/SKILL.md` (the real install layout) instead
  of a dead flat `.agents/skills/<x>.md` reference.
- **CRLF + host skip-list.** `stripFrontmatter` tolerates CRLF; a narrow,
  documented skip-list (`claude-md`, `token-report`, `fable`) keeps host-
  inappropriate skills out of the Codex surface (74 emitted, 3 skipped).
- **Property-based selfcheck.** `selfcheck-codex.mjs` now asserts output
  PROPERTIES (no Claude-only string in any description, no dead skill paths,
  skip-list honored, adversarial CRLF/quote/backslash/no-frontmatter inputs) —
  not generator-echo parity, which could never catch a conversion bug.

### Fixed - swarm planner reads explicit touch-sets (ADR-0051)
- **`listTasks` surfaces `paths:`.** The swarm planner reads `task.paths` to honor
  an explicit `paths:` frontmatter touch-set, but `listTasks` dropped the field —
  leaving that branch dead via the CLI. Added the passthrough so a card can pin
  its own disjoint touch-set for `/swarm`.

### Changed
- **Test split (RED-zone fix).** `integration-test-tooling-pipeline.mjs` (328
  lines, over the 308 hard block) split by responsibility — the ADR-0015
  execution-substrate suite moves to a new `integration-test-pipeline-substrate.mjs`
  sibling; both files are back under budget and `npm run ci` is green again.

## [2.4.0] - 2026-06-12

### Added - cost-tiered model routing Phase 2 (ADR-0052)
- **Deterministic model resolver.** `contextkit/tools/scripts/model-policy.mjs`
  turns the ADR-0052 tier table into an executable decision: `resolve --agent`
  (the `/ship` path) and `tier` (the `/swarm` path, which plans by `tierHint`).
  Order is contractual — task-class (`execute` → cheap) → QA escalation
  (`--qa-failures 2`, one tier up, capped at reasoning) → budget de-escalation
  (`--budget-exhausted`, one tier down) → **floor last** (security / code-security
  / infra-security / privacy-lgpd never below `powerful`). Price enrichment reuses
  the agent-forge matrix via an optional dynamic import, degrading to "no price"
  when the matrix is absent (L<4 / non-Claude host) rather than failing.
- **Policy materialized + drift-locked.** `contextkit/policy/routing-policy.json`
  mirrors the ADR table; `tools/selfcheck-model-policy.mjs` asserts it agrees,
  agent-by-agent, with the host-enforced `model:` frontmatter across all 34
  agents — a tier can no longer drift between the ADR, the policy and the agent
  files without a red gate.
- **Per-model attribution (`byModel`).** `token-report`/`token-attribution` now
  split spend by `message.model` ("Spend by model"), and the swarm manifest
  records the resolved alias per workstream with a `models:` breakdown in the run
  report — a fan-out's true tier mix is auditable, not assumed.
- **Resolve, don't eyeball.** `/ship` and `/swarm` now call `model-policy.mjs`
  before each dispatch and pass the returned alias to the Agent tool; omitting
  `model` silently inherits the premium session model — the costly default.

## [2.3.0] - 2026-06-12

### Added - workflow spec packs and completion reports (ADR-0057)
- **Workflow spec packs.** `/workflow` now creates
  `contextkit/memory/workflows/<slug>/` with `index.md`, `prd.md`, `spec.md`,
  ADR/task indexes, durable workflow memory, and dated reports. Legacy
  `memory/workflows/<slug>.md` breadcrumbs remain readable for status and
  advance.
- **Workflow reports + DevPipeline links.** `workflow.mjs report <slug>
  [--task <id>]` records branch, commit, `git diff --stat`, `--numstat`, touched
  files including untracked files, verification, and notes without duplicating
  full patches. Pipeline cards can now carry `workflow`, `spec`, `implemented`,
  and `concluded` metadata; moving to `testing` stamps `implemented`, while QA
  sign-off remains the governed path into `conclusion`.
- **Docs and coverage.** `/workflow`, `/pipeline`, `/dev-start`, `/log-session`,
  README/instrucoes, installer seeds, selfchecks, and integration tests were
  updated for the lifecycle `intake -> prd -> spec -> adr -> roadmap(if feature)
  -> pipeline -> ship -> testing -> conclusion`.

### Added - Codex native host parity
- **Codex joins Claude Code and Antigravity as a native host.** The installer now
  writes `AGENTS.md`, `.codex/hooks.json`, `.codex/agents/*.toml`, generated
  `source-command-*` skills under `.agents/skills/`, and a `cdx.mjs` runner
  mirroring `ctx.mjs`. Dogfood excludes now cover `.codex/`, `AGENTS.md`, and
  `cdx.mjs`, while doctor/context-level/selfcheck/integration tests guard the
  new host surface.
- **Codex now carries the full session discipline, not just generated assets.**
  Codex hooks identify themselves with `--host codex`, SessionStart pins a stable
  Codex ledger when no `session_id` is available, `AGENTS.md` includes the same
  workflow/constitution as the other hosts, and the docs state that Codex,
  Claude Code, and Antigravity cooperate over shared claims, ADRs, pipeline
  cards, sessions, and changelog.

### Added — `/fable`, the manual premium tier (ADR-0052 Phase 2)
- **`/fable <task>`** runs ONE task on **Claude Fable 5** — the premium model the
  automatic tier ladder never reaches (ADR-0052 caps auto-escalation at `opus`;
  Fable is the manual hatch *above* the ceiling). **Manual-only by construction:**
  no agent may declare `model: fable` (the selfcheck `VALID_MODEL_ALIASES` forbids
  it), and nothing auto-routes there — Fable runs only on an explicit `/fable`.
  It dispatches to a **subagent** with `model: fable` (premium runs in the
  subagent, never the main loop — the cache-safe ADR-0052 invariant), echoes the
  cost once, scopes to the one task, then returns to the normal tiers; the autonomy
  floor (ADR-0042) is unchanged (more capability, not more consent). Antigravity
  skill mirror generated; covered by selfcheck (command present + the manual-only /
  subagent-dispatch / cache-safe contract).

## [2.2.0] - 2026-06-12

### Added — deterministic QA sign-off + the grade-4 coverage gap closed (ADR-0055)
- **`pipeline.mjs qa-approve <id> --evidence "…"`** — the QA half of ADR-0043's
  sign-off doctrine finally has a verb: the ONLY testing→conclusion path besides
  the human `move`. Refuses without evidence, outside `testing`, or when the
  card's acceptance criteria aren't ≥1 checked / 0 unchecked; records the
  evidence on the card (`## QA Sign-off`) and in the event log (actor `qa`,
  `endedAt` stamped). `auto` stays fenced from `conclusion` at every grade.
- **`/pipetest [ids|--all]`** — run the project suite; green ⇒ `qa-approve`
  every complete testing card with the run summary as evidence; red ⇒ report,
  bouncing (`qa-reject`) only attributable failures — a global red never
  mass-bounces the lane. Swarm runs never call it; it's the human's closing
  move after `/swarm review`.
- **`integration-test-hooks.mjs`** — rule 2 as a test: every module under
  `runtime/hooks/` is executed twice (benign payload + garbage stdin) and must
  exit 0 in a bare project. Closes the grade-4 self-coverage gap (the bar's
  harness now sees every hook entrypoint exercised at its template path).

### Added — swarm coordinator v1 implemented (ADR-0051 accepted, task 123)
- **ADR-0051 flipped Proposed → Accepted** and shipped end-to-end: `/swarm`
  skill (plan·run·review·clean) + pure `swarm-plan.mjs` planner (WSJF rank;
  touch-set derivation card-`paths:` → simulate receipt → title inference;
  refusals for no-touch-set / secret floor / un-receipted l5 paths; greedy
  disjoint partition; hard cap 5 above config) + `swarm-state.mjs` manifest
  (`.claude/.swarm/<runId>.json`, atomic writes, append-only per-workstream
  history, stale eviction preserving worktrees, budget-park path) +
  `worktree-new.mjs --swarm <runId> <taskId>` mode (branch
  `swarm/<runId>/<taskId>`).
- **`swarm-dispatch` consent area** in `resolveAutonomy`
  (`[manual,manual,suggest,auto]`, budget-downgrade aware) and the optional
  `by: {runId, workstream, agent}` attribution field on state.json events
  (unknown keys dropped; plain events untouched). `swarm.*` config block
  (maxWorkstreams/maxWavesPerRun/tokenBudgetPerRun/staleMinutes),
  zod-modeled.
- **P0 validation run executed first** (the ADR's precondition): tasks 141+143
  fixed in parallel worktrees on sonnet/haiku tiers (ADR-0052), 52–61K subagent
  tokens each, 0/2 cross-workstream conflicts; branches parked at testing for
  human merge. Its load-bearing finding — rule 3 makes every workstream spill
  into shared TEST shards — is encoded in the planner as `TEST_HOME_RULES`
  touch-set expansion (test-asserted).
- **23-check `integration-test-swarm.mjs`** added to the npm test chain;
  selfcheck inventories the new scripts + skill; agy mirrors regenerated
  (the skill is documented; agy still runs its session model — the ADR-0052
  host gap stands).

### Added — dogfood-by-default install + conflict-safe 3-way update (ADR-0054, PR #77)
- **Dogfood by default.** The installer writes a managed BEGIN/END block to
  `<common-git-dir>/info/exclude` covering every generated artifact
  (`contextkit/`, `.claude/`, `CLAUDE.md`, `docs/CHANGELOG.md`, the Antigravity
  host, scaffolded `.github` files): fresh installs leave ZERO tracked kit files
  and `--update` stops flooding the target project's history. `info/exclude`
  only affects untracked paths, so it is unconditionally safe for projects that
  already commit the kit (they get opt-in `git rm -r --cached` guidance; the
  index is never touched — rule 8). Opt out with `--tracked`.
- **Conflict-safe update.** `contextkit/.install-manifest.json` (sha256 baseline
  of every kit-written file) drives a 3-way merge on `--update`: personalized
  files are kept silently when the kit didn't move; a real divergence prompts on
  a TTY ([b]oth/[r]eplace/[k]eep) and defaults to "both" headless, stashing the
  kit version under `contextkit/.updates/` — no side is ever lost. Manifest-less
  legacy installs refuse to clobber; user-created agents/commands are untouched.
- New sibling suite `tools/integration-test-update-safety.mjs` (21 checks) wired
  into `npm test`.

### Added — encoding + config-rot prevention guards (cards 144–145, PR #78)
- **Tree-wide mojibake gate** — `tools/selfcheck-encoding.mjs` scans
  `templates/`, `docs/`, `tools/` and the root docs for UTF-8-read-as-cp1252
  fingerprints (the PowerShell 5.1 `Get/Set-Content` corruption class); patterns
  are ASCII-escaped so the gate can never flag itself.
- **Doctor config path-rot probe** — `ledger.registration`, `l5.highRiskPaths`
  and `qa.criticalPaths` entries that no longer exist on disk are flagged
  (registration rot is CRITICAL — the drift nudge goes blind; gate/QA ghosts are
  advisory).

## [2.1.0] - 2026-06-11

### Added — swarm coordinator contracts locked (ADR-0051, Proposed)
- **ADR-0051** hardens the swarm feasibility study into contracts: `/swarm`
  skill + pure `swarm-plan.mjs` planner + `swarm-state.mjs` manifest,
  `swarm-dispatch` consent area (`['manual','manual','suggest','auto']`),
  optional `by: {runId, workstream, agent}` on state.json events,
  worktree-per-workstream isolation with workstream seniority, and the
  defining safety property: **a swarm run finishes at `testing`, never `done`**
  — `/swarm review` batches the human approvals. v1 is grade-3; grade-4 needs
  the ADR-0045 bar **plus ≥3 clean grade-3 runs**. Implementation = task 123
  (P0 zero-code validation run first).

### Added — cost-tiered model routing, Phase 1 (ADR-0052)
- **Every kit agent now declares a `model:` cost tier** in its Claude frontmatter
  (`haiku|sonnet|opus|inherit` — aliases only, never versioned IDs): expensive
  models think (architect, security squad, code-reviewer, agent-architect on
  `opus`), cheap models execute (qa-unit, qa-integration, packager,
  context-keeper on `haiku`), dispatchers inherit the session model. Claude Code
  enforces it natively on every Task dispatch; cache-safe by construction (the
  main loop never switches models — only spawned subagents are tiered).
- **Dispatch-time tier classification** in `/ship`, `/advise`, `/debate` and
  `/scaffold-tests`: think vs execute rules, floors (security work never below
  `sonnet`), one-step QA-failure escalation, budget-exhausted de-escalation
  (ADR-0044 §3 semantics: downgrade, never block).
- **Selfcheck guard**: every agent template must carry a valid model alias —
  a missing line or a versioned ID fails the build (rule 3).
- **Feasibility studies**: `docs/explanation/model-tier-routing-study.md`
  (3-layer architecture, savings arithmetic, host-gap statement, Phase 2/3
  deferrals) and `docs/explanation/swarm-feasibility-study.md` (swarm
  coordinator on the completed autonomy substrate, ADR-0051 reserved).

### Changed
- **Per-task `state.json` moved under `pipeline/state/` (ADR-0053).** The runtime
  substrate (ADR-0015 §C / ADR-0043) no longer scatters numbered dirs across the
  pipeline root beside the board stages — it lives in its own
  `contextkit/pipeline/state/<id>/state.json`, and the installer now **gitignores**
  `contextkit/pipeline/state/` (it is churning in-flight state, not the shared
  board). `listStates` reads only the substrate (skipping the stage dirs), fixing
  both the clutter and the commit/merge-conflict risk. Fully backward-compatible:
  `readState` falls back to the legacy flat path and `migrateStateLayout` (run on
  every `pipeline.mjs sync`) self-heals existing projects on the next command —
  idempotent, never clobbers. Covered by selfcheck + integration (start writes
  under `state/`; a legacy dir migrates on sync).
- **capability-matrix refreshed to 2026-06 reality (authorized by ADR-0052 per
  ADR-0012 §6):** `claude-opus-4-7` ($15/$75, stale) → `claude-opus-4-8`
  ($5/$25, 1M ctx); Haiku 4.5 corrected to $1/$5; Sonnet 4.6 context 1M;
  **Claude Fable 5 added** (premium, $10/$50, 1M ctx, thinking-always-on note);
  decision-rules + manifest seed follow the ID rename. Matrix v0.2.0,
  `updated: 2026-06-11`.
- **Antigravity parity doc** records the honest host gap: tier routing is Claude
  Code only — agy exposes no per-agent/per-dispatch model API; the kit refuses
  to fake a Gemini mapping it cannot enforce (rule 8).

## [2.0.0] - 2026-06-11

### Added — F4 grade-4 control plane (ADR-0045, task 116 — completes the autonomy package F0–F4)
- **Deterministic eligibility bar.** `/autonomy 4` now consults
  `autonomy-eligibility.mjs` and **refuses naming the failing criterion** unless
  ALL hold: ≥ 30 recorded transitions (genuine `from ≠ to` events) · ≥ 20 sessions ·
  rollback rate < 10% (`qa`/`evict` events) · zero wiring-drift incidents · a fresh
  self-coverage marker · attribution (D3) present. Unmeasurable ⇒ refuse, never pass
  (rule 8): no events ⇒ rollback rate 1.0, no marker ⇒ coverage/attribution fail.
- **Gated, session-default setter.** Grade 4 is `experimental`: with no flags it is
  **session-scoped** (auto-expiring), and persisting requires `--persist --confirm`
  after the consequence text is shown. No path persists grade 4 silently; the
  grade-change floor (always human) is untouched.
- **Self-coverage readiness harness.** New `autonomy-readiness.mjs` runs `npm test`
  under `NODE_V8_COVERAGE` (every `runtime/hooks/**` + `runtime/config/**` module must
  be exercised) and `token-report` for attribution, stamping the marker the bar reads.
  It never flips a criterion true on its own failure.
- **Hardened quorum + kill-switch (`/ship`).** At grade 4 a ◆ checkpoint cleared by
  `/debate` requires: blind voices · **≥ 1 deterministic voice = the exit codes of
  `npm test` + selfcheck + `/deps-audit`** (not an LLM summary) · a security **Critical
  is a veto, not a vote** · `unresolved` → human · the deliberation id stamped into the
  `state.json` event. The resolver is re-consulted at the **start of every step** so any
  user message or `/autonomy 1` yields/cancels at the next boundary; push stays
  branch-only (merge to default is always human).
- **Security-review hardenings (pre-merge).** A `security` pass flagged the bar's
  evidence as agent-writable; fixed: `memory/autonomy/**` is now a **floored path**
  (editing the eligibility evidence is gate-self-edit class, so an agent cannot forge
  its own bar), the readiness marker must be **fresh (≤ 14 days)** to count, the
  resolver's grade-4 contradiction guard **fails closed** (`deliberations.active !==
  true` ⇒ throw, absent is not assumed-on), and only genuine stage transitions count.
- Covered by selfcheck (eligibility thresholds, refuse-by-default, the floored
  evidence cell, fail-closed, freshness) + integration (`autonomy 4` refuses on an
  unmet bar, passes session-scoped when seeded, `--persist` needs `--confirm`).

### Added — deferred-items consolidation, bucket A (ADR-0047, tasks 128–132)
- **PR line in `/git status`** (task 128). `git.mjs` surfaces the branch's open
  PR in one line, reusing `sync-check.mjs`'s PR facts (now exported behind an
  entrypoint guard — importing is side-effect-free). An unusable `gh` or a
  non-GitHub provider reports **skipped, never a false "none"** (rule 8).
- **`/advise --after --since <ref>`** (task 129). Pins the changed-surface scan
  to `git diff --name-only <ref>...HEAD` so long-lived branches stop
  over-reading; an unknown ref is a hard stop, never a silent full-branch
  fallback.
- **`pipeline.mjs board --digest`** (task 130). Token-light lane summary
  (active lanes in full, backlog capped at 8, titles clipped) on ADR-0027's
  deterministic-extraction posture; `/pipeline show` and `/plan-week` now
  reason from the digest instead of reading N task files.
- **Opt-in scheduled alert-sync** (task 131). The scaffolded `security.yml`
  ships a commented `schedule:` cron trigger + an `alert-sync` job (gated on
  `event_name == 'schedule'`, advisory) running the existing `gh-alerts.mjs` —
  inert until the project opts in; runs in the project's CI, never the kit hot
  path (rule 1).
- **Registry-backed staleness in `/deps-audit`** (task 132). `--registry` (the
  audit's only network call, opt-in by flag) flags a deprecated `latest` and
  packages with 2+ years without a publish via abbreviated npm-registry
  metadata; an unreachable registry is a `registry-skipped` finding — a skip,
  never a pass (rule 8). Env-overridable URL keeps the test suite offline.

### Fixed — pre-release audit, low-severity sweep (tasks 133–138, zeroed before the 2.0)
- **`matchSecret` widened to common credentials (133).** SSH private keys
  (`id_rsa`/`id_ed25519`/`id_dsa`/`id_ecdsa`), `.git-credentials`, `.dockercfg`, and
  cert/PGP extensions (`.crt/.cer/.cert/.der/.asc/.gpg`) now hit the secrets floor —
  so no consent grade auto-touches them. (`id_rsa.pub` stays a non-hit.)
- **Grade-blind selfcheck now catches resolver-mediated reads (134).** The invariant
  check flagged only the raw `config.autonomy` key; it now also flags a hook that
  branches on `resolveAutonomy(...).grade` / `readAutonomyOverride`, with the
  display-only `autonomy-signals.mjs` as an explicit allowlist (the audited surface,
  not a regex blind spot).
- **`[Unreleased]` boot digest miscounted nested sub-bullets (135).** The tally now
  anchors to column 0, so an indented sub-bullet is detail of its entry, not a new one.
- **`pipeline-board` digest crashed on a titleless card (136).** It now coerces a
  missing title to `(untitled)` — the digest is a never-crash summary (ADR-0027).
- **LP lawyer disclaimer is now non-removable by ENFORCEMENT (137).** `lp-build
  --check` refuses a `dist/` whose legal pages dropped the disclaimer (was convention
  only). [ADR-0050]
- **Readiness-marker threat model documented (138).** `autonomy-eligibility.mjs` now
  records that the marker is trust-on-write and why that's acceptable (grade-change is
  human-floored, `memory/autonomy/**` is a floored path, 14-day freshness, `--confirm`)
  and why an HMAC was considered and deferred. [ADR-0045]

### Fixed — pre-release audit of the ADR-0041…0050 package (4-way deep analysis + security review)
- **`auto-transition` could bypass the `qa-reject` monopoly (ADR-0043 §3).**
  `autoTransition` only fenced `conclusion`; it now refuses any move that isn't a
  legal forward step (`backlog→working→testing`). A `testing→working` bounce — which
  must carry feedback — is once again `qa-reject`-only, and backward/skip jumps are
  refused (use the human `move`). [HIGH]
- **Stale eviction left no event — the `evict` actor was dead (ADR-0043 §5).**
  `workspace-sync` moved a stale task `working→backlog` via `writeState` but never
  `appendEvent`, so the transition was invisible to the log and the grade-4 rollback
  metric (ADR-0045) under-counted abandonment. Eviction now appends an
  `actor:'evict'` event. [HIGH]
- **`/project-map` manifest churned on every commit (ADR-0046 §1 / ADR-0039).** The
  manifest carried a wall-clock `generatedAt`, so the pre-commit auto-refresh
  re-staged it on every source commit (git noise + merge-conflict surface). Dropped
  the field — the deterministic `signature` is the map's identity; the manifest is
  now byte-stable on a no-op regenerate.
- **`deps-audit` npm-v6 advisory path was dead** — a `data` → `parsed`
  ReferenceError inside `parseNpmAudit` was silently swallowed by the caller
  and downgraded real CVE output to `audit-skipped` on npm v6. (Found while
  implementing task 132.)

### Added — ADR-0044 D3 budget gate, now actually wired
- **Grade-4 budget downgrade (ADR-0044 D3).** The decision was documented but
  absent — the resolver never consulted the token budget despite the grade-4
  consequence text claiming "budget-gated." `resolveAutonomy` now honours
  `context.budgetExhausted`: at grade 4 an exhausted `tokens.budgetPerSession`
  returns grade-2 behaviour (`suggest`, `reason: 'budget-exhausted'`) — it
  **downgrades to consent, never blocks an edit** (rule 2); the floor still wins,
  and lower grades stay budget-warn-only. `/ship` passes the budget state when it
  re-consults the resolver per step. Per-command attribution's doc was also
  calibrated: `attributionSkill` is host-populated and legitimately sparse, so the
  "Top commands" lens is best-effort (the per-agent fan-out split is the guaranteed,
  budget-gate input).

### Added
- **`/project-map` becomes an active architectural-fitness substrate (ADR-0046).**
  The structural map stops being a passive doc: (1) **self-refreshing** — the
  pre-commit hook regenerates + `git add`s the map when source is staged (grade-blind
  derived doc, never blocks); (2) **architectural fitness functions** — an opt-in
  `memory/project-map/rules.json` declares path-prefix layering rules
  (`forbidden: from→to`) and sensitive-import rules; `project-map --check --strict`
  exits 1 on a violation (a new `project-map` job in `quality.yml` is the gate). The
  sensitive set is **augmented from the ADR-0041 secrets path-class** (`matchSecret`,
  reused not reinvented) — the floor gates *editing* a secret, this adds the *edge*
  view (who now imports it); (3) **structural insights** — dependency cycles, orphan
  and oversized modules, computed at generate-time into `manifest.json`, surfaced at
  boot and in an "Architecture health" section of `00-index.md`; (4) `--check` prints
  a token-cheap **delta** (+/− modules/edges); (5) `--for <path>` returns a focused
  **subgraph** so the ADR-0044 memory retriever can query the map. New
  `project-map-insights.mjs` + `project-map-rules.mjs` (pure siblings); `projectMap:
  { autoRefresh, enforce }` config block. Covered by selfcheck + integration
  (cycle, violation→exit-1, opt-in-off, `--for`).

### Added — F3 fan-out economy (ADR-0044, tasks 113–115)
- **D3 · per-agent / per-command token attribution.** `/token-report` now splits
  spend by **agent** (main loop vs subagent **fan-out**, from the transcript's
  `isSidechain`) and by **command** (from `attributionSkill`), in the human view and
  under `--json` — the honest input the grade-4 budget gate (ADR-0045) consumes and
  the proof-of-savings instrument. New pure `token-attribution.mjs`. **Deviation
  noted:** the ADR sketched a per-run ledger line written by `/debate`/`/ship`; the
  transcript already carries `attributionSkill` + `isSidechain`, so attribution is
  derived from records already parsed — strictly more accurate (a command cannot see
  its own final token count mid-run) and with **no new persisted artifact**, which
  structurally forecloses the ADR's named "memory-inflation" failure mode.
- **D1 · bounded subagent context pack.** `context-pack.mjs --for-subagent
  --objective "…"` emits a ≤~120-line pack (immutable-rules digest · last-session
  line · `[Unreleased]` digest · open claims · objective-targeted memory) carrying
  the standing rule *"do not re-read boot context; read at most 1 file to verify a
  claim."* `/debate`, `/advise` and `/ship` (and the antigravity mirrors) now embed
  it in every fan-out Task prompt — the pattern the 06 master round validated.
- **D5 · deterministic memory retriever.** New `memory-retrieve.mjs` selects the
  memory **already extracted** by the digest layer (glossary rows · ADR catalog
  lines scored by title overlap · the latest-session one-liner · the project-map
  `--for` subgraph) for an objective — no generation, no placeholders, hard-capped
  at 40 lines, idempotent (same objective + repo state ⇒ byte-identical).
- **D2 · compact `[Unreleased]` boot digest.** The SessionStart banner replaces the
  raw section with a count-by-type tally (`Added 2 · Fixed 1 …`) + the most recent
  entries via the `md-extract` seam (`digestUnreleased`), falling back to the raw
  truncated section on any parse miss (same contract as the ADR-0027 boot digest).
- Covered by selfcheck source-cases + a dedicated `integration-test-token-economy.mjs`
  suite (attribution split, retriever cap/idempotency/placeholder-guard, bounded
  subagent pack, the `[Unreleased]` digest + its raw fallback).

### Changed — Antigravity host goes native (ADR-0048 + ADR-0049)
- **Host assets moved `.antigravity/` → `.agents/` (ADR-0048).** The agy binary
  resolves workspace skills strictly from `.agents/`, so the kit-invented
  `.antigravity/` was never read — typing `/` in the agy TUI showed *"No
  matching results"*. The installer now targets `.agents/` (single-sourced as
  `ANTIGRAVITY_DIR` in `paths.mjs`, rule 4), auto-removes the kit-owned legacy
  tree on update, purges both on `--uninstall --purge`, and ships a
  host-coexistence README (`.claude/` = Claude Code, `.agents/` = agy; neither
  reads the other). `/context-doctor` flags a leftover legacy tree as
  migratable. Slash commands now autocomplete natively in the agy TUI.

### Added — native agy lifecycle hooks (ADR-0049)
- **`.agents/hooks.json` composer.** New
  `runtime/config/agent-hooks-compose.mjs` (`composeAgentHooks` /
  `stripAgentHooks`) — the agy twin of `settings-compose.mjs`, owning a single
  `contextdevkit` group and preserving user groups. Level rules mirror the
  Claude wiring 1:1 (L1 SessionStart · L2 +PostToolUse +Stop · L3
  +concurrency-guard · L5 +simulate-gate +deliberation-nudge); wired by the
  installer, re-wired by `/context-level`, stripped by `--uninstall`.
- **Host adapter — one seam, no forked hooks.** New
  `runtime/hooks/host-adapter.mjs` normalizes both wire formats (Claude
  `tool_input.file_path` ⇄ agy `toolCall.args.TargetFile`), emits the
  host-correct blocking key (`block` ⇄ `deny`), rides advisories on an explicit
  `decision: allow` under agy, and resolves the agy session id from the
  `.agy-active.json` marker `session-manager start` now mints (one ledger per
  agy session instead of one per hook event). `track-edits`,
  `concurrency-guard`, `simulate-gate` and `deliberation-nudge` swapped their
  private extractors for the adapter — the L5 gate, edit ledger, cross-claim
  warnings and the deliberation nudge now fire automatically in agy.
- **Tests.** Selfcheck: composer level table, per-tool matchers, idempotence +
  user-group preservation, payload-normalization table, ADR-0048/0049 source
  cases (check floor 660 → 711+ executed). Integration: `.agents/` install +
  no-legacy-tree + coexistence README cells (tooling suite); hooks.json wiring,
  agy session minting, `track-edits --host agy` ledgering and the
  `simulate-gate --host agy` deny verdict (antigravity suite).

### Added — conversion squad + deterministic LP scaffold (ADR-0050)
- **`lp-scaffold.mjs` + `lp-build.mjs` + `starters/landing/`.** The landing
  page stops being AI-hand-written (~30–60K tokens) and becomes deterministic:
  componentized source (one fold per file, `content/copy.json` as the AI's
  only editing surface) assembled into one atomic indexable `dist/` —
  `--check` refuses leftover `{{tokens}}`/`[PREENCHA]` sentinels and runs
  `seo-audit` + `aiso-audit` against the output (born green, asserted in CI).
  Resolves ADR-0023's deferred starter without inventing domain content
  (structure + placeholders only, rule 9).
- **LGPD by default.** Cookie-consent component ships ON (Consent Mode
  default-denied, < 2 KB, accessible); GTM included directly but **ID-less**
  (inert until configured, loaded only after consent); Meta/TikTok/LinkedIn
  pixels ship as commented, consent-wrapped **models** (`tracking-models.js`,
  never in dist); privacy policy + terms of use generated as drafts from
  `content/legal.json` with a non-removable lawyer-review disclaimer; lead
  forms decoupled via webhook (n8n/Make) with loading/success/error states.
- **Two design-team agents.** `conversion-strategist` (interview-first
  strategy — niche/pain/single-CTA/sophistication — neurodesign techniques
  with verification steps, benefit copy; refuses invented social proof) and
  `tracking-integrator` (GTM/pixels/webhooks, consent-first by contract,
  pairs with `privacy-lgpd`). Lean agents + tier-2 briefings under
  `squads/design-team/`.
- **Playbook + skill v2.** `landing-page.md` gains the fold-anatomy menu
  (persuasive function per fold), the neurodesign verify-don't-vibe table,
  the legal & consent defaults and the deterministic path; `/landing-page`
  now runs interview → indexability → scaffold → fill → `--check` gates.
  Refused, on record: fixed Next/React stack mandate, a parallel 150-line
  cap, 7-fold minimum, example social proof, auto-wired pixels.
- **Tests.** New sibling suite `tools/integration-test-lp.mjs` (25 checks:
  write-if-missing, refuse-on-placeholder, consent/GTM/pixel contract,
  disclaimer presence, copy round-trip, fold selection) + selfcheck inventory
  for both scripts, both agents, briefings and the starter tree.

## [1.17.0] - 2026-06-10

### Added — backlog-zero batch (tickets 084–096)
- **`agy guard <path>` — explicit L5 pre-edit checkpoint (095).** Governance
  parity for the hook-less Antigravity host: exit 0 = allowed, exit 1 = high-risk
  path with no covering `/simulate-impact` record (refuse-by-default, including
  on errors). Shares `matchHighRisk` with the PreToolUse hook via
  `path-classification.mjs`; documented in `INSTRUCTIONS.md.tpl` and the
  session-start rules.
- **`help <command>` + did-you-mean in `ctx.mjs` (096).** Unknown commands print
  the closest 3 matches instead of dumping the six-category menu; `help <cmd>`
  prints a single-command card. The categorised registry moved to
  `runtime/antigravity/ctx-menu.mjs` (graceful fallback when the engine is absent).
- **Antigravity-aware `/context-doctor` (086).** Verifies `ctx.mjs`, the
  `ctx`/`agy` package.json shortcuts, the four `.antigravity` asset trees,
  `INSTRUCTIONS.md`, and leftover `{{TOKEN}}` placeholders — advisory-only, a
  Claude-only project never fails doctor over the optional host.
- **Antigravity parity drift-guard in selfcheck (084).** `templates/antigravity`
  must track `templates/claude` 1:1 (both directions, by relative path) or
  selfcheck fails pointing at `npm run build:antigravity`.
- **New integration suite `tools/integration-test-antigravity.mjs`** covering the
  `ctx.mjs` dispatch contract, the guard checkpoint, the shared drift predicate
  and the doctor checks; joined the `npm test` chain.

### Fixed
- **`ctx.mjs` silent prefix dispatch (089).** `agy tech` no longer guesses
  `tech-debt-scan.mjs` via `startsWith` — exact names and declared aliases only;
  a near-miss fails loudly with suggestions.
- **`convert-all.mjs` generated the Antigravity host from the wrong source (085).**
  It read the CURRENT project's `.claude/` (the kit's dogfood install), shipping a
  kit-local agent, missing newer commands (`debate`, `plan-week`, `project-map`)
  and keeping 33 stale flat duplicates after the taxonomy reorg. New `--templates`
  mode reads `templates/claude` + `templates/contextkit/workflows` with a
  clean-first build (top-level README.md preserved), wired as
  `npm run build:antigravity` — a kit build step, never the user `--update` path.
  Tree regenerated: 73 skills / 33 agents / 7 playbooks / 6 workflows, 1:1.
- **Antigravity drift detection disagreed with the Stop hook (092).**
  `session-manager` carried its own inline "important file" filter (it wrongly
  ignored `.claude/` edits, under-reporting drift); it now consumes the canonical
  config-driven predicate (`pendingImportantPaths`) from `hooks/ledger.mjs`.
- **Dispatch confinement + trust model (090).** Resolved scripts must stay under
  `contextkit/tools/scripts`; the project-local trust assumption both runners
  share with npm scripts / git hooks is documented in their headers.

### Changed
- **Installer io convention unified (091).** The `engine`/`claude`/`antigravity`
  installers import `fs.mjs` directly; the pass-through `io` object and parameter
  are gone (half the modules already imported directly — one convention now).

### Added
- **`/project-map` module dependency graph — blast-radius edges (ADR-0040).**
  The map gains a **"Module dependencies (who imports whom)"** section in
  `00-index.md` — deterministic edges between mapped modules, resolved from import
  statements (zero AI tokens). New `project-map-deps.mjs` extracts JS/TS-family
  imports (`import … from`, `require()`, dynamic `import()`) and resolves each to a
  target module by **relative path** or **workspace package name** (from each
  module's `package.json`); externals (node_modules) are ignored. Edges are sorted
  → the committed docs stay churn-free (ADR-0039), and deps are deliberately kept
  OUT of the structural signature. Symbol extraction moved to a sibling
  `project-map-symbols.mjs` (cohesion — keeps `project-map-core.mjs` under budget).
  v1 covers the JS/TS family; other languages' edges are deferred (documented, not
  silent). Pairs with `/simulate-impact`. Covered by selfcheck + a cross-module
  edge round-trip in the tooling integration test.

### Changed
- **`/project-map` staleness via a deterministic structural fingerprint (ADR-0039).**
  The map signature was `modules:files:mtime` — printed in every doc header — so
  regenerating an unchanged project **churned** the committed docs, and the boot
  nudge (which compared `generatedAt` to the newest mtime) **false-fired after
  every clone** (clone resets mtimes). The signature is now a `sha256` over each
  module's `path:files:bytes` (no mtime, no clock): an unchanged tree renders
  **byte-identical** docs (zero churn) and `--check` is exact. The date is dropped
  from the doc bodies (kept in `manifest.json` + console). `projectMapStale` now
  compares each module's saved `{files, bytes}` against a bounded (≤400-stat)
  recompute — structural, clone-safe, and it **skips** a cap-truncated module
  rather than false-flag it (rule 8). Self-contained (no `git`, no `tools/` import).
  Covered by selfcheck + churn-free + stale-on-edit integration asserts.


### Added
- **`/project-map` — deterministic, stack-agnostic structural map (durable memory).**
  A new zero-AI-token mapper (`contextkit/tools/scripts/project-map{,-core,-render}.mjs`)
  scans the project and writes a committed map under `contextkit/memory/project-map/`:
  `00-index.md` (one-screen overview — stack + modules classified 🎨 frontend /
  ⚙️ backend / 🔗 shared / 🛠️ config), `01-modules.md`, `02-inventory.md` (sampled
  exported symbols), and a `manifest.json` signature. The agent reads the index
  INSTEAD of re-greping the tree each session. `--check` diffs the saved signature
  (`--strict` exits 1 for CI), and the SessionStart boot context nudges 🗺️ when the
  map is older than the newest source edit (bounded mtime walk, ≤400 stats — rule 2).
  Output path single-sourced via `pathsFor().projectMap` (rule 4); the installer
  seeds `memory/project-map/`. Claude host this release; the Antigravity mirror
  follows with the host-modular pass. Covered by selfcheck + a frontend/backend
  classification round-trip in the tooling integration test.
- **Legacy-install migration (rename follow-through).** `install.mjs` now carries
  an old `vibekit/` install forward to `contextkit/` automatically on `npx
  contextdevkit --update` (and via an explicit `node install.mjs --migrate
  [--dry-run]`). New `tools/install/migrate.mjs`: atomically MOVES the folder
  (preserving memory/ADRs, config + level, pipeline tasks, `.env`), rewrites the
  rename tokens in `settings.json` (killing the duplicate-hook trap),
  `.gitignore`, `.gitattributes`, git-hook wrappers, `contextkit/.env`, and
  `CLAUDE.md` (the last two backed up to `*.bak`), and deletes the stale
  `/vibe-*` + `setupvibedevkit` command files. Refuses (no-op + warning) when
  BOTH folders exist; idempotent; never throws into the installer (rule 2). New
  `tools/integration-test-migrate.mjs` (25 asserts) wired into `test` +
  `prepublishOnly`.
- **agent-forge squad — Fase 6: declarative pipeline DSL + dry-run engine
  (ADR-0015 Part A).** The forge's orchestration is now a diffable, simulate-
  impact-mappable plan. New `templates/contextkit/squads/agent-forge/pipeline.yaml`
  declares the 9 build steps (validate-blueprint → route →
  checkpoint-shortlist → generate-prompt → generate-tools? → generate-rag? →
  governance → eval-gate (on_reject → generate-prompt, max_cycles: 3) →
  package). New `templates/contextkit/tools/scripts/squad-pipeline.mjs` engine
  parses via `lib/yaml.mjs` (ADR-0013 optional dynamic import) and refuses on
  missing `yaml` with **exit 0 + informative** message — pipelines are opt-in,
  not hot-path. New `squad-pipeline-condition.mjs` is the whitelisted
  condition parser: only `<id>(.<id>)* <op> <literal>` and `…length <op>
  <int>` (no function calls, no boolean chaining, no arithmetic). `--dry-run`
  walks the graph against an empty context and prints the would-be execution
  order with markers `✓` runs · `⊘` skipped by condition · `↺` has retry
  loop. `max_review_cycles` is a hard cap (engine exits "manual escalation
  required" rather than looping past it); vendor model names are refused
  (only `model_tier: fast|powerful|reasoning` — the router stays the single
  resolver). 2 new selfchecks in `selfcheck-agent-forge.mjs`
  (`checkConditionParser` + `checkSquadPipeline`, 8 assertions). 4 new
  integration asserts (pipeline ships, validates, yaml-absent informative
  path). Spec: `docs/SQUAD-PIPELINE-FORMAT.md` (258 lines). `state.json` per
  run is deferred to task 040 (ADR-0015 Part C). The agent-forge ROADMAP
  Fase 6 row flips to ✅; opensquad-inspired but reshaped — full expression
  eval, vendor names in YAML, and auto-state are deliberately rejected.
- **agent-forge squad — Fase 5: RAG designer + Go runtime + L5 gate + /fleet
  Forge Stats.** Closes the original blueprint. New `lib/rag-designer.mjs`
  generates the `rag/` bundle from the blueprint when `capabilities.rag` is
  true — multilingual-vs-english embedding from `intent.domain`, pgvector vs
  qdrant from residency, recursive chunk sizing tightened for extraction,
  `top_k` scaled by complexity, hybrid search + reranker on by default. The
  packager now also stamps `{{AGENT_NAME}}` / `{{MODULE_PATH}}` into the Go
  runtime adapter (`go.mod` + README). `defaults.l5.highRiskPaths` ships with
  `agent-packages/**` so any forged-agent edit triggers the simulate-impact
  gate. `fleet.mjs cmdStats` aggregates per-repo Forge Stats and surfaces a
  fleet-total `🔥 Forge fleet: N packages across M repos…` line. Selfcheck
  split: build-pipeline checks stay in `selfcheck-agent-forge.mjs` (225
  lines), Fase 4+5 ops checks moved to the new `selfcheck-agent-forge-ops.mjs`
  (real responsibility seam). New `rag-designer.md` briefing — refuses
  pinecone under no-cloud, refuses `top_k < 4`. (035)
- **agent-forge squad — Fase 4: production maintenance + Forge Stats + reference
  docs.** Operating a fleet of forged agents in production now has tools.
  `lib/package-ops.mjs` discovers `<name>@<semver>/` dirs without needing the
  yaml dep, loads manifests + provenance via the optional path, diagnoses
  structural problems (missing files OR `{{TOKEN}}` placeholders in
  governance YAMLs), and aggregates monthly budgets. Three CLI modules wire
  **13 new `/forge-*` slash commands**: `cli/forge-ops.mjs`
  (list/show/doctor/policy/budget/audit — read-only),
  `cli/forge-eval-cli.mjs` (eval/redteam/route/fallback-test with `--provider
  mock|chaos` for CI), `cli/forge-admin.mjs` (refresh-matrix/killswitch/
  deprecate — dry-run by default, atomic tmp+rename writes on `--write`).
  Each command has a thin briefing under `templates/claude/commands/forge-*.md`
  carrying its refusal conditions. The Node runtime adapter ships a
  `createShadowEval` scaffold (sample rate from
  `quality.policy.yaml.eval_gates.drift_monitoring.sample_pct`; real scoring
  delegated to the package's `evals/`). `/context-stats` gains a **Forge Stats**
  section (package count, eval-stamp ratio, aggregate target + hard cap,
  distribution by primary provider). New reference docs:
  [`docs/SQUADS/agent-forge.md`](docs/SQUADS/agent-forge.md) +
  [`docs/AGENT-PACKAGE-FORMAT.md`](docs/AGENT-PACKAGE-FORMAT.md). Selfcheck
  gains `checkPackageOps` + 19 inventory entries (13 commands + 6 files).
  ROADMAP §8 / §9 / §10 (Forge Stats) all ✅; Fase 4 ✅. (034)
- **agent-forge squad — Fase 3: governance + eval gate (the refuse-to-ship layer).**
  Principle 5 ("Eval before embarkation") is now enforced in code. Three pure
  zero-dep modules carry the gate: `lib/eval-designer.mjs` (`designEvalSet` seeds
  golden by `intent.category` + the universal red-team baseline of
  prompt-injection / jailbreak / PII-leak + a rubric + thresholds derived from
  blueprint privacy/sla/cost — PII-leak block rate forced to 1.0 when
  `pii_present`); `lib/eval-runner.mjs` (`runEvalSuite`, provider-agnostic — mock
  for CI, real adapter for production — supports `exact` / `exact_set` /
  `numeric_tolerance:N` / `semantic_similarity:>=N`; aggregates p95 latency + cost
  and refuses pass when any threshold breaches); `lib/governance-officer.mjs`
  (`attachGovernance` builds the three pillars populated from the blueprint
  plus the fallback chain from the router decision; `validateGovernance` refuses
  on missing sections OR unresolved `{{TOKEN}}` placeholders). `packageAgent`
  now calls `attachGovernance` first (throws early), writes 4 populated
  governance YAMLs + 4 populated eval files (overwriting templates), and stamps
  `provenance.eval_passed_at` ONLY when `opts.evalResult.verdict === 'pass'`.
  `forgeNew` gains an opt-in `runEval = { provider, semantic }` that runs the
  gate before packaging. Two new agent briefings ship: `eval-designer.md` (drives
  the 10–50 golden expansion + domain red-team) and `governance-officer.md`
  (three pillars equal-weight, refuse-over-rubber-stamp). 11 new behavioural
  selfchecks + 6 new integration asserts. (033)
- **agent-forge squad — Fase 2: multi-provider + Python runtime adapter.** All five
  providers now flow end-to-end through the pipeline. `prompt-gen.mjs` gains
  `renderGoogle` (Markdown body for `systemInstruction` + safetySettings note),
  `renderDeepSeek` (OpenAI-compat with an explicit CoT cue prepended to Rules),
  `renderOllama` (Markdown body; the per-model `chat_template` is applied by the
  runtime, not embedded). `tool-gen.mjs` gains `renderGoogle` with
  `downConvertForGemini` that recursively strips JSON-Schema fields Gemini's
  `functionDeclarations` parser rejects (`additionalProperties`, `$schema`, `$id`,
  `$ref`), plus `renderDeepSeek` + `renderOllama` mirroring OpenAI's `type:function`
  shape. `packager.mjs` writes the full 5 prompt files + 5 tool adapter files on
  every package, and a new `stampRuntimeAdapters` replaces `{{AGENT_NAME}}` /
  `{{SEE_LICENSE}}` in Node `package.json` + Python `pyproject.toml` (+ their
  READMEs) when those runtimes are requested. `architect.mjs` promotes
  `runtime_adapters` to a first-class blueprint field (`enum-multi` over
  `[node, python, go]`, default `[node]`) — `validateBlueprint` rejects unknown
  entries, `fillDefaults` defaults it, `assembleManifest` stamps
  `spec.runtime_adapters` straight from the blueprint. Integration test gains 7
  new asserts across both branches (yaml-available + no-yaml CI default) covering
  every new provider + the Python adapter token stamping. (032)
- **agent-forge squad — Fase 1 MVP: end-to-end forge pipeline.** The squad now
  produces a real Agent Package. Six pure, zero-dep `lib/*.mjs` modules carry the
  pipeline: `architect.mjs` (canonical `INTERVIEW_QUESTIONS` + `validateBlueprint` +
  `fillDefaults` + canonicalized SHA-256 `blueprintHash` for provenance);
  `router.mjs` + `router/decision-rules.json` (13 rules under the 15-cap, structural
  shortlists only — quality verdicts deferred to the eval harness per ADR-0012 §5);
  `prompt-gen.mjs` (canonical Markdown → Anthropic XML with `cache=ephemeral` +
  OpenAI Markdown sections); `tool-gen.mjs` (canonical JSON schemas → Anthropic
  `{name,description,input_schema}` array + OpenAI `type:function` wrapper);
  `packager.mjs` (split into pure `assembleManifest` + I/O `packageAgent` —
  stamps provenance, replaces the README rationale slot, writes provider files).
  The optional `yaml` dep (ADR-0013) is touched only at write time via `lib/yaml.mjs`.
  Six lean `.claude/agents/forge-*.md` briefings (orchestrator / architect /
  router / prompt-engineer / tool-designer / packager) plus the `/forge-new` slash
  command and the executable `cli/forge-new.mjs` (exports `forgeNew()` for the
  integration test). Selfcheck gains `checkRouterEngine` — a behavioural guard
  that exercises a typical extraction blueprint AND the no-cloud constraint,
  asserting the rationale carries the eval-as-authority disclaimer. (031)
- **Installer copies the agent-forge squad at L>=4.** Fase-0 leftover fixed —
  without this, the squad existed only in the source tree and installed projects
  could not run `/forge-new`. Guarded by a `checkSourceInvariants` regex so a
  silent regression is impossible.
- **Integration round-trip for `/forge-new`.** New block in
  `integration-test-tooling.mjs`: when the optional `yaml` dep is installed,
  drives `forgeNew` to write a complete APF into a temp `agent-packages/...@0.1.0/`
  and asserts 11 expected files + stamped blueprint hash + routed primary
  provider + Anthropic XML prompt + OpenAI function-typed tools + Node adapter.
  When `yaml` is absent (default CI), exercises the pure half of the pipeline
  (validate → route → `assembleManifest` → generators) with the same invariants
  in memory — CI proves correctness end-to-end either way.
- **agent-forge squad — foundations (Fase 0).** New *factory* squad that forges
  portable, multi-provider Agent Packages for projects outside the kit. Scaffolded
  `templates/contextkit/squads/agent-forge/` with its README (mandate, roster, boundary)
  and `best-practices.md` (the bar every forged agent clears — five principles, the
  default catalogue, provider notes, three-pillar governance, eval lifecycle).
  Seeded `router/capability-matrix.json` (5 providers, 11 models, dated + ADR-gated)
  with a selfcheck guard that parses it and rejects malformed / duplicate / disallowed
  model ids. Materialized the full APF v1 template tree (`templates/agent-package/`,
  45 files): manifest, canonical + per-provider prompts, canonical tool schema +
  per-provider tool adapters, the eval set (golden / red-team / rubric / thresholds /
  run-eval), three governance policies + fallback-chain + audit schema, RAG config,
  and Node / Python / Go runtime-adapter stubs. Selfcheck inventory guards the docs +
  representative APF files. Approved by ADR-0012; remaining phases on the DevPipeline
  (031–035). (030)

## [1.4.2] - 2026-05-25

### Changed
- **CI actions bumped to Node 24 majors** (re-pinned by SHA): `actions/checkout`
  v4→v6, `actions/setup-node` v4→v6, `actions/dependency-review-action` v4→v5 —
  across `release.yml`, `ci.yml` and the scaffolded `quality.yml`/`security.yml`
  templates. Clears GitHub's Node 20 runtime-deprecation warning (forced Node 24
  on 2026-06-02). CodeQL stays on v3 (no Node 24 major yet). Still SHA-pinned.

## [1.4.1] - 2026-05-25

DevPipeline backlog cleared (all 25 open tasks) — bug fixes, supply-chain &
test hardening, and single-source refactors. No public API removed.

### Fixed
- **Network git calls now time out** (`git.mjs`, `pre-push.mjs`) — an unreachable
  remote could hang `/git status` and any push. Bounded via `CONTEXT_GIT_TIMEOUT_MS`. (007)
- **Boot banner**: `[Unreleased]` clipped past 60 lines now shows a `(truncated)`
  marker (009); `extractLatestSession` breaks a session-number tie by the later date (010).
- **`applyPreset`** no longer crashes on a partial/custom preset missing `l5`/`qa`/`ledger`. (013)
- **Atomic writes** (tmp-file + rename) for the ledger, workspace, pipeline and claim
  writers — a concurrent reader can't see a half-written file; pipeline ids are now
  collision-safe (exclusive create). (011)
- **`SessionStart`** no longer deletes a live concurrent session's fresh ledger. (008)

### Security
- **`sanitizeSid`** applied at every workspace-path construction (claim/release/track-edits)
  — defense-in-depth against `../` traversal in a session id. (012)
- **GitHub Actions pinned to commit SHAs** across release/ci + the security/quality
  workflow templates; **`ci.yml` is least-privilege** (`contents: read`). (019, 020)
- **README "Security & trust"** section — npx/hook-install + tag-pinning + fleet/detector
  code-execution disclosure; installer **backs up an existing git hook** to `.bak`. (021, 022)

### Added
- **Guards test suite** (`integration-test-guards.mjs`): commit-msg, pre-push
  (block/warn/allow/bypass), config-loader fallbacks, uninstall/purge, concurrency-guard
  external-edit, gh-alerts mappers, malformed-settings recovery. (014–018)
- **Pluggable-detector seed** `contextkit/detectors/` (README + inert example), now installed. (026)

### Changed
- **Single-source level taxonomy** (`config/levels.mjs`) + **passthrough config schema**
  (no more `max(5)` cap; keeps every section). [ADR-0010] (024, 025)
- **Single-source platform paths** via `pathsFor(root)`; a selfcheck guard now fails on any
  hardcoded `contextkit/` path construction (rule 4). [ADR-0011] (023)
- **Shared zero-dep helpers**: `readJsonSafe`/`parseJsonSafe` + `squadOf`, killing duplicated
  BOM-parse / squad-detection code. (027, 028)
- Line-budget cohesion notes + constitution nits (dead imports, bare-var renames);
  `selfcheck.mjs` split to stay under the RED-zone gate. (005, 006, 029)

## [1.4.0] - 2026-05-25

### Changed
- **Recommended starting level by project type** (ADR-0009) — the installer now
  defaults to **L3** for a greenfield/empty folder and **L7** for a project that
  already has code (was: always recommend L2). `--level` still pins; a re-install
  preserves an existing project's level. Not intrusive — the L5 simulate-gate stays
  inert until `l5.highRiskPaths` is set. Docs retagged (`cli` labels, `LEVELS.md`
  with new L6/L7 sections, both `instrucoes.md`, README quickstart).

### Fixed
- **Level cap stuck at 6.** `install.mjs` silently downgraded `--level 7` to 2, and
  `doctor.mjs` flagged a valid L7 project as "config.level out of range". Both now
  accept **1–7**. Also corrected stale `1-5`/`1-6` range hints across `/context-level`,
  `/setupcontextdevkit`, `settings-compose`, and `docs/ARCHITECTURE.md`.

## [1.3.0] - 2026-05-25

### Added
- **L7 "Ecosystem & Scale" — new capability tier.** The shipped Future-directions
  capabilities (fleet, agent-tuning, editor/CI, detectors/presets, token economy,
  playbooks, visual tests) are now a real activation level: **`/context-level 7`**.
  Wiring only — `getLevel` 1→7, level labels + `--level 1-7`, `defaults` docs; **no
  new hook** (same capability-tier pattern as L6). [→ ADR-0008]
- **Diverse & visual testing harness (MVP)** — `/visual-test` + `visual-test.mjs`
  **scaffold** a browser-driven visual layer (screenshot / visual-regression) for the
  detected stack: Playwright **JS** (`@playwright/test`) + **Python** (pytest-playwright);
  `status` detects an existing harness. Owned by `qa-e2e`; wired into `/scaffold-tests`,
  `/qa-signoff`, `/ship`. The runner is a project dependency — the kit scaffolds, never
  bundles/runs browsers (zero-dep hot path). Roadmap *Future directions* #6.
- **Fleet mode (MVP)** — `/fleet` + `fleet.mjs`: a control plane over many repos.
  Registry outside any repo (`~/.contextdevkit/fleet.json`, override `CONTEXT_FLEET_FILE`);
  `add`/`remove`/`list`, `stats` (aggregate each repo's `stats.mjs`), `audit`
  (aggregate `deep-analysis`), and `propagate <rule-file>` (report which repos'
  `CLAUDE.md` **lack** a rule — detect-only, no cross-repo edits). Zero-dep, defensive.
- **Outcome-driven agent tuning (MVP)** — `/tune-agents` + `agent-tuning.mjs`:
  aggregates per-agent signals (tier-2 briefing coverage + usage mentions across
  sessions) and **proposes** briefing refinements to `.agent-tuning-proposal.md`
  (gitignored); applies nothing, mirroring `/distill-sessions`. Promotes roadmap
  *Future directions* #2/#3 from candidate to MVP.
- **Playbook management** (roadmap #8) — `playbook.mjs` + **`/playbook`** turn
  `contextkit/workflows/playbooks/` into a managed layer: **list** the registry, **show**
  a procedure, and **run** one (records a tracked entry in
  `contextkit/memory/playbook-runs.md`, then prints the steps). `/ship` and the squads can
  `run` a playbook instead of restating it. Zero-dep; covered by selfcheck + integration
  tests.
- **Token economy & usage insight** (roadmap #7) — `token-report.mjs` + **`/token-report`**
  read Claude Code's local session transcripts and aggregate token usage per session and
  per ISO week (input/output/cache), with a configurable budget (`tokens.budgetPerSession`)
  that flags hot sessions. Read-only, local, zero-dep, aggregated counts only. New
  integration test covers aggregation.
- **Predictions-review cadence** (roadmap #002) — when `predictionsReview.active` (on by
  default), the SessionStart hook reminds you to run `/predictions-review` every N sessions,
  but **only** when unreviewed `/simulate-impact` predictions exist (silent otherwise).
  Mirrors security-mode. New integration test covers the trigger.
- **Editor/CI surfaces (MVP)** — a **status-line widget** (`statusline.mjs`, wired as
  `settings.statusLine` at L≥1, preserving a user's own) and a **quality CI workflow**
  (`.github/workflows/quality.yml`: `contract-scan --ci` + `tech-debt --ci`). Roadmap
  *Future directions* #4. (The Claude-driven PR-review bot is deferred — needs Claude in CI.)
- **Pluggable detectors & stack presets (MVP)** — `tech-debt-scan` loads drop-in
  detectors from `contextkit/detectors/*.mjs` (defensive dynamic import); `install.mjs
  --preset next|go|python` merges a stack preset (ledger / high-risk / QA paths) into
  config via `presets.mjs`. Roadmap *Future directions* #5.

### Changed
- **Contract drift detection deepened** (`contract-scan.mjs`) — the export extractor
  now also catches `export default`, namespace re-exports (`export * [as N] from`),
  `declare`/`abstract` declarations, generators, and type-only `export type { … }`
  (and fixes an inline-`{ type X }` mis-parse). Stays regex-based and **zero-dep** by
  design — AST would need a parser dependency (see *Honest gaps* / ADR-0003). New
  integration test covers it.
- **Optional AST contract drift** (`contract-scan.mjs`, roadmap #001) — when a parser is
  importable (`acorn`, or a module named by `CONTEXT_CONTRACT_PARSER`), extraction uses the
  AST for precision; otherwise the deepened regex (the zero-dep default) is used. The kit
  ships no parser, so the default is unchanged. Integration test covers the AST path via a
  fake parser. [→ ADR-0003]

## [1.2.0] - 2026-05-24

### Added
- **`code-security` agent (security-team sub-specialist)** — owns the code's external
  attack surface: third-party integration code (API clients/SDKs, webhooks &
  callbacks, (de)serialization of external responses), dependency provenance/SBOM,
  and SAST/CodeQL triage. Mirrors `infra-security`; cross-linked from `security`
  (AppSec lead) and `infra-security` so the lanes don't overlap.
- **GitHub-native security** — `templates/github/dependabot.yml` + an **advisory**
  `security.yml` workflow (dependency-review on PRs + the `/deps-audit` gate + CodeQL),
  installed write-if-missing; **`gh-alerts.mjs`** syncs Dependabot + code-scanning
  alerts into the DevPipeline backlog (via the `gh` CLI; degrades to exit 0 without
  `gh`/repo/network); new **`/security-setup`** command ties scaffolding + sync together.
- **`/predictions-review` — closes the predicted-vs-actual loop** (ancestor parity #1,
  second half). `predictions-review.mjs` fills each `/simulate-impact` prediction's
  *Actual* section from the session ledger (paths changed vs predicted, delta both
  ways); auto-run by `/log-session`. The v1.1.0 write-half was a stub; the review half
  is now implemented. Covered by selfcheck + integration tests.
- **`workflows/` guides + playbooks** — installed `contextkit/workflows/` with per-level
  workflow docs (L1–L5, plus an L6 capability-tier note) and four reusable playbooks
  (`tech-debt-sweep`, `simulate-impact`, `distillation-cycle`, `security-batch`),
  generalized and translated from the source platform. Seeded write-if-missing by the
  installer (`copyTreeIfMissing`); covered by selfcheck + integration tests. Completes
  the post-1.0 **ancestor parity** focus (piece #3 of 3).

### Changed
- **`/deps-audit` grown into a dependency policy** — adds **license allow/deny** (from
  installed package metadata), a CycloneDX **SBOM** (`--sbom` → `contextkit/memory/sbom.json`),
  and **lockfile-drift** detection, driven by a new `deps` config block (`defaults.mjs`
  + optional zod `schema.mjs`). Findings still flow into the DevPipeline backlog.
  Zero-dep and defensive (never throws).

### Docs
- **Roadmap:** added — and shipped — the **"supply-chain & code security"** section
  (deepen the security-team), plus a **status-key convention** (`⏳ in progress`
  alongside `✅`/`📋`/`🟡`/`➖`) in `docs/ROADMAP.md` and the installed-project template;
  trimmed the now-resolved entries from *Honest gaps*.
- **Roadmap:** added two *Future directions* initiatives — **token economy & usage
  insight** (per-session token reporting via `/token-report`, budgets, and cost-driven
  optimization, extending L6 Insight) and **playbook management** (a registry +
  `/playbook` to list/show/run/track reusable procedures), cross-linked to the existing
  `workflows/playbooks/` ancestor-parity foundation.

## [1.1.0] - 2026-05-24

### Added
- **Two-tier squad briefings** — `squad.mjs brief <agent>` scaffolds a rich briefing
  into `contextkit/squads/<squad>/<agent>.md` (squad auto-detected) behind the lean
  `.claude/agents/` agent; `squad.mjs list` shows briefing coverage. Wired into
  `/squad`. Ancestor parity #2.
- **`memory/predictions/`** — `/simulate-impact` (`mark-simulation.mjs`) now writes a
  prediction file per run (objective · covered paths · predicted-vs-actual stub),
  seeded on install. First step of the post-1.0 **ancestor parity** focus.

### Docs
- **Roadmap:** marked the 1.0 milestone **shipped** (per-item status + the extras
  delivered) and set **ancestor parity** as the post-1.0 focus.

## [1.0.0]

### Added
- **Security mode (active, not reactive)** — a SessionStart trigger reminds you to
  run `/deep-analysis` every `securityMode.everyNSessions` sessions (default 10),
  **on by default**; disable with `securityMode.active: false`. The manual
  `/deep-analysis` command stays available anytime.
- **`/deep-analysis` (global sweep)** — `deep-analysis.mjs` aggregates every
  deterministic scanner (tech-debt, deps, contract) into one report; the command
  adds judgment (security / architecture / bug pass), suggests ADRs, and ingests
  every finding into the backlog. The security-mode boot trigger reminds you to run it.
- **WSJF (SAFe) prioritization + bug severity + SLA** in the DevPipeline. A task's
  priority comes from a WSJF score (`pipeline.mjs add --wsjf uv,tc,rr,js` or
  `pipeline.mjs wsjf <id> …`), from **bug severity** (`--severity S1-S4`), or from
  scanner severity; the **SLA due date** follows the priority (config
  `pipeline.slaDays`) and the board flags ⏰ overdue. Logic in
  `pipeline-prioritize.mjs`, rendering in `pipeline-board.mjs`.
- **Bug taxonomy + known-bugs map.** Bug tasks carry `severity` (S1-S4) + `bugType`
  (functional/regression/security/performance/data/…); `pipeline.mjs sync` generates
  `contextkit/pipeline/known-bugs.md` (registry grouped by severity, open vs resolved,
  ⏰ overdue), and `pipeline.mjs bugs` prints/regenerates it.
- **`business-rules/` memory folder** — `contextkit/memory/business-rules/` with a
  versioned-rule `_TEMPLATE.md`, scaffolded on install and surfaced in
  `/setupcontextdevkit`. Mirrors the source platform's `docs/business-rules/`, kept in
  `contextkit/memory/` alongside the rest of the project's durable memory.
- **`security-team` squad (security & infra / DevSecOps)** in the squads manifest —
  groups `security` (AppSec + dependency/supply-chain) and `devops` (infra, CI/CD,
  release safety), with veto on the L5/L6 gates for Critical/High findings.
- **`/deps-audit` (security-team)** — deterministic dependency / supply-chain check
  (lockfile present, version pinning, plus native `npm`/`pnpm`/`yarn audit` CVEs when
  available) that emits findings into the DevPipeline backlog. Roadmap 1.0 #6.
- **`infra-security` agent (security-team)** — threat-models the platform the app
  runs on (IaC/cloud misconfig, IAM least-privilege, network exposure, secrets,
  container/runtime + CI/CD supply-chain hardening); pairs with `devops` (builds it)
  and `security` (AppSec). The security-team is now AppSec + infra + delivery.
- **Analysis → DevPipeline backlog flow.** `/bug-hunt`, `/analyze-code-ia-practices`,
  `/tech-debt-sweep`, and `/audit` now always emit a report **and** push each finding
  into the DevPipeline backlog, **auto-prioritized** by severity (RED→P1, yellow→P2,
  low→P3) and **idempotent**. New `pipeline.mjs ingest <findings.json>` and
  `pipeline.mjs prioritize <id> <P0-P3>` (the auto priority is **always editable** by
  the user). `tech-debt-scan --write` also emits `tech-debt-findings.json`.

### Changed
- **`install.mjs` refactored into focused modules** under `tools/install/` (cli,
  fs, project, git, uninstall). The entry point drops 487 → 234 lines — back under
  the 280-line constitution and out of the tech-debt RED ZONE. Behaviour-identical
  (the integration test drives the real installer end-to-end). Renamed
  `require_basename` → `requireBasename` to satisfy the kit's own naming rule.
- **All git/node calls go through `execFileSync` (no shell)** in `claim` and
  `release` — consistency + defense-in-depth.
- **`tech-debt-scan --ci`** added (exits non-zero on any RED-zone finding) and
  enforced as a CI step, so the kit can't regress past its own line-budget limit.
- **Deepened tier-2 QA agents** (`qa-unit`, `qa-perf`, `qa-e2e`) with anti-pattern
  tables + operational guidance (mocking strategy; visual-regression note), and
  **sharpened routing boundaries** — `architect` (dependency fit) vs `security`
  (supply-chain risk); `test-engineer` (devteam, L<4) vs `qa-orchestrator` (L≥4
  entry point). Roadmap 1.0 #5.

### Deprecated
- `/state`, `/context-doctor`, `/context-refresh` now carry a deprecation banner
  pointing to `/audit` (still fully functional); `/release` is noted as paired with
  `/claim`. Non-destructive first step of the 1.0 surface-trim (#1).

### Fixed
- Tech-debt marker detector no longer flags its own doc comment (a false positive
  in every sweep).

### Docs
- **Roadmap:** marked the squad families as shipped (v0.5.2); set a **1.0 — harden
  & prove** milestone before any L7; added **dependency & supply-chain control**
  (owned by `security-team`) as a 1.0 item.
- `/git` command description said "skill"; corrected to "command".
- **Roadmap:** added a **diverse & visual testing harness** future direction —
  browser-driven visual / regression testing with a **Python** option (Playwright /
  Selenium), owned by `qa-e2e` + `design-team`, gating "done" in `/ship`.
- **CONTRIBUTING:** documented the **public contracts** (config schema, installer
  flags, hook payload, `contextkit/` layout, command/agent names) as the 1.0 stability
  promise — breaking changes need an ADR + `/contract-check` (roadmap 1.0 #4).

### Security
- **Closed a shell-injection vector in `worktree-new`.** The base-branch argument
  was interpolated into a shell string (`execSync(\`git ... ${base}\`)`), so a
  crafted value like `"HEAD; rm -rf ~"` could run arbitrary commands. It now uses
  `execFileSync('git', argv)` (no shell), so the argument is a single literal git
  revision and a malicious value simply fails as an invalid reference.

## [0.5.2] - 2026-05-22

### Added
- **Squads as a first-class concept** — `contextkit/squads/README.md` manifest
  (rosters, when-to-use, **sovereignty** rule, grow guide), `_BRIEFING.md.tpl`
  (optional two-tier rich briefings), and the `/squad` command (show/route/brief/
  new-squad). Agents are now grouped: **devteam** + **qa-team** (existing), plus
  **compliance-team** (`privacy-lgpd` — standardized Brazilian LGPD skills: legal
  basis, consent, Art. 18 rights, retention/deletion, DPO, ANPD incidents,
  processors), **design-team** (`ux-designer`, `ui-designer`, `accessibility`
  WCAG AA), and starters for **product-team** (`product-owner`) and **ops-team**
  (`devops`). README suggests further squads (docs/data/growth/support) as
  templates. Now 18 agent archetypes; all install at Level 4.

## [0.5.1] - 2026-05-22

### Added
- **Safe `--update`** — `npx contextdevkit@latest --target . --update` refreshes the
  engine, slash commands, agents, and hook wiring **for the project's CURRENT
  level**, and **never touches** user-owned content: `CLAUDE.md`, `contextkit/config.json`
  (level + overrides preserved), memory (ADRs/sessions/roadmap/glossary), pipeline
  tasks, or scoped module `CLAUDE.md` files. New seed artifacts are added
  write-if-missing. Any plain re-run also now preserves the existing level instead
  of defaulting to 2.

## [0.5.0] - 2026-05-22

### Added
- **Version-control skill** — `/git` command + `git.mjs` diagnostics. Codifies the
  workflow (Conventional branches/commits — already hook-enforced — feature→PR, no
  direct push to default, rebase-sync, conflict handling via pre-push) and the
  **remote setup**: detects git/repo/remote/provider and whether `gh`/`glab` are
  installed+authed, and guides connecting GitHub/GitLab/other (install the CLI +
  create the repo, private by default). Wired into `/setupcontextdevkit` (6b),
  `/aidevtool-from0` (6b), the installer hint, and `doctor` (notes missing remote).
- **Modular CLAUDE.md** — each app/module gets its own scoped CLAUDE.md (like the
  source platform's `apps/api/CLAUDE.md` + `apps/mobile/CLAUDE.md`). `claude-md.mjs`
  (find/scaffold) detects module roots (`backend/`, `frontend/`, `api/`, `web/`,
  `mobile/`, and `apps/*`/`packages/*`/`modules/*`/`services/*`), `/claude-md`
  scaffolds + fills them, a `CLAUDE.child.md.tpl` is seeded, and `doctor` notes
  modules missing one. Wired into `/setupcontextdevkit` (Phase 4b) + `/aidevtool-from0`.
- **Product roadmap as a first-class artifact**: seeded `contextkit/memory/roadmap.md`
  (P-ID format), `/roadmap` command (new project → build it WITH the user;
  existing project → find a roadmap/PRD/spec to import, or analyze the code and
  **propose** one + ask the user for objectives), and `roadmap.mjs`
  (find/status/init). Wired into `/setupcontextdevkit` (Phase 5b) and
  `/aidevtool-from0` (Phase 4); `doctor` notes when the roadmap is undefined.
- **`/aidevtool-from0`** — bootstrap an empty project from zero: intelligent
  interactive product questionnaire → product vision, stack suggestion/refine
  (ADR), product **roadmap** (P-IDs), best-practices constitution, and a seeded
  DevPipeline. First-run boot now routes empty projects here, existing ones to
  `/setupcontextdevkit`.
- **Best-practices skill**: `contextkit/best-practices.md` (file-size budget +
  **intelligent** refactor-by-responsibility, SoC, naming, errors, docs) and
  `/analyze-code-ia-practices` — runs the scanner then proposes the *right*
  refactor per file (never random splits). New `practices.active` config; boot
  reminds when active.
- **DevPipeline** (execution control, distinct from the product roadmap):
  `contextkit/pipeline/{backlog,testing,conclusion}/` task files + generated
  `devpipeline.md` dashboard; `pipeline.mjs` (`add`/`move`/`sync`) and the
  `/pipeline` manager command. Bugs/increments/chores + roadmap items broken into
  tasks with priority + SLA. Synced on pre-commit.
- **Concurrency hardening (L3)** — robust against parallel sessions on the same
  machine AND different devs/machines:
  - `concurrency-guard.mjs` (`PreToolUse`): warns before you overwrite a file
    another active session edited recently, or that changed on disk since you
    last wrote it (covers full-file `Write`, which Claude Code's `Edit` freshness
    check doesn't).
  - `pre-push.mjs` git hook: fetches the upstream and **blocks a push that has a
    real textual conflict** with what was pushed there (`git merge-tree`); warns
    on auto-mergeable overlap. Bypass: `CONTEXT_ALLOW_CONFLICT_PUSH=1`.
  - SessionStart now lists **other active branches** (local worktrees + recent
    remote branches with author/age) for cross-machine awareness.
  - New config `l3.mainBranch` (upstream the conflict check compares against).
- **`/ship` automatic checkpoints** — `--auto` runs the pipeline through
  objective gates (no manual pause), still stopping on a red gate and before any
  irreversible action.
- **L6 — Autonomy & Insight** (new level): `/ship` (autonomous squad pipeline:
  design → implement → review → test → record, with checkpoints), `/retro`
  (learning loop turning recurring drift/debt into rules + ADRs), `/context-stats`
  (platform telemetry). No new hook — a capability tier on top of L5.
- **Deterministic tech-debt scanner** (`tech-debt-scan.mjs` + `tech-debt-detectors.mjs`):
  generic regex detectors (line budget, SRP "And/Or/E" names, TODO markers,
  React state-loops). `/tech-debt-sweep` now runs the scanner, then interprets.
- **Generic contract-drift** (`contract-scan.mjs` + `/contract-check`): declare
  `l5.contractGlobs`, snapshot exported symbols, flag removals/renames. CI-able.
- **Platform metrics** (`stats.mjs`): sessions, drift rate, cadence, ADR/agent counts.
- **`instrucoes.md`** — pt-BR usage guide (kit root + installed into projects).
- **`docs/ROADMAP.md`** — architect gap analysis vs the source system + L6 + future.
- New config: `l5.lineBudget`, `l5.contractGlobs`. Level range is now 1–6.

### Changed
- `/audit` now runs doctor + stats + tech-debt-scan + contract-scan deterministically.

## [0.4.1] - 2026-05-22

### Added
- **QA squad Tier 2**: `qa-perf` (benchmark/profile a hot path) and `qa-e2e`
  (critical user journeys through the real UI) agents — now 12 agent archetypes.
- **Release workflow** (`.github/workflows/release.yml`): pushing a `v*` tag runs
  the test suite, publishes to npm via the `NPM_TOKEN` secret, and creates the
  GitHub Release automatically.
- README demo/walkthrough of the `/setupcontextdevkit` flow.

### Note
- First release cut by the automated tag pipeline (validating it end-to-end).

## [0.4.0] - 2026-05-22

### Added
- **QA squad** (Level 4): `qa-orchestrator` (router + sign-off) plus `qa-unit`,
  `qa-integration`, `qa-fuzzer` specialists, and the `/test-plan`,
  `/scaffold-tests`, `/qa-signoff` commands. New `qa` config section
  (`criticalPaths`, `coverageTarget`); `detect-stack`/`setup-complete` suggest
  and apply `qa.criticalPaths`.
- **`/audit`** — one-pass health audit (doctor + tech-debt + QA + drift) with a
  prioritized action list; README documents running it on a schedule.
- **GitHub templates** installed into the target's `.github/` (PR template +
  bug/feature issue templates), written only if missing.
- **npm packaging**: `prepublishOnly` gates publish on the test suite.

### Notes
- Now ships 22 slash commands and 10 agent archetypes. Agents install at L ≥ 4.

## [0.3.0] - 2026-05-22

### Added
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs the self-check and a
  full integration test on Node 18/20/22, plus a greenfield install smoke test.
- **`tools/integration-test.mjs`** — installs into a temp project and drives the
  real hooks through a true stdin pipe (drift block, L5 gate block + allow,
  first-run trigger, level rewire, doctor). Cross-platform, self-cleaning.
- **`/distill-sessions` + `/distill-apply`** — the auto-distill cycle the L5 Stop
  nudge referenced (propose CLAUDE.md refinements, then apply with an ADR).
- **`/context-doctor`** + `doctor.mjs` — diagnoses node version, config validity,
  hook wiring vs level, git hooks, memory scaffolding, and onboarding state.
- **`context-config.mjs`** — robust `show`/`set` backing `/context-config` (type
  coercion + optional zod validation), replacing free-form JSON editing.
- **Agent archetypes**: `test-engineer`, `security` (now 6 universal agents).
- **Installer**: `--help`, `--version`, `--uninstall [--purge]`, and a
  `.gitattributes` patch (keeps engine scripts LF on all platforms).
- **Packaging**: `files`, `repository`, `homepage`, `bugs`, and `npm test`.

### Notes
- `--uninstall` keeps your memory (`contextkit/memory/`) and `CLAUDE.md`; `--purge`
  additionally removes the engine, commands, and agents.

## [0.2.0] - 2026-05-22

### Added
- **First-run trigger** — the SessionStart hook surfaces a "First run" banner
  until onboarding completes, prompting `/setupcontextdevkit`.
- **`/setupcontextdevkit`** — one-shot self-configuring onboarding (detect stack,
  tune config, fill CLAUDE.md, seed glossary, scaffold agents, baseline ADR).
- **`detect-stack.mjs`** + **`setup-complete.mjs`** — read-only stack analyzer
  with suggested ledger/high-risk paths, applied via `--detect`.
- `npx github:reiTavares/ContextDevKit` import documented.

## [0.1.0] - 2026-05-22

### Added
- Initial release: portable, level-based (L1–L5) AI dev platform for Claude Code.
- Engine: 4 hooks (boot context, edit ledger, drift nudge, L5 risk gate),
  config-driven path classification, zero-dependency BOM-safe config loader.
- Installer with greenfield/existing detection and idempotent settings
  composition. 14 slash commands, agent archetypes, ADR/session/glossary
  scaffolding, and docs.
