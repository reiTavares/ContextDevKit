# Changelog

All notable changes to ContextDevKit are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
