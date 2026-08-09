/**
 * Self-check — SOURCE invariant CASES (the recent program: ADR-0030+).
 *
 * Sharded from `selfcheck-source-cases.mjs` (ADR-0034 — the data table crossed the
 * constitution's RED line budget; the EVO-patterns / close-the-loop program cases
 * live here, the legacy cases stay in the sibling). Same `[label, path, regex]`
 * shape; `runSourceChecks` concatenates both. Add a new ADR-era invariant here.
 */
export const SOURCE_INVARIANT_CASES_RECENT = [
    // (ADR-0030 cases graduated to the stable `selfcheck-source-cases.mjs` for the line budget.)
    // ADR-0031 — single quality gate; protected release path.
    // WF-0057 W6 (ADR-0122): the sole CI verdict is now the Architecture &
    // Technical-Debt Governance Gate engine (decisions.md Fork-1 — one CI path),
    // which replaced the demoted line-budget `tech-debt-scan.mjs --ci` block.
    ['package.json defines the unified ci gate (ADR-0031/ADR-0122)', 'package.json', /"ci":\s*"npm test &&[^"]*architecture-debt-gate\.mjs --ci/],
    ['package.json prepublishOnly delegates to CI and the v4 release gate', 'package.json', /"prepublishOnly":\s*"npm run ci && npm run release:v4:gate"/],
    ['package.json defines preflight-release (ADR-0031)', 'package.json', /"preflight-release":\s*"npm run ci &&[^"]*preflight-version\.mjs/],
    ['ci.yml delegates to npm run ci (ADR-0031)', '.github/workflows/ci.yml', /run:\s*npm run ci/],
    ['release.yml runs the full gate before publish (ADR-0031)', '.github/workflows/release.yml', /run:\s*npm run ci/],
    ['release.yml publishes with npm provenance (ADR-0031)', '.github/workflows/release.yml', /npm publish --provenance/],
    ['release.yml grants id-token for provenance (ADR-0031)', '.github/workflows/release.yml', /id-token:\s*write/],
    ['preflight-version refuses an already-published version (ADR-0031)', 'tools/preflight-version.mjs', /ALREADY published/],
    // ADR-0032 — connect the substrate: classification + closed loops.
    ['complexity-rubric exposes classifyTask for the pipeline (ADR-0032)', 'templates/contextkit/tools/scripts/complexity-rubric.mjs', /export function classifyTask/],
    ['pipeline add uses canonical CAS task creation', 'templates/contextkit/tools/scripts/pipeline-add.mjs', /addTask\(target, taskInput, document\.revision/],
    ['session-draft drafts the Done section from authored session memory (ADR-0032)', 'templates/contextkit/tools/scripts/session-draft.mjs', /export async function draftSession/],
    ['/log-session pre-fills from session-draft (ADR-0032)', 'templates/claude/commands/log-session.md', /session-draft\.mjs/],
    ['/advise remains read-only and creates no task authority', 'templates/claude/commands/advise.md', /never creates tasks, workflows, or receipts/i],
    ['pipeline start delegates lifecycle validation to the canonical store', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /transitionTask\(tasksTarget/],
    // ADR-0033 — boot as a budget.
    ['boot-signals exposes engineUpdateSignal (ADR-0033)', 'templates/contextkit/runtime/hooks/boot-signals.mjs', /export function engineUpdateSignal/],
    ['boot-signals exposes valueLine (ADR-0033)', 'templates/contextkit/runtime/hooks/boot-signals.mjs', /export function valueLine/],
    ['boot-banner caps the drift banner to 2 freshest (ADR-0033)', 'templates/contextkit/runtime/hooks/boot-banner.mjs', /drift\.slice\(0, 2\)/],
    ['defaults expose boot.valueLine (ADR-0033)', 'templates/contextkit/runtime/config/defaults.mjs', /boot:\s*\{\s*valueLine:\s*true\s*\}/],
    ['installer stamps the engine version (ADR-0033)', 'tools/install/engine.mjs', /'\.engine-version'/],
    // ADR-0034 — DevPipeline lifecycle automation.
    ['adr-tasks parses the Decision into backlog tasks (ADR-0034)', 'templates/contextkit/tools/scripts/adr-tasks.mjs', /export function parseAdrTasks/],
    ['adr-tasks is preview-only and never creates authority', 'templates/contextkit/tools/scripts/adr-tasks.mjs', /preview-only; it never writes task authority/],
    ['/new-adr previews decision work without creating a shadow backlog', 'templates/claude/commands/new-adr.md', /preview-only/],
    ['pipeline-session never auto-completes tasks', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /status !== 'working'/],
    ['/dev-start auto-starts a referenced task (ADR-0034)', 'templates/claude/commands/pipeline/dev-start.md', /pipeline\.mjs start <id>/],
    // Ticket 062 — media providers send the API key in a header, never the URL query.
    ['nano-banana sends the key in x-goog-api-key header (ticket 062)', 'templates/contextkit/runtime/providers/media/nano-banana.mjs', /'x-goog-api-key'/],
    ['veo sends the key in x-goog-api-key header (ticket 062)', 'templates/contextkit/runtime/providers/media/veo.mjs', /'x-goog-api-key'/],
    // ADR-0035 — Deliberations: multi-agent debate artifact feeding ADRs.
    ['defaults expose the deliberations toggle (ADR-0035)', 'templates/contextkit/runtime/config/defaults.mjs', /deliberations:\s*\{\s*active:\s*true,\s*voices:\s*3,\s*minLevel:\s*5/],
    ['config schema models deliberations (ADR-0035)', 'templates/contextkit/runtime/config/schema.mjs', /deliberations:\s*DeliberationsSchema/],
    ['schema bounds the voice count (ADR-0035)', 'templates/contextkit/runtime/config/schema.mjs', /voices:\s*z\.number\(\)\.int\(\)\.min\(2\)\.max\(5\)/],
    ['paths.mjs exposes deliberations + index from the active memory authority (ADR-0035, rule 4)', 'templates/contextkit/runtime/config/paths.mjs', /deliberationsIndex:\s*inMemory\('DELIBERATIONS\.md'\)/],
    ['deliberations-reindex derives the index from filesystem state (ADR-0035)', 'templates/contextkit/tools/scripts/deliberations-reindex.mjs', /Deliberation History/],
    ['deliberations-reindex surfaces the unresolved status (ADR-0035)', 'templates/contextkit/tools/scripts/deliberations-reindex.mjs', /unresolved/],
    ['pre-commit reindexes deliberations when present (ADR-0035)', 'templates/contextkit/runtime/git-hooks/pre-commit.mjs', /deliberations-reindex\.mjs/],
    ['installer seeds the deliberations template (ADR-0035)', 'tools/install/engine.mjs', /memory\/deliberations\/_TEMPLATE\.md/],
    ['installer ensures the deliberations dir (ADR-0035)', 'tools/install/engine.mjs', /'predictions', 'deliberations'/],
    ['/debate dispatches GENUINELY INDEPENDENT voices (ADR-0035)', 'templates/claude/commands/debate.md', /blind to the others/],
    ['/debate keeps unresolved a first-class outcome (ADR-0035)', 'templates/claude/commands/debate.md', /VALID outcome, not a failure/],
    ['/debate is dry-run ADR by default; --approve applies (rule 8)', 'templates/claude/commands/debate.md', /--approve/],
    // WF-0111 W08 - canonical JSON task I/O seam.
    ['pipeline task I/O is single-sourced in tasks-store', 'templates/contextkit/tools/scripts/tasks-store.mjs', /export const listTasks/],
    ['pipeline.mjs consumes the canonical task store', 'templates/contextkit/tools/scripts/pipeline.mjs', /from '\.\/tasks-store\.mjs'/],
    // Ticket 073 — /plan-week deterministic backlog ranking.
    ['plan-next exports rankBacklog (ticket 073)', 'templates/contextkit/tools/scripts/plan-next.mjs', /export function rankBacklog/],
    ['plan-next scores only canonical priority and dependencies', 'templates/contextkit/tools/scripts/plan-next.mjs', /priority and dependency readiness/],
    ['plan-next sinks blocked tickets below actionable (ticket 073)', 'templates/contextkit/tools/scripts/plan-next.mjs', /BLOCKED_PENALTY/],
    ['/plan-week command briefing ships (ticket 073)', 'templates/claude/commands/pipeline/plan-week.md', /plan-next\.mjs/],
    // Ticket 072 — DevPipeline dependency enforcement (board edge already covered above).
    ['canonical validator checks dependency references', 'templates/contextkit/tools/scripts/tasks-validate.mjs', /dependsOn references unknown task/],
    // Ticket 074 — /ship resume from a stamped current stage.
    ['ship-state declares the 9 ship stages (ticket 074)', 'templates/contextkit/tools/scripts/ship-state.mjs', /export const SHIP_STAGES/],
    ['ship-state surfaces in-flight runs for resume (ticket 074)', 'templates/contextkit/tools/scripts/ship-state.mjs', /export function inflightRuns/],
    ['/ship offers resume of an in-flight ship (ticket 074)', 'templates/claude/commands/pipeline/ship.md', /ship-state\.mjs current/],
    // Ticket 075 — gh-triage incremental watermark.
    ['gh-triage selects only new issues past the watermark (ticket 075)', 'templates/contextkit/tools/scripts/gh-triage.mjs', /export function selectNewIssues/],
    ['gh-triage dedupes against tracked gh# sources (ticket 075)', 'templates/contextkit/tools/scripts/gh-triage.mjs', /export function trackedIssueNumbers/],
    ['/gh-triage fetches incrementally via the watermark (ticket 075)', 'templates/claude/commands/vcs/gh-triage.md', /gh-triage\.mjs select/],
    // Ticket 079 — setup completedAt → time-to-value in /context-stats.
    ['stats computes time-to-value (ticket 079)', 'templates/contextkit/tools/scripts/stats.mjs', /function timeToValue/],
    ['setup-complete stamps completedAt (ticket 079)', 'templates/contextkit/tools/scripts/setup-complete.mjs', /completedAt:/],
    // Ticket 056 — media-gen content-addressed cache.
    ['media-cache is content-addressed by sha256 (ticket 056)', 'templates/contextkit/tools/scripts/media-cache.mjs', /createHash\('sha256'\)/],
    ['media-cache slots live under the single-sourced platform dir (ticket 056)', 'templates/contextkit/tools/scripts/media-cache.mjs', /pathsFor\(root\)\.platform/],
    ['media-gen consults the cache before generate (ticket 056)', 'templates/contextkit/tools/scripts/media-gen.mjs', /isCached\(slot\)/],
    ['media-gen honours --no-cache (ticket 056)', 'templates/contextkit/tools/scripts/media-gen.mjs', /args\.noCache/],
    ['installer gitignores the media cache (ticket 056)', 'tools/install/git.mjs', /contextkit\/\.cache\//],
    // ContextDevKit 4: SEO remains specialist review, never a fourth guarded gate.
    ['code-reviewer keeps SEO advisory outside guarded runtime', 'templates/claude/agents/code-reviewer.md', /does not add a guarded runtime domain or deny the owner's work/i],
    ['code-reviewer reads the seo-aiso playbook (ticket 057)', 'templates/claude/agents/code-reviewer.md', /seo-aiso\.md/],
    ['code-reviewer honours an indexability carve-out ADR (ticket 057)', 'templates/claude/agents/code-reviewer.md', /carve-out/],
    // Ticket 065 — read-only git diagnostics; fetch gated behind --fetch.
    ['sync-check divergence is read-only by default (ticket 065)', 'templates/contextkit/tools/scripts/sync-check.mjs', /if \(doFetch\) run\('git', \['fetch'/],
    ['git.mjs status only fetches on --fetch (ticket 065)', 'templates/contextkit/tools/scripts/git.mjs', /if \(doFetch\) run\('git', \['fetch'/],
    // Antigravity integration — second native host alongside Claude Code (skills/agents/playbooks/workflows + ctx runner).
    ['install.mjs wires the Antigravity host installer (extracted helper)', 'install.mjs', /installAntigravityHost\(target, TPL,/],
    // ADR-0048 — assets live in the agy-native `.agents/`, single-sourced via ANTIGRAVITY_DIR.
    ['Antigravity installer copies the assets into the agy-native dir (ADR-0048)', 'tools/install/antigravity.mjs', /copyTree\(join\(tplDir, 'antigravity'\), join\(target, ANTIGRAVITY_DIR\)\)/],
    ['Antigravity installer removes the legacy .antigravity tree (ADR-0048)', 'tools/install/antigravity.mjs', /rm\(legacyTree, \{ recursive: true, force: true \}\)/],
    ['paths.mjs single-sources the agy host dir as .agents (ADR-0048, rule 4)', 'templates/contextkit/runtime/config/paths.mjs', /export const ANTIGRAVITY_DIR = '\.agents'/],
    ['pathsFor exposes the antigravity host dir (ADR-0048, rule 4)', 'templates/contextkit/runtime/config/paths.mjs', /antigravity:\s*at\(ANTIGRAVITY_DIR\)/],
    ['uninstall --purge removes the agy host dirs, new + legacy (ADR-0048)', 'tools/install/uninstall.mjs', /ANTIGRAVITY_DIR, ANTIGRAVITY_LEGACY_DIR/],
    ['convert-all resolves installed Antigravity targets from the canonical manifest', 'templates/contextkit/runtime/antigravity/convert-all.mjs', /rule\.targetPath/],
    ['doctor flags a leftover legacy .antigravity tree (ADR-0048)', 'templates/contextkit/tools/scripts/doctor.mjs', /ANTIGRAVITY_LEGACY_DIR/],
    ['.agents README ships the host-coexistence rule (ADR-0048)', 'templates/antigravity/README.md', /Host-coexistence rule/],
    // ADR-0158 — native hosts use one canonical dispatcher process per event.
    ['agent-hooks-compose exports the agy composer (ADR-0049)', 'templates/contextkit/runtime/config/agent-hooks-compose.mjs', /export function composeAgentHooks/],
    ['agent-hooks-compose exports the uninstall strip (ADR-0049)', 'templates/contextkit/runtime/config/agent-hooks-compose.mjs', /export function stripAgentHooks/],
    ['write preflight delegates to the shared host boundary', 'templates/contextkit/runtime/hooks/governance-write-preflight.mjs', /dispatchHostGovernanceEvent/],
    ['postflight delegates to the shared host boundary', 'templates/contextkit/runtime/hooks/governance-postflight.mjs', /dispatchHostGovernanceEvent/],
    ['completion delegates to the shared host boundary', 'templates/contextkit/runtime/hooks/governance-completion.mjs', /dispatchHostGovernanceEvent/],
    ['prompt preflight delegates to the shared host boundary', 'templates/contextkit/runtime/hooks/governance-prompt-preflight.mjs', /dispatchHostGovernanceEvent/],
    ['installer wires .agents/hooks.json per level (ADR-0049)', 'tools/install/antigravity.mjs', /wireAntigravityHooks\(target, ctx\.level, report\)/],
    ['uninstall strips the kit hook group from agy hooks.json (ADR-0049)', 'tools/install/uninstall.mjs', /stripAgentHooks\(/],
    ['context-level re-wires the agy hooks on level change (ADR-0049)', 'templates/contextkit/tools/scripts/context-level.mjs', /composeAgentHooks\(agyExisting, level\)/],
    ['doctor checks the agy hook group presence (ADR-0049)', 'templates/contextkit/tools/scripts/doctor.mjs', /contextdevkit hook group/],
    ['Antigravity installer installs the ctx.mjs central CLI runner', 'tools/install/antigravity.mjs', /overwrite\(join\(target, 'ctx\.mjs'\), await read\(join\(tplDir, 'ctx\.mjs'\)\)\)/],
    ['Antigravity installer renders INSTRUCTIONS.md from the template', 'tools/install/antigravity.mjs', /read\(join\(tplDir, 'INSTRUCTIONS\.md\.tpl'\)\)/],
    ['package.json agy bin points at the published templates/ctx.mjs (bug 097)', 'package.json', /"agy":\s*"templates\/ctx\.mjs"/],
    ['ctx.mjs is the central CLI runner for Antigravity', 'templates/ctx.mjs', /central CLI runner for Antigravity/],
    // Tickets 089/090/096 — dispatch contract: no prefix guess, SCRIPTS_DIR confinement, did-you-mean.
    ['ctx.mjs has no prefix-match dispatch fallback (ticket 089)', 'templates/ctx.mjs', /no prefix fallback/],
    ['ctx.mjs confines resolved scripts to SCRIPTS_DIR (ticket 090)', 'templates/ctx.mjs', /resolved\.startsWith\(SCRIPTS_DIR \+ sep\)/],
    ['ctx.mjs documents the project-local trust model (ticket 090)', 'templates/ctx.mjs', /Trust model/],
    ['ctx.mjs suggests the closest commands on a miss (ticket 096)', 'templates/ctx.mjs', /suggestClosest/],
    ['ctx-menu.mjs carries the categorised registry (ticket 096)', 'templates/contextkit/runtime/antigravity/ctx-menu.mjs', /export const CATEGORIES/],
    // Human-facing host contract keeps the v4 guarded allowlist explicit.
    ['guard.mjs and simulate-gate share matchHighRisk (ticket 095)', 'templates/contextkit/runtime/hooks/path-classification.mjs', /export function matchHighRisk/],
    ['INSTRUCTIONS.md.tpl exposes the v4 guarded allowlist instead of a host-specific guard command', 'templates/INSTRUCTIONS.md.tpl', /Only QA at done,[\s\S]*proven DDD Class A invariants,[\s\S]*high-severity technical/],
    ['convert-all selects Antigravity outputs from the canonical projection manifest', 'templates/contextkit/runtime/antigravity/convert-all.mjs', /selectHostProjectionRules\(manifest, 'antigravity', mode, GENERATOR\)/],
    ['convert-all has the --templates kit-build mode (ticket 085)', 'templates/contextkit/runtime/antigravity/convert-all.mjs', /process\.argv\.includes\('--templates'\)/],
    ['package.json wires the antigravity build step (ticket 085)', 'package.json', /"build:antigravity":\s*"node templates\/contextkit\/runtime\/antigravity\/convert-all\.mjs --templates"/],
    ['INSTRUCTIONS.md.tpl is the Antigravity boot context', 'templates/INSTRUCTIONS.md.tpl', /Boot Context for Antigravity/],
    // ADR-0037 — host-modular installer: install.mjs orchestrates, hosts/engine in tools/install/.
    ['install.mjs wires the host-neutral engine installer (ADR-0037)', 'install.mjs', /installEngine\(target, TPL,/],
    ['install.mjs wires the Claude host installer (ADR-0037)', 'install.mjs', /installClaudeHost\(target, TPL,/],
    ['install.mjs wires Claude settings on the rewire path (ADR-0037)', 'install.mjs', /wireClaudeSettings\(target, level,/],
    ['install.mjs wires the VCS integration step (ADR-0037)', 'install.mjs', /installVcsIntegration\(target, TPL, level,/],
    ['engine installer exports installEngine (ADR-0037)', 'tools/install/engine.mjs', /export async function installEngine/],
    // Ticket 091 — one io convention: installers import fs.mjs directly (no pass-through io object).
    ['engine installer imports fs helpers directly (ticket 091)', 'tools/install/engine.mjs', /from '\.\/fs\.mjs'/],
    ['Claude host installer imports fs helpers directly (ticket 091)', 'tools/install/claude.mjs', /from '\.\/fs\.mjs'/],
    ['Antigravity installer imports fs helpers directly (ticket 091)', 'tools/install/antigravity.mjs', /from '\.\/fs\.mjs'/],
    ['install.mjs passes ctx without an io object (ticket 091)', 'install.mjs', /installEngine\(target, TPL, ctx, report\)/],
    ['Claude host installer exports installClaudeHost (ADR-0037)', 'tools/install/claude.mjs', /export async function installClaudeHost/],
    ['Claude host installer exports wireClaudeSettings (ADR-0037)', 'tools/install/claude.mjs', /export async function wireClaudeSettings/],
    ['git installer exports installVcsIntegration (ADR-0037)', 'tools/install/git.mjs', /export async function installVcsIntegration/],
    // project-map — deterministic, stack-agnostic structural map (durable memory).
    ['project-map-core exports scanProject (project-map)', 'templates/contextkit/tools/scripts/project-map-core.mjs', /export function scanProject/],
    ['project-map-core ignores the platform dirs, maps the app (project-map)', 'templates/contextkit/tools/scripts/project-map-core.mjs', /IGNORE_DIRS[\s\S]*'contextkit'/],
    ['project-map-core caps files + symbols per module (bounded output)', 'templates/contextkit/tools/scripts/project-map-core.mjs', /CAP_FILES_PER_MODULE|CAP_SYMBOLS_PER_MODULE/],
    ['project-map-render exports renderAll (project-map)', 'templates/contextkit/tools/scripts/project-map-render.mjs', /export function renderAll/],
    ['project-map CLI single-sources the output via pathsFor (rule 4)', 'templates/contextkit/tools/scripts/project-map.mjs', /pathsFor\(ROOT\)\.projectMap/],
    ['project-map CLI supports the --check staleness diff', 'templates/contextkit/tools/scripts/project-map.mjs', /flag\('--check'\)/],
    ['paths.mjs exposes projectMap from the active memory authority (project-map, rule 4)', 'templates/contextkit/runtime/config/paths.mjs', /projectMap:\s*inMemory\('project-map'\)/],
    ['boot-signals re-exports projectMapStale from its own module (project-map)', 'templates/contextkit/runtime/hooks/boot-signals.mjs', /export \{ projectMapStale \} from '\.\/boot-signals-projmap\.mjs'/],
    ['boot-signals-projmap exports projectMapStale (project-map)', 'templates/contextkit/runtime/hooks/boot-signals-projmap.mjs', /export function projectMapStale/],
    ['projectMapStale bounds the boot size walk (rule 2 — boot stays fast)', 'templates/contextkit/runtime/hooks/boot-signals-projmap.mjs', /budget\s*=\s*\{\s*n:\s*400\s*\}/],
    ['installer seeds the project-map memory dir (project-map)', 'tools/install/engine.mjs', /memory\/project-map\/\.gitkeep/],
    ['installer ensures the project-map and canonical work roots', 'tools/install/engine.mjs', /'deliberations', 'project-map', 'business', 'operations', 'batches', 'workflows'/],
    ['/project-map command briefing ships (project-map)', 'templates/claude/commands/project-map.md', /deterministic filesystem scan/],
    // project-map ADR-0039 — deterministic structural fingerprint (no mtime → no churn, clone-safe).
    ['project-map signature is a content sha256, not mtime (ADR-0039)', 'templates/contextkit/tools/scripts/project-map-core.mjs', /export function structuralSignature[\s\S]*createHash\('sha256'\)/],
    ['project-map core accumulates bytes, drops mtime from the signature (ADR-0039)', 'templates/contextkit/tools/scripts/project-map-core.mjs', /acc\.bytes \+= statSync\(full\)\.size/],
    ['project-map render header carries no date (deterministic docs, ADR-0039)', 'templates/contextkit/tools/scripts/project-map-render.mjs', /carries no date/],
    ['manifest stores per-module bytes for staleness (ADR-0039)', 'templates/contextkit/tools/scripts/project-map.mjs', /files: m\.files, bytes: m\.bytes/],
    ['projectMapStale compares files\\+bytes vs the manifest, not mtime (ADR-0039)', 'templates/contextkit/runtime/hooks/boot-signals-projmap.mjs', /cur\.bytes !== Number\(mod\.bytes\)/],
    ['projectMapStale skips a cap-truncated module (refuse-to-false-positive, rule 8)', 'templates/contextkit/runtime/hooks/boot-signals-projmap.mjs', /truncated module → don't trust the count \(rule 8\)/],
    // project-map ADR-0040 — module dependency graph (blast-radius edges).
    ['project-map-deps exports extractImports + linkDeps (ADR-0040)', 'templates/contextkit/tools/scripts/project-map-deps.mjs', /export function extractImports[\s\S]*export function linkDeps/],
    ['project-map-deps resolves workspace package names via package.json (ADR-0040)', 'templates/contextkit/tools/scripts/project-map-deps.mjs', /function packageIndex/],
    ['project-map-deps keeps deps sorted for determinism (no churn, ADR-0040)', 'templates/contextkit/tools/scripts/project-map-deps.mjs', /\[\.\.\.deps\]\.sort\(\)/],
    ['project-map core links module deps after the scan (ADR-0040)', 'templates/contextkit/tools/scripts/project-map-core.mjs', /linkDeps\(root, modules\)/],
    ['project-map render emits the dependency adjacency list (ADR-0040)', 'templates/contextkit/tools/scripts/project-map-render.mjs', /Module dependencies \(who imports whom\)/],
    ['symbol extraction lives in its own module (cohesion, sibling of deps)', 'templates/contextkit/tools/scripts/project-map-symbols.mjs', /export function extractSymbols/],
    ['path-classification exports the secret-bearing class (task 103, ADR-0041 floor)', 'templates/contextkit/runtime/hooks/path-classification.mjs', /export function matchSecret/],
    ['secret class is extendable, never removable (task 103, ADR-0041)', 'templates/contextkit/runtime/hooks/path-classification.mjs', /never remove/],
    // ADR-0158 — concrete risk acknowledgement replaces the grade dial.
    ['schema exposes only concrete risk acknowledgement metadata', 'templates/contextkit/runtime/config/schema.mjs', /riskAcknowledgement: RiskAcknowledgementSchema/],
    ['risk acknowledgement names exactly the three owner-contract classes', 'templates/contextkit/runtime/governance/risk-acknowledgement.mjs', /'destructive-production'[\s\S]*'force-push'[\s\S]*'secret-rotation'/],
    ['legacy autonomy keys are read only by the explicit v3-to-v4 migrator', 'templates/contextkit/tools/migrations/v3-to-v4/autonomy.mjs', /planLegacyAutonomyMigration/],
    ['statusline governance segment derives from the v4 matrix resolver', 'templates/contextkit/runtime/statusline.mjs', /resolveGovernanceMatrix\(config\)/],
    ['qa-reject is the testing-to-working semantic alias', 'templates/contextkit/tools/scripts/pipeline-transitions.mjs', /to: 'working',[\s\S]*actor: 'qa'/],
    ['canonical task store pairs status and audit event atomically', 'templates/contextkit/tools/scripts/tasks-store.mjs', /status\/event pairing in one atomic JSON commit/],
    // ADR-0043 F2 — observable substrate (task 111).
    ['appendRunEvent is the only pipeline-run event writer', 'templates/contextkit/runtime/state/run-state-store.mjs', /export function appendRunEvent/],
    ['auto-transition is bounded to explicit forward edges', 'templates/contextkit/tools/scripts/pipeline-transitions.mjs', /AUTOMATIC_EDGES/],
    ['runs exposes the per-item transition log (task 111)', 'templates/contextkit/tools/scripts/runs.mjs', /function showEvents/],
    // ADR-0046 — project-map active architectural-fitness substrate.
    ['project-map-insights exports computeInsights + manifestDelta + subgraphFor (ADR-0046)', 'templates/contextkit/tools/scripts/project-map-insights.mjs', /export function computeInsights[\s\S]*export function manifestDelta[\s\S]*export function subgraphFor/],
    ['project-map-rules reuses the F0 secret class, never reinvents it (ADR-0046)', 'templates/contextkit/tools/scripts/project-map-rules.mjs', /import \{ matchSecret \} from '\.\.\/\.\.\/runtime\/hooks\/path-classification\.mjs'/],
    ['project-map rules are opt-in — no rules.json ⇒ no enforcement (ADR-0046, rule 8)', 'templates/contextkit/tools/scripts/project-map-rules.mjs', /if \(!rules\) return \[\];/],
    ['project-map CLI fails --strict on stale OR violation (the CI gate, ADR-0046)', 'templates/contextkit/tools/scripts/project-map.mjs', /\(stale \|\| model\.violations\.length > 0\) && flag\('--strict'\)/],
    ['project-map CLI exposes the focused --for subgraph for the F3 retriever (ADR-0046)', 'templates/contextkit/tools/scripts/project-map.mjs', /flag\('--for'\)/],
    ['pre-commit auto-refreshes the map, grade-blind + never blocks (ADR-0046, rule 2)', 'templates/contextkit/runtime/git-hooks/pre-commit.mjs', /projectMap\?\.autoRefresh !== false && stagedTouchesSource\(\)/],
    ['boot surfaces project-map violations + cycles from the manifest (ADR-0046)', 'templates/contextkit/runtime/hooks/boot-signals-projmap.mjs', /architecture-rule violation/],
    // Whitespace-tolerant: the block went multi-line when the graph sub-section
    // landed (WF-0108 / ADR-0155). The assertion is the TOGGLES, not the formatting.
    ['defaults ship the projectMap toggles (ADR-0046)', 'templates/contextkit/runtime/config/defaults.mjs', /projectMap: \{\s*autoRefresh: true,\s*enforce: true/],
    ['defaults keep project-map graph advisory with immediate fallback', 'templates/contextkit/runtime/config/defaults.mjs', /graph: \{ enabled: true, mode: 'advisory', humanFlip: false, autoIndex: true, maxAgeMinutes: \d+ \}/],
    ['schema models the projectMap block (ADR-0046)', 'templates/contextkit/runtime/config/schema.mjs', /projectMap: ProjectMapSchema/],
    ['quality.yml runs the structural fitness gate (ADR-0046)', 'templates/github/workflows/quality.yml', /project-map\.mjs --check --strict/],
    // ADR-0044 F3 D3 — per-agent / per-command token attribution.
    ['token-attribution splits cost by agent (sidechain) and command (attributionSkill) (ADR-0044 D3)', 'templates/contextkit/tools/scripts/token-attribution.mjs', /entry\.isSidechain \? agents\.subagent : agents\.main[\s\S]*entry\.attributionSkill/],
    ['token-attribution derives only from parsed records — no persisted artifact (ADR-0044, anti-inflation)', 'templates/contextkit/tools/scripts/token-attribution.mjs', /export function attribute/],
    ['token-report surfaces the D3 attribution + exposes it in --json (ADR-0044)', 'templates/contextkit/tools/scripts/token-report.mjs', /attribution,.*toolEvents.*\} = aggregate[\s\S]*attribution[\s\S]*JSON\.stringify\([\s\S]*null, 2\)/],
    // ADR-0044 F3 D1/D5 — bounded subagent pack + the deterministic memory retriever.
    ['memory-retrieve selects existing digests — no generation, hard-capped (ADR-0044 D5)', 'templates/contextkit/tools/scripts/memory-retrieve.mjs', /export const CAP = 40[\s\S]*retrieved, not generated/],
    ['memory-retrieve guards its CLI so import never runs main (ADR-0044, rule 2)', 'templates/contextkit/tools/scripts/memory-retrieve.mjs', /fileURLToPath\(import\.meta\.url\) === resolve\(process\.argv\[1\]\)/],
    ['context-pack ships the bounded --for-subagent pack reusing the retriever (ADR-0044 D1)', 'templates/contextkit/tools/scripts/context-pack.mjs', /renderRetrieval\(retrieval\)[\s\S]*flag\('--for-subagent'\)/],
    ['subagent pack carries the do-not-re-read-boot instruction (ADR-0044 D1)', 'templates/contextkit/tools/scripts/context-pack.mjs', /Do not re-read boot context/],
    ['/debate embeds the subagent pack before fan-out (ADR-0044 D1)', 'templates/claude/commands/debate.md', /--for-subagent --objective/],
    ['/advise embeds the subagent pack before lane fan-out (ADR-0044 D1)', 'templates/claude/commands/advise.md', /--for-subagent --objective/],
    ['/ship embeds the subagent pack when delegating (ADR-0044 D1)', 'templates/claude/commands/pipeline/ship.md', /--for-subagent --objective/],
    // ADR-0044 F3 D2 — compact [Unreleased] boot digest with a raw fallback.
    ['boot digests [Unreleased] as count-by-type + recent entries (ADR-0044 D2)', 'templates/contextkit/runtime/hooks/boot-context-readers.mjs', /export function digestUnreleased/],
    // ADR-0158 — autonomy is advisory; real safety remains explicit and external.
    ['risk acknowledgement never replaces the platform safety boundary (ADR-0158)', 'templates/contextkit/runtime/governance/risk-acknowledgement.mjs', /binding: false[\s\S]*blocking: false[\s\S]*platform-safety-boundary-remains-authoritative/],
    // Workflow Navigator — token-efficient phase guidance for ADR-0057 workflows.
    ['workflow-assist exports the PHASE_GUIDES map (ADR-0057 navigator)', 'templates/contextkit/tools/scripts/workflow-assist.mjs', /export const PHASE_GUIDES/],
    ['workflow-assist reuses readWorkflow from workflow-pack (no reinvention)', 'templates/contextkit/tools/scripts/workflow-assist.mjs', /import \{.*readWorkflow.*\} from '\.\/workflow-pack\.mjs'/],
    ['ctx.mjs has the assist alias for workflow-assist (ADR-0057 navigator)', 'templates/ctx.mjs', /'assist':\s*'workflow-assist\.mjs'/],
];
