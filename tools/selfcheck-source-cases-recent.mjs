/**
 * Self-check — SOURCE invariant CASES (the recent program: ADR-0030+).
 *
 * Sharded from `selfcheck-source-cases.mjs` (ADR-0034 — the data table crossed the
 * constitution's RED line budget; the EVO-patterns / close-the-loop program cases
 * live here, the legacy cases stay in the sibling). Same `[label, path, regex]`
 * shape; `runSourceChecks` concatenates both. Add a new ADR-era invariant here.
 */
export const SOURCE_INVARIANT_CASES_RECENT = [
    // ADR-0030 — per-task complexity rubric (EVO-METHOD/BMAD-derived, MIT).
    ['complexity-rubric loader exports classify (ADR-0030)', 'templates/contextkit/tools/scripts/complexity-rubric.mjs', /export function classify/],
    ['complexity-rubric loader exports loadRubric', 'templates/contextkit/tools/scripts/complexity-rubric.mjs', /export function loadRubric/],
    ['complexity-rubric falls back to an embedded default (never throws)', 'templates/contextkit/tools/scripts/complexity-rubric.mjs', /DEFAULT_RUBRIC/],
    ['complexity-rubric single-sources the path via pathsFor (rule 4)', 'templates/contextkit/tools/scripts/complexity-rubric.mjs', /pathsFor\(root\)\.complexityRubric/],
    ['rubric seed declares the lgpd domain → privacy-lgpd (ADR-0030)', 'templates/contextkit/policy/complexity-rubric.json', /"lgpd":[\s\S]*"privacy-lgpd"/],
    ['rubric seed declares the three ceremony tiers', 'templates/contextkit/policy/complexity-rubric.json', /"trivial":[\s\S]*"feature":[\s\S]*"architectural":/],
    ['paths.mjs exposes complexityRubric (ADR-0030)', 'templates/contextkit/runtime/config/paths.mjs', /complexityRubric:/],
    ['/dev-start right-sizes via the complexity rubric (ADR-0030)', 'templates/claude/commands/pipeline/dev-start.md', /complexity-rubric\.mjs classify/],
    ['/dev-start has a correct-course checkpoint (ADR-0030)', 'templates/claude/commands/pipeline/dev-start.md', /Correct-course checkpoint/],
    ['/ship right-sizes via the complexity rubric (ADR-0030)', 'templates/claude/commands/pipeline/ship.md', /complexity-rubric\.mjs classify/],
    ['/pipeline right-sizes a new task (ADR-0030)', 'templates/claude/commands/pipeline/pipeline.md', /complexity-rubric\.mjs classify/],
    ['installer seeds the complexity rubric (ADR-0030)', 'tools/install/engine.mjs', /policy\/complexity-rubric\.json/],
    ['installer seeds review-protocol.md — closes ADR-0029 gap (ADR-0030)', 'tools/install/engine.mjs', /'review-protocol\.md'/],
    // ADR-0030 — document-quality validation (EVO steps-v adaptation, MIT).
    ['validate-doc validates ADR sections (ADR-0030)', 'templates/contextkit/tools/scripts/validate-doc.mjs', /function validateAdr/],
    ['validate-doc flags template placeholders', 'templates/contextkit/tools/scripts/validate-doc.mjs', /PLACEHOLDERS/],
    ['validate-doc checks consequences own a trade-off', 'templates/contextkit/tools/scripts/validate-doc.mjs', /TRADEOFF_HINTS/],
    ['validate-doc is advisory — never blocks (rule 8)', 'templates/contextkit/tools/scripts/validate-doc.mjs', /never blocks a push/],
    ['/validate-doc command briefing ships (ADR-0030)', 'templates/claude/commands/audit/validate-doc.md', /document-quality rubric/],
    // ADR-0030 — OSS repo-ops (gh-triage / draft-changelog / changelog-social + RCA).
    ['draft-changelog groups Conventional Commits (ADR-0030)', 'templates/contextkit/tools/scripts/draft-changelog.mjs', /const SECTION = \{/],
    ['draft-changelog times out git calls (rule 2)', 'templates/contextkit/tools/scripts/draft-changelog.mjs', /timeout:\s*\d/],
    ['draft-changelog never writes the file (drafts only)', 'templates/contextkit/tools/scripts/draft-changelog.mjs', /never writes/],
    ['/draft-changelog command briefing ships', 'templates/claude/commands/vcs/draft-changelog.md', /Draft a \[Unreleased\]/i],
    ['/gh-triage classifies via the complexity rubric (ADR-0030)', 'templates/claude/commands/vcs/gh-triage.md', /complexity-rubric\.mjs classify/],
    ['/gh-triage degrades cleanly without gh (rule 8)', 'templates/claude/commands/vcs/gh-triage.md', /skip, never fake/],
    ['/changelog-social drafts only — never posts', 'templates/claude/commands/vcs/changelog-social.md', /never posts/i],
    ['bug-hunt emits a structured RCA writeup (ADR-0030)', 'templates/claude/commands/bug-hunt.md', /root-cause analysis/i],
    // ADR-0030 — mid-flight elicitation (advanced-elicitation + correct-course).
    ['/roadmap new does advanced elicitation (ADR-0030)', 'templates/claude/commands/roadmap.md', /Advanced elicitation/],
    ['/forge-new does advanced elicitation (ADR-0030)', 'templates/claude/commands/forge/forge-new.md', /Advanced elicitation/],
    // ADR-0030 follow-up — Diátaxis docs spine + reindex-on-update.
    ['docs-reindex exports reindexDocs (ADR-0030)', 'templates/contextkit/tools/scripts/docs-reindex.mjs', /export function reindexDocs/],
    ['docs-reindex declares the four Diátaxis buckets', 'templates/contextkit/tools/scripts/docs-reindex.mjs', /BUCKETS\s*=\s*\['tutorials',\s*'how-to',\s*'reference',\s*'explanation'\]/],
    ['docs-reindex preserves a hand-written index (marker guard)', 'templates/contextkit/tools/scripts/docs-reindex.mjs', /INDEX_MARKER/],
    ['docs-reindex never moves content files (reorganize without losing)', 'templates/contextkit/tools/scripts/docs-reindex.mjs', /never move/i],
    ['installer runs the docs reindex on install/update (ADR-0030)', 'tools/install/engine.mjs', /reindexDocs\(target\)/],
    ['/docs-reindex command briefing ships (ADR-0030)', 'templates/claude/commands/docs-reindex.md', /Diátaxis/],
    // ADR-0031 — single quality gate; protected release path.
    ['package.json defines the unified ci gate (ADR-0031)', 'package.json', /"ci":\s*"npm test &&[^"]*tech-debt-scan\.mjs --ci/],
    ['package.json prepublishOnly delegates to the ci gate', 'package.json', /"prepublishOnly":\s*"npm run ci"/],
    ['package.json defines preflight-release (ADR-0031)', 'package.json', /"preflight-release":\s*"npm run ci &&[^"]*preflight-version\.mjs/],
    ['ci.yml delegates to npm run ci (ADR-0031)', '.github/workflows/ci.yml', /run:\s*npm run ci/],
    ['release.yml runs the full gate before publish (ADR-0031)', '.github/workflows/release.yml', /run:\s*npm run ci/],
    ['release.yml publishes with npm provenance (ADR-0031)', '.github/workflows/release.yml', /npm publish --provenance/],
    ['release.yml grants id-token for provenance (ADR-0031)', '.github/workflows/release.yml', /id-token:\s*write/],
    ['preflight-version refuses an already-published version (ADR-0031)', 'tools/preflight-version.mjs', /ALREADY published/],
    // ADR-0032 — connect the substrate: classification + closed loops.
    ['complexity-rubric exposes classifyTask for the pipeline (ADR-0032)', 'templates/contextkit/tools/scripts/complexity-rubric.mjs', /export function classifyTask/],
    ['pipeline add auto-classifies via the rubric (ADR-0032)', 'templates/contextkit/tools/scripts/pipeline.mjs', /classifyTask\(title/],
    ['session-draft drafts the Done section from the ledger (ADR-0032)', 'templates/contextkit/tools/scripts/session-draft.mjs', /export async function draftSession/],
    ['/log-session pre-fills from session-draft (ADR-0032)', 'templates/claude/commands/log-session.md', /session-draft\.mjs/],
    ['advise-review computes per-lane hit-rate (ADR-0032)', 'templates/contextkit/tools/scripts/advise-review.mjs', /export function reviewAdvice/],
    ['/retro consumes advise-review (ADR-0032)', 'templates/claude/commands/pipeline/retro.md', /advise-review\.mjs/],
    ['/tune-agents consumes advise-review (ADR-0032)', 'templates/claude/commands/tune-agents.md', /advise-review\.mjs/],
    ['pipeline start enforces the ADR gate (ADR-0032)', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /ADR-0032 gate/],
    ['check-registration emits a diff-aware signal (ADR-0032)', 'templates/contextkit/runtime/hooks/check-registration.mjs', /function diffSignal/],
    ['check-registration nudge points at the ledger auto-draft (ADR-0032)', 'templates/contextkit/runtime/hooks/check-registration.mjs', /session-draft\.mjs/],
    // ADR-0033 — boot as a budget.
    ['boot-signals exposes engineUpdateSignal (ADR-0033)', 'templates/contextkit/runtime/hooks/boot-signals.mjs', /export function engineUpdateSignal/],
    ['boot-signals exposes valueLine (ADR-0033)', 'templates/contextkit/runtime/hooks/boot-signals.mjs', /export function valueLine/],
    ['session-start caps the drift banner to 2 freshest (ADR-0033)', 'templates/contextkit/runtime/hooks/session-start.mjs', /drift\.slice\(0, 2\)/],
    ['session-start renders the engine-update signal (ADR-0033)', 'templates/contextkit/runtime/hooks/session-start.mjs', /engineUpdateSignal\(ROOT\)/],
    ['session-start renders the weekly value line (ADR-0033)', 'templates/contextkit/runtime/hooks/session-start.mjs', /valueLine\(ROOT\)/],
    ['defaults expose boot.valueLine (ADR-0033)', 'templates/contextkit/runtime/config/defaults.mjs', /boot:\s*\{\s*valueLine:\s*true\s*\}/],
    ['installer stamps the engine version (ADR-0033)', 'tools/install/engine.mjs', /'\.engine-version'/],
    // ADR-0034 — DevPipeline lifecycle automation.
    ['adr-tasks parses the Decision into backlog tasks (ADR-0034)', 'templates/contextkit/tools/scripts/adr-tasks.mjs', /export function parseAdrTasks/],
    ['adr-tasks is dry-run by default; --write creates (rule 8)', 'templates/contextkit/tools/scripts/adr-tasks.mjs', /pass --write to create/],
    ['/new-adr generates the backlog from the decision (ADR-0034)', 'templates/claude/commands/new-adr.md', /adr-tasks\.mjs/],
    ['track-edits renews per-task heartbeat (ADR-0034)', 'templates/contextkit/runtime/hooks/track-edits.mjs', /claimRecord\.tasks/],
    ['pipeline-session auto-advances owned working tasks (ADR-0034)', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /export function autoAdvanceSessionTasks/],
    ['auto-advance requires ALL acceptance boxes checked (rule 8)', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /allChecked/],
    ['Stop hook auto-advances session tasks (ADR-0034)', 'templates/contextkit/runtime/hooks/check-registration.mjs', /autoAdvanceSessionTasks/],
    ['boot-signals exposes openBugsDue (ADR-0034)', 'templates/contextkit/runtime/hooks/boot-signals.mjs', /export function openBugsDue/],
    ['session-start surfaces open bugs (ADR-0034)', 'templates/contextkit/runtime/hooks/session-start.mjs', /openBugsDue\(ROOT\)/],
    ['/dev-start auto-starts a referenced task (ADR-0034)', 'templates/claude/commands/pipeline/dev-start.md', /pipeline\.mjs start <id>/],
    // Ticket 062 — media providers send the API key in a header, never the URL query.
    ['nano-banana sends the key in x-goog-api-key header (ticket 062)', 'templates/contextkit/runtime/providers/media/nano-banana.mjs', /'x-goog-api-key'/],
    ['veo sends the key in x-goog-api-key header (ticket 062)', 'templates/contextkit/runtime/providers/media/veo.mjs', /'x-goog-api-key'/],
    // ADR-0035 — Deliberations: multi-agent debate artifact feeding ADRs.
    ['defaults expose the deliberations toggle (ADR-0035)', 'templates/contextkit/runtime/config/defaults.mjs', /deliberations:\s*\{\s*active:\s*true,\s*voices:\s*3,\s*minLevel:\s*5/],
    ['config schema models deliberations (ADR-0035)', 'templates/contextkit/runtime/config/schema.mjs', /deliberations:\s*DeliberationsSchema/],
    ['schema bounds the voice count (ADR-0035)', 'templates/contextkit/runtime/config/schema.mjs', /voices:\s*z\.number\(\)\.int\(\)\.min\(2\)\.max\(5\)/],
    ['paths.mjs exposes deliberations + index (ADR-0035, rule 4)', 'templates/contextkit/runtime/config/paths.mjs', /deliberationsIndex:\s*at\(DELIBERATIONS_INDEX\)/],
    ['deliberations-reindex derives the index from filesystem state (ADR-0035)', 'templates/contextkit/tools/scripts/deliberations-reindex.mjs', /Deliberation History/],
    ['deliberations-reindex surfaces the unresolved status (ADR-0035)', 'templates/contextkit/tools/scripts/deliberations-reindex.mjs', /unresolved/],
    ['pre-commit reindexes deliberations when present (ADR-0035)', 'templates/contextkit/runtime/git-hooks/pre-commit.mjs', /deliberations-reindex\.mjs/],
    ['installer seeds the deliberations template (ADR-0035)', 'tools/install/engine.mjs', /memory\/deliberations\/_TEMPLATE\.md/],
    ['installer ensures the deliberations dir (ADR-0035)', 'tools/install/engine.mjs', /'predictions', 'deliberations'\]/],
    ['/debate dispatches GENUINELY INDEPENDENT voices (ADR-0035)', 'templates/claude/commands/debate.md', /blind to the others/],
    ['/debate keeps unresolved a first-class outcome (ADR-0035)', 'templates/claude/commands/debate.md', /VALID outcome, not a failure/],
    ['/debate is dry-run ADR by default; --approve applies (rule 8)', 'templates/claude/commands/debate.md', /--approve/],
    // ADR-0035 (task 080) — high-risk-path nudge hook: the deterministic second trigger.
    ['deliberation-nudge emits a banner, never a block decision (rule 2)', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /<deliberation-nudge>/],
    ['deliberation-nudge documents it never blocks (rule 2)', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /NEVER blocks/],
    ['deliberation-nudge gates on level >= minLevel (ADR-0035)', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /getLevel\(ROOT\) < minLevel/],
    ['deliberation-nudge honors the active + nudgeOnHighRisk toggles', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /nudgeOnHighRisk === false/],
    ['deliberation-nudge single-sources the path set from l5.highRiskPaths', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /l5\?\.highRiskPaths/],
    ['deliberation-nudge debounces once per session (ADR-0035)', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /deliberation-nudged/],
    ['deliberation-nudge sanitizes the session id (path safety)', 'templates/contextkit/runtime/hooks/deliberation-nudge.mjs', /sanitizeSid/],
    ['settings wire the deliberation nudge at L5 (ADR-0035)', 'templates/contextkit/runtime/config/settings-compose.mjs', /deliberation-nudge\.mjs/],
    // Backlog-zero batch — shared task I/O seam (extracted from pipeline.mjs).
    ['pipeline task I/O is single-sourced in pipeline-tasks', 'templates/contextkit/tools/scripts/pipeline-tasks.mjs', /export function listTasks/],
    ['pipeline.mjs consumes the shared task lister', 'templates/contextkit/tools/scripts/pipeline.mjs', /from '\.\/pipeline-tasks\.mjs'/],
    // Ticket 073 — /plan-week deterministic backlog ranking.
    ['plan-next exports rankBacklog (ticket 073)', 'templates/contextkit/tools/scripts/plan-next.mjs', /export function rankBacklog/],
    ['plan-next scores by priority/SLA/lane (ticket 073)', 'templates/contextkit/tools/scripts/plan-next.mjs', /export function planScore/],
    ['plan-next sinks blocked tickets below actionable (ticket 073)', 'templates/contextkit/tools/scripts/plan-next.mjs', /BLOCKED_PENALTY/],
    ['/plan-week command briefing ships (ticket 073)', 'templates/claude/commands/pipeline/plan-week.md', /plan-next\.mjs/],
    // Ticket 072 — DevPipeline dependency enforcement (board edge already covered above).
    ['pipeline start refuses on open dependencies (ticket 072)', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /ticket 072 dependency gate/],
    ['pipeline-session computes open blockers (ticket 072)', 'templates/contextkit/tools/scripts/pipeline-session.mjs', /function openBlockers/],
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
    // Ticket 057 — SEO refuse-gate in code-reviewer.
    ['code-reviewer enforces the SEO refuse-gate (ticket 057)', 'templates/claude/agents/code-reviewer.md', /SEO[ /]+.*refuse-gate/i],
    ['code-reviewer reads the seo-aiso playbook (ticket 057)', 'templates/claude/agents/code-reviewer.md', /seo-aiso\.md/],
    ['code-reviewer honours an indexability carve-out ADR (ticket 057)', 'templates/claude/agents/code-reviewer.md', /carve-out/],
    // Ticket 065 — read-only git diagnostics; fetch gated behind --fetch.
    ['sync-check divergence is read-only by default (ticket 065)', 'templates/contextkit/tools/scripts/sync-check.mjs', /if \(doFetch\) run\('git', \['fetch'/],
    ['git.mjs status only fetches on --fetch (ticket 065)', 'templates/contextkit/tools/scripts/git.mjs', /if \(doFetch\) run\('git', \['fetch'/],
    // Data-loss guard — the cross-device migration must verify the copy before deleting the source.
    ['migration verifies a cross-device copy before rm (data-loss guard)', 'tools/install/migrate.mjs', /missingAfterCopy\(from, to\)/],
    ['migration refuses to delete the source on a partial copy', 'tools/install/migrate.mjs', /copy incomplete/],
    // Antigravity integration — second native host alongside Claude Code (skills/agents/playbooks/workflows + ctx runner).
    ['install.mjs wires the Antigravity host installer (extracted helper)', 'install.mjs', /installAntigravityHost\(target, TPL,/],
    ['Antigravity installer copies the assets into .antigravity', 'tools/install/antigravity.mjs', /copyTree\(join\(tplDir, 'antigravity'\), join\(target, '\.antigravity'\)\)/],
    ['Antigravity installer installs the ctx.mjs central CLI runner', 'tools/install/antigravity.mjs', /overwrite\(join\(target, 'ctx\.mjs'\), await io\.read\(join\(tplDir, 'ctx\.mjs'\)\)\)/],
    ['Antigravity installer renders INSTRUCTIONS.md from the template', 'tools/install/antigravity.mjs', /read\(join\(tplDir, 'INSTRUCTIONS\.md\.tpl'\)\)/],
    ['package.json declares the agy bin → ctx.mjs', 'package.json', /"agy":\s*"ctx\.mjs"/],
    ['ctx.mjs is the central CLI runner for Antigravity', 'templates/ctx.mjs', /central CLI runner for Antigravity/],
    ['session-manager replaces the Claude Code hook lifecycle', 'templates/contextkit/runtime/antigravity/session-manager.mjs', /Antigravity Session Manager/],
    ['convert-all targets the .antigravity/skills tree', 'templates/contextkit/runtime/antigravity/convert-all.mjs', /'\.antigravity\/skills'/],
    ['INSTRUCTIONS.md.tpl is the Antigravity boot context (replaces CLAUDE.md)', 'templates/INSTRUCTIONS.md.tpl', /Instructions for Antigravity/],
    // ADR-0037 — host-modular installer: install.mjs orchestrates, hosts/engine in tools/install/.
    ['install.mjs wires the host-neutral engine installer (ADR-0037)', 'install.mjs', /installEngine\(target, TPL,/],
    ['install.mjs wires the Claude host installer (ADR-0037)', 'install.mjs', /installClaudeHost\(target, TPL,/],
    ['install.mjs wires Claude settings on the rewire path (ADR-0037)', 'install.mjs', /wireClaudeSettings\(target, level,/],
    ['install.mjs wires the VCS integration step (ADR-0037)', 'install.mjs', /installVcsIntegration\(target, TPL, level,/],
    ['engine installer exports installEngine (ADR-0037)', 'tools/install/engine.mjs', /export async function installEngine/],
    ['Claude host installer exports installClaudeHost (ADR-0037)', 'tools/install/claude.mjs', /export async function installClaudeHost/],
    ['Claude host installer exports wireClaudeSettings (ADR-0037)', 'tools/install/claude.mjs', /export async function wireClaudeSettings/],
    ['git installer exports installVcsIntegration (ADR-0037)', 'tools/install/git.mjs', /export async function installVcsIntegration/],
];
