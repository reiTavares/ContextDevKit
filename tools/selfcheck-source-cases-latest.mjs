/**
 * Self-check — SOURCE invariant CASES (the latest program: ADR-0047+).
 *
 * Third shard of the source-invariant data table (siblings:
 * `selfcheck-source-cases.mjs` legacy · `selfcheck-source-cases-recent.mjs`
 * ADR-0030…0046) — opened when the recent shard reached the constitution's
 * line budget. Same `[label, path, regex]` shape; `runSourceChecks`
 * concatenates all three. Add a new ADR-era invariant here.
 */
export const SOURCE_INVARIANT_CASES_LATEST = [
    // ADR-0047 A1 — PR line in /git status (task 128).
    ['sync-check exports the PR facts for reuse (ADR-0047 A1)', 'templates/contextkit/tools/scripts/sync-check.mjs', /export function listOpenPRs/],
    ['sync-check guards its CLI so import never runs main (rule 2)', 'templates/contextkit/tools/scripts/sync-check.mjs', /resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)/],
    ['squad-audit guards its CLI with fileURLToPath for Linux paths', 'templates/contextkit/tools/scripts/squad-audit.mjs', /resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)/],
    ['squad-director guards its CLI with fileURLToPath for Linux paths', 'templates/contextkit/tools/scripts/squad-director.mjs', /resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)/],
    ['git.mjs surfaces the branch PR fact, reusing sync-check (ADR-0047 A1)', 'templates/contextkit/tools/scripts/git.mjs', /function branchPrFact[\s\S]*listOpenPRs\(\['--head', branch\]\)/],
    ['git.mjs reports an unusable gh as SKIPPED, never as no-PR (rule 8)', 'templates/contextkit/tools/scripts/git.mjs', /\{ status: 'skipped', reason: 'gh not installed\/authed' \}/],
    // ADR-0047 A2 — /advise --after --since <ref> (task 129).
    ['/advise --after accepts a --since git range (ADR-0047 A2)', 'templates/claude/commands/advise.md', /--since <ref>[\s\S]*git diff --name-only <ref>\.\.\.HEAD/],
    ['/advise refuses an unknown --since ref, no silent fallback (rule 8)', 'templates/claude/commands/advise.md', /never silently fall back/],
    ['antigravity /advise mirror carries --since (ticket 084 parity)', 'templates/antigravity/skills/advise.md', /--since <ref>/],
    // ADR-0047 A3 — DevPipeline board digest (task 130).
    ['pipeline-board exports the token-light digest (ADR-0047 A3)', 'templates/contextkit/tools/scripts/pipeline-board.mjs', /export function renderDigest/],
    ['the digest is bounded — backlog capped, titles clipped (ADR-0027 posture)', 'templates/contextkit/tools/scripts/pipeline-board.mjs', /backlogCap = 8/],
    ['pipeline.mjs wires the board --digest verb (ADR-0047 A3)', 'templates/contextkit/tools/scripts/pipeline.mjs', /cmd === 'board'/],
    ['/pipeline show starts from the digest, not N task files (ADR-0047 A3)', 'templates/claude/commands/pipeline/pipeline.md', /board --digest/],
    ['/plan-week points at the digest for lane context (ADR-0047 A3)', 'templates/claude/commands/pipeline/plan-week.md', /board --digest/],
    // ADR-0047 A4 — scheduled alert-sync in the scaffolded security.yml (task 131).
    ['security.yml ships the opt-in cron trigger, commented (ADR-0047 A4, rule 8)', 'templates/github/workflows/security.yml', /# schedule:\s*\n\s*#\s+- cron:/],
    ['security.yml alert-sync job runs gh-alerts on the schedule only (ADR-0047 A4)', 'templates/github/workflows/security.yml', /alert-sync:[\s\S]*github\.event_name == 'schedule'[\s\S]*gh-alerts\.mjs/],
    // ADR-0047 A5 — registry-backed staleness in /deps-audit (task 132).
    ['deps-audit gates the network behind --registry (ADR-0047 A5, rule 8)', 'templates/contextkit/tools/scripts/deps-audit.mjs', /process\.argv\.includes\('--registry'\)/],
    ['deps-audit reports an unreachable registry as SKIPPED, never a pass (rule 8)', 'templates/contextkit/tools/scripts/deps-audit.mjs', /'registry-skipped'/],
    ['deps-audit registry URL is env-overridable for offline tests', 'templates/contextkit/tools/scripts/deps-audit.mjs', /CONTEXT_NPM_REGISTRY/],
    ['deps-audit registry fetch is bounded (timeout, abbreviated metadata)', 'templates/contextkit/tools/scripts/deps-audit.mjs', /AbortSignal\.timeout\(8000\)/],
    // Antigravity host hardening (tickets 140-143).
    ['ctx.mjs interpolates arguments via function replacement — $&/$`/$\' stay literal (ticket 141)', 'templates/ctx.mjs', /\.replace\(\/\\\$ARGUMENTS\/g, \(\) => replacement\)/],
    ['ctx.mjs resolves the agy-adapted skill tree before the raw Claude source (ticket 142)', 'templates/ctx.mjs', /walkDir\(resolve\(ROOT, '\.agents\/skills'\), filter\)\)\[0\]\s*\|\|\s*\(await walkDir\(resolve\(ROOT, '\.claude\/commands'\)/],
    ['convert-all delegates the transformation to the shared convert-core (ticket 140)', 'templates/contextkit/runtime/antigravity/convert-all.mjs', /import \{ adaptContent, convertCommandToSkill, convertAgentToPersona \} from '\.\/convert-core\.mjs'/],
    ['INSTRUCTIONS.md.tpl carries no rot-prone skill count (ticket 143)', 'templates/INSTRUCTIONS.md.tpl', /^(?![\s\S]*\b\d+ slash commands)[\s\S]*$/],
    ['INSTRUCTIONS.md.tpl references no nonexistent engine-keeper persona (ticket 143)', 'templates/INSTRUCTIONS.md.tpl', /^(?![\s\S]*engine-keeper)[\s\S]*$/],
    // Encoding + config-rot guards (tickets 144-145).
    ['selfcheck wires the tree-wide mojibake gate (ticket 144)', 'tools/selfcheck.mjs', /runEncodingChecks\(\{ ok, bad \}, \{ KIT \}\)/],
    ['doctor probes config paths that no longer exist — registration rot is critical (ticket 145)', 'templates/contextkit/tools/scripts/doctor.mjs', /probe\(cfg\?\.ledger\?\.registration, 'ledger\.registration', fail\)/],
    // ADR-0052 Phase 2 — /fable, the manual premium tier (Fable stays manual-only).
    ['/fable dispatches the task to a Fable subagent via the Agent tool model param (ADR-0052 Phase 2)', 'templates/claude/commands/fable.md', /Agent tool with[\s\S]*`model: fable`/],
    ['/fable is explicit-only — never invoked on the agent own initiative (ADR-0052 Phase 2)', 'templates/claude/commands/fable.md', /Never invoke Fable on your own initiative/],
    ['/fable runs Fable in the subagent, not the main loop — cache-safe (ADR-0052 invariant)', 'templates/claude/commands/fable.md', /subagent, not the main loop/],
    ['Fable stays out of the auto agent aliases — manual by construction (ADR-0052)', 'tools/selfcheck-templates.mjs', /VALID_MODEL_ALIASES = new Set\(\['haiku', 'sonnet', 'opus', 'inherit'\]\)/],
    // Codex third host.
    ['install.mjs wires the Codex host installer', 'install.mjs', /installCodexHost\(target, TPL, ctx, report\)/],
    ['Codex installer renders AGENTS.md from the template', 'tools/install/codex.mjs', /read\(join\(tplDir, 'AGENTS\.md\.tpl'\)\)/],
    ['Codex installer copies generated skills into the project skill surface', 'tools/install/codex.mjs', /CODEX_SKILLS_DIR/],
    ['paths.mjs single-sources the Codex host dir as .codex', 'templates/contextkit/runtime/config/paths.mjs', /export const CODEX_DIR = '\.codex'/],
    ['package.json ships the cdx bin target', 'package.json', /"cdx":\s*"templates\/cdx\.mjs"/],
    ['Codex hooks carry an explicit host flag', 'templates/contextkit/runtime/config/codex-hooks-compose.mjs', /--host codex/],
    ['Codex hook adapter persists a stable local session marker', 'templates/contextkit/runtime/hooks/host-adapter.mjs', /CODEX_SESSION_MARKER[\s\S]*rememberHookSessionId/],
    ['AGENTS.md.tpl documents the full Codex session workflow', 'templates/AGENTS.md.tpl', /Complete Session Workflow \(Codex\)[\s\S]*node cdx\.mjs log-session/],
    ['AGENTS.md.tpl requires cooperation across hosts', 'templates/AGENTS.md.tpl', /Codex, Claude Code, and Antigravity are peers/],
    // ADR-0057 regression — WS-D spawnSync timeout hygiene (task 158).
    ['session-draft times out its git call — no silent hang (ADR-0057, rule 2)', 'templates/contextkit/tools/scripts/session-draft.mjs', /spawnSync\('git'[\s\S]*timeout:\s*\d/],
    // ADR-0056 follow-up — WS-E installed-mode converter wire-or-retire doc (task 159).
    ['codex README documents the converter wire-or-retire status (ADR-0056, task 159)', 'templates/codex/README.md', /Converter — wire-or-retire status[\s\S]*Installed-mode[\s\S]*auto-wired/],
    // Docs auto-refresh.
    ['docs-refresh exports the dogfood-safe refresh entry point', 'templates/contextkit/tools/scripts/docs-refresh.mjs', /export function refreshDocs/],
    ['pre-commit refreshes generated docs before staging derived indices', 'templates/contextkit/runtime/git-hooks/pre-commit.mjs', /docs-refresh\.mjs/],
    ['installer syncs contextkit README through the manifest-safe path', 'tools/install/engine.mjs', /syncFile\(join\(tplDir, 'contextkit', 'README\.md'\)/],
];
