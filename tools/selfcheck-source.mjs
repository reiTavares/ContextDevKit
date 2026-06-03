/**
 * Self-check — SOURCE / STRUCTURAL invariants.
 *
 * Owns the static-pattern checks that scan SHIPPED source files for
 * properties that would silently regress if removed:
 *   - `checkSourceInvariants`  — required patterns per file (timeouts,
 *     atomic writes, sid sanitization, single-sourced labels, etc.).
 *   - `checkNoHardcodedPaths`  — rule 4 enforcement (no `vibekit/` path
 *     constructed via `resolve(...)`/`join(...)` in shipped runtime/scripts).
 *   - `checkWorkflowsPinned`   — shipped GitHub Actions are SHA-pinned;
 *     CI declares least-privilege permissions.
 *
 * Split out of the legacy `selfcheck-checks.mjs` (ADR-0016 H1 / task 037 —
 * by invariant category). The recursive-`.mjs`-listing helper `listMjs`
 * lives here because this is the module that scans source trees; it is
 * imported by `selfcheck-agent-forge.mjs` for the same reason.
 *
 * Every function takes the reporter `rep` ({ ok, bad }) plus only what it
 * needs. Entry point: `runSourceChecks(rep, ctx)` where `ctx = { KIT }`.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const srcTextFor = (KIT) => (rel) => readFile(resolve(KIT, rel), 'utf-8').catch(() => '');

/** All `.mjs` under a directory, recursively. Shared with the agent-forge selfcheck. */
export async function listMjs(absDir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = resolve(absDir, e.name);
    if (e.isDirectory()) out.push(...(await listMjs(p)));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** Source-level invariants — structural guarantees that would silently regress. */
async function checkSourceInvariants(rep, KIT) {
  const { ok, bad } = rep;
  const srcText = srcTextFor(KIT);
  console.log('Checking source-level invariants...');
  const cases = [
    ['network git calls time out (git.mjs)', 'templates/vibekit/tools/scripts/git.mjs', /timeout:\s*\w/],
    ['network git calls time out (pre-push.mjs)', 'templates/vibekit/runtime/git-hooks/pre-push.mjs', /timeout:\s*\w/],
    ['ledger writes are atomic', 'templates/vibekit/runtime/hooks/ledger.mjs', /writeFileAtomic/],
    ['pipeline writers are atomic', 'templates/vibekit/tools/scripts/pipeline.mjs', /writeFileAtomicSync/],
    ['workspace-sync write is atomic', 'templates/vibekit/tools/scripts/workspace-sync.mjs', /writeFileAtomic/],
    ['pipeline allocates ids with exclusive create', 'templates/vibekit/tools/scripts/pipeline.mjs', /flag:\s*'wx'/],
    ['claim sanitizes the session id', 'templates/vibekit/tools/scripts/claim.mjs', /sanitizeSid/],
    ['release sanitizes the session id', 'templates/vibekit/tools/scripts/release.mjs', /sanitizeSid/],
    ['track-edits sanitizes the session id', 'templates/vibekit/runtime/hooks/track-edits.mjs', /sanitizeSid/],
    ['session-start guards live ledgers from deletion', 'templates/vibekit/runtime/hooks/session-start.mjs', /maybeLive/],
    ['config schema is passthrough', 'templates/vibekit/runtime/config/schema.mjs', /\.passthrough\(\)/],
    ['config schema bounds level by MAX_LEVEL', 'templates/vibekit/runtime/config/schema.mjs', /max\(MAX_LEVEL\)/],
    ['installer labels single-sourced from levels.mjs', 'tools/install/cli.mjs', /levels\.mjs/],
    ['vibe-level labels single-sourced from levels.mjs', 'templates/vibekit/tools/scripts/vibe-level.mjs', /levels\.mjs/],
    ['squad detection single-sourced (squad.mjs)', 'templates/vibekit/tools/scripts/squad.mjs', /squad-meta/],
    ['squad detection single-sourced (agent-tuning.mjs)', 'templates/vibekit/tools/scripts/agent-tuning.mjs', /squad-meta/],
    ['installer backs up an existing git hook', 'tools/install/git.mjs', /\.bak/],
    ['installer follows .git pointer in worktrees (bug 038)', 'tools/install/git.mjs', /resolveGitDir/],
    ['installer parses the gitdir: pointer', 'tools/install/git.mjs', /gitdir:\\s\*\(\.\+\)/],
    ['agent-forge yaml loader uses optional dynamic import', 'templates/vibekit/squads/agent-forge/lib/yaml.mjs', /import\(\s*['"]yaml['"]\s*\)/],
    ['installer copies the agent-forge squad at L>=4', 'install.mjs', /copyTree\(join\(TPL, 'vibekit', 'squads', 'agent-forge'\)/],
    ['installer copies curated-stack starters', 'install.mjs', /copyTree\(join\(TPL, 'vibekit', 'starters'\)/],
    ['detect-stack recognises TanStack family', 'templates/vibekit/tools/scripts/detect-stack.mjs', /@tanstack\/react-router/],
    ['tanstack playbook present', 'templates/vibekit/workflows/playbooks/tanstack.md', /Playbook — TanStack/],
    ['tanstack starter declares react-router dep', 'templates/vibekit/starters/tanstack/package.json', /@tanstack\/react-router/],
    ['tanstack starter declares react-query dep', 'templates/vibekit/starters/tanstack/package.json', /@tanstack\/react-query/],
    ['tanstack starter mounts QueryClientProvider', 'templates/vibekit/starters/tanstack/src/main.tsx', /QueryClientProvider/],
    ['tanstack starter mounts RouterProvider', 'templates/vibekit/starters/tanstack/src/main.tsx', /RouterProvider/],
    // ADR-0015 §B — DevPipeline working/ stage.
    ['pipeline STAGES includes working (ADR-0015 §B)', 'templates/vibekit/tools/scripts/pipeline.mjs', /STAGES\s*=\s*\{[^}]*working:\s*'working'/],
    ['pipeline STATUS includes working', 'templates/vibekit/tools/scripts/pipeline.mjs', /STATUS\s*=\s*\{[^}]*working:\s*'working'/],
    ['pipeline.mjs wires start subcommand (ADR-0015 §B)', 'templates/vibekit/tools/scripts/pipeline.mjs', /cmd === 'start'/],
    ['pipeline.mjs wires stop subcommand', 'templates/vibekit/tools/scripts/pipeline.mjs', /cmd === 'stop'/],
    ['claim.mjs exports attachTask (ADR-0015 §B)', 'templates/vibekit/tools/scripts/claim.mjs', /export async function attachTask/],
    ['claim.mjs exports detachTask', 'templates/vibekit/tools/scripts/claim.mjs', /export async function detachTask/],
    ['workspace-sync evicts stale tasks (ADR-0015 §B)', 'templates/vibekit/tools/scripts/workspace-sync.mjs', /evictStaleTasks/],
    ['pipeline-board renders the Working stage', 'templates/vibekit/tools/scripts/pipeline-board.mjs', /## 🔵 Working/],
    ['defaults expose workingStaleAfterMinutes', 'templates/vibekit/runtime/config/defaults.mjs', /workingStaleAfterMinutes:\s*\d+/],
    // ADR-0015 §C — canonical state.json substrate + /runs command.
    ['state-io exports readState (ADR-0015 §C)', 'templates/vibekit/runtime/state/state-io.mjs', /export function readState/],
    ['state-io exports writeState', 'templates/vibekit/runtime/state/state-io.mjs', /export function writeState/],
    ['state-io exports listStates', 'templates/vibekit/runtime/state/state-io.mjs', /export function listStates/],
    ['state-io exports prune', 'templates/vibekit/runtime/state/state-io.mjs', /export function prune/],
    ['pipeline-session stamps state.json on start (ADR-0015 §C)', 'templates/vibekit/tools/scripts/pipeline-session.mjs', /writeState\(pipeDir,\s*id,\s*\{\s*kind:\s*'task'/],
    ['pipeline-session stamps endedAt on stop', 'templates/vibekit/tools/scripts/pipeline-session.mjs', /endedAt:\s*Date\.now\(\)/],
    ['workspace-sync mirrors heartbeat into state.json', 'templates/vibekit/tools/scripts/workspace-sync.mjs', /lastHeartbeat:\s*task\.lastHeartbeat/],
    ['/runs reads listStates from state-io (ADR-0015 §C follow-up)', 'templates/vibekit/tools/scripts/runs.mjs', /import\s*\{\s*listStates\s*\}\s*from\s*['"]\.\.\/\.\.\/runtime\/state\/state-io\.mjs/],
    ['/runs supports --kind filter', 'templates/vibekit/tools/scripts/runs.mjs', /\bkind:\s*kindFilter/],
    ['/runs supports --json output', 'templates/vibekit/tools/scripts/runs.mjs', /flag\(['"]json['"]\)/],
    ['/runs refuses cleanly when no states exist', 'templates/vibekit/tools/scripts/runs.mjs', /No runs yet/],
    ['/runs command briefing ships', 'templates/claude/commands/pipeline/runs.md', /Lists the \*\*last N in-flight items\*\*/],
    // ADR-0019 — MCP injection convention seeded in agent template (commented).
    ['agent _TEMPLATE documents mcpServers convention (ADR-0019)', 'templates/claude/agents/_TEMPLATE.md', /mcpServers/],
    ['agent _TEMPLATE flags rationale requirement (ADR-0019)', 'templates/claude/agents/_TEMPLATE.md', /rationale/],
    // ADR-0021 — review-provider adapter contract + seed adapter.
    ['provider _adapter exports validateAdapter (ADR-0021)', 'templates/vibekit/runtime/providers/review/_adapter.mjs', /export function validateAdapter/],
    ['provider _adapter defines ProviderError (ADR-0021)', 'templates/vibekit/runtime/providers/review/_adapter.mjs', /export class ProviderError/],
    ['provider gh adapter declares id (ADR-0021)', 'templates/vibekit/runtime/providers/review/gh.mjs', /export const id\s*=\s*'gh'/],
    ['provider gh adapter declares cliBinary (ADR-0021)', 'templates/vibekit/runtime/providers/review/gh.mjs', /export const cliBinary/],
    ['provider gh adapter exports detectsRemote (ADR-0021)', 'templates/vibekit/runtime/providers/review/gh.mjs', /export const detectsRemote/],
    ['provider gh adapter exports createPullRequest (ADR-0021)', 'templates/vibekit/runtime/providers/review/gh.mjs', /export async function createPullRequest/],
    ['provider detect exports resolveAdapter (ADR-0021)', 'templates/vibekit/runtime/providers/review/detect.mjs', /export async function resolveAdapter/],
    // Ticket 045 — /watch slash command + script.
    ['watch script exports parseLedgerEntry (ticket 045)', 'templates/vibekit/tools/scripts/watch.mjs', /export function parseLedgerEntry/],
    ['watch command file present (ticket 045)', 'templates/claude/commands/watch.md', /watch the active session ledger/i],
    // Ticket 042 — two-tier memory: per-task scratch gitignored under pipeline/.
    ['pipeline .gitignore excludes scratch files (ticket 042)', 'templates/vibekit/pipeline/.gitignore', /\*\.scratch\.md/],
    ['dev-start documents per-task scratch convention (ticket 042)', 'templates/claude/commands/pipeline/dev-start.md', /scratch\.md/],
    // Ticket 048 / ADR-0020 — home.mjs helper for ~/.vibedevkit/ access.
    ['home.mjs exports resolveHome (ADR-0020)', 'templates/vibekit/tools/scripts/home.mjs', /export function resolveHome/],
    ['home.mjs exports readHomeFile (ADR-0020)', 'templates/vibekit/tools/scripts/home.mjs', /export function readHomeFile/],
    ['home.mjs exports writeHomeFile (ADR-0020)', 'templates/vibekit/tools/scripts/home.mjs', /export function writeHomeFile/],
    ['home.mjs writes atomically via renameSync (ADR-0020)', 'templates/vibekit/tools/scripts/home.mjs', /renameSync\(tmp, path\)/],
    ['home.mjs honours VIBEDEVKIT_HOME override (ADR-0020)', 'templates/vibekit/tools/scripts/home.mjs', /VIBEDEVKIT_HOME/],
    ['fleet.mjs delegates to home helper (ticket 048)', 'templates/vibekit/tools/scripts/fleet.mjs', /from '\.\/home\.mjs'/],
    // Ticket 051 — /dashboard (snapshot + --watch live mode).
    ['dashboard-data exports buildDashboardData (ticket 051)', 'templates/vibekit/tools/scripts/dashboard-data.mjs', /export function buildDashboardData/],
    ['dashboard-data exports parseFrontmatter helper', 'templates/vibekit/tools/scripts/dashboard-data.mjs', /export function parseFrontmatter/],
    ['dashboard-data single-sources PLATFORM_DIR (rule 4)', 'templates/vibekit/tools/scripts/dashboard-data.mjs', /PLATFORM_DIR/],
    ['dashboard-html exports renderDashboardHTML (ticket 051)', 'templates/vibekit/tools/scripts/dashboard-html.mjs', /export function renderDashboardHTML/],
    ['dashboard-html escapes user content', 'templates/vibekit/tools/scripts/dashboard-html.mjs', /escapeHtml/],
    ['dashboard-server exports startDashboardServer', 'templates/vibekit/tools/scripts/dashboard-server.mjs', /export async function startDashboardServer/],
    ['dashboard-server exports resolvePort', 'templates/vibekit/tools/scripts/dashboard-server.mjs', /export function resolvePort/],
    ['dashboard-server binds 127.0.0.1 only (no remote access)', 'templates/vibekit/tools/scripts/dashboard-server.mjs', /listen\(port,\s*'127\.0\.0\.1'/],
    ['dashboard-server emits SSE Content-Type', 'templates/vibekit/tools/scripts/dashboard-server.mjs', /text\/event-stream/],
    ['dashboard.mjs dispatches snapshot vs --watch', 'templates/vibekit/tools/scripts/dashboard.mjs', /WANT_WATCH\s*\?\s*runLive/],
    ['dashboard command file ships (ticket 051)', 'templates/claude/commands/dashboard.md', /Visual dashboard/i],
    // Ticket 040 — task metadata v2 (DAG dependencies + complexity + extended types).
    ['pipeline-validate exports detectCycles (ticket 040)', 'templates/vibekit/tools/scripts/pipeline-validate.mjs', /export function detectCycles/],
    ['pipeline-validate exports blockedBy', 'templates/vibekit/tools/scripts/pipeline-validate.mjs', /export function blockedBy/],
    ['pipeline-validate exports parseInlineArray', 'templates/vibekit/tools/scripts/pipeline-validate.mjs', /export function parseInlineArray/],
    ['pipeline-validate enum covers spike + docs (ticket 040)', 'templates/vibekit/tools/scripts/pipeline-validate.mjs', /VALID_TYPES.*spike.*docs|VALID_TYPES.*docs.*spike/s],
    ['pipeline.mjs writes complexity + dependencies fields', 'templates/vibekit/tools/scripts/pipeline.mjs', /complexity:\s*\$\{complexity\}/],
    ['pipeline.mjs parses dependencies inline array', 'templates/vibekit/tools/scripts/pipeline.mjs', /parseInlineArray\(fm\.dependencies\)/],
    ['pipeline.mjs wires validate subcommand', 'templates/vibekit/tools/scripts/pipeline.mjs', /cmd === 'validate'/],
    ['pipeline-board renders blocked-by hint', 'templates/vibekit/tools/scripts/pipeline-board.mjs', /blocked by/],
    // Ticket 046 — /resume for interrupted sessions.
    ['/resume reads listAllLedgers from runtime (ticket 046)', 'templates/vibekit/tools/scripts/resume.mjs', /import.*listAllLedgers.*runtime\/hooks\/ledger\.mjs/],
    ['/resume refuses unknown session id', 'templates/vibekit/tools/scripts/resume.mjs', /not found among unregistered drift candidates/],
    ['/resume refuses cross-session claim conflict', 'templates/vibekit/tools/scripts/resume.mjs', /claimed by another active session/],
    ['/resume rewrites LAST_TOUCHED_PATH atomically', 'templates/vibekit/tools/scripts/resume.mjs', /writeFileAtomicSync\(LAST_TOUCHED_PATH/],
    ['/resume command briefing ships', 'templates/claude/commands/pipeline/resume.md', /Re-bind the current Claude Code session/],
    // Ticket 043 — distill-detect proposal-only at /log-session end.
    ['distill-detect exports detect (ticket 043)', 'templates/vibekit/tools/scripts/distill-detect.mjs', /export function detect/],
    ['distill-detect surfaces "we decided" pattern', 'templates/vibekit/tools/scripts/distill-detect.mjs', /we\|i\)\\s\+decided/],
    ['distill-detect surfaces "from now on" pattern', 'templates/vibekit/tools/scripts/distill-detect.mjs', /from now on/],
    ['log-session briefing wires distill-detect (ticket 043)', 'templates/claude/commands/log-session.md', /distill-detect\.mjs/],
    ['log-session briefing flags distill as proposal-only', 'templates/claude/commands/log-session.md', /proposal-only/],
    // Ticket 041 — /workflow macro chains roadmap → ADR → pipeline → ship.
    ['workflow.mjs ships 4 phases (ticket 041)', 'templates/vibekit/tools/scripts/workflow.mjs', /PHASES\s*=\s*\['roadmap',\s*'adr',\s*'tickets',\s*'ship'\]/],
    ['workflow.mjs exposes new subcommand', 'templates/vibekit/tools/scripts/workflow.mjs', /cmd === 'new'/],
    ['workflow.mjs exposes advance subcommand', 'templates/vibekit/tools/scripts/workflow.mjs', /cmd === 'advance'/],
    ['workflow.mjs exposes status subcommand', 'templates/vibekit/tools/scripts/workflow.mjs', /cmd === 'status'/],
    ['workflow.mjs slug regex blocks invalid slugs', 'templates/vibekit/tools/scripts/workflow.mjs', /SLUG_RE\s*=\s*\/\^/],
    ['/workflow command briefing ships (ticket 041)', 'templates/claude/commands/pipeline/workflow.md', /chain \/roadmap → \/new-adr → \/pipeline → \/ship/],
  ];
  for (const [label, rel, re] of cases) {
    re.test(await srcText(rel)) ? ok(label) : bad(`${label} — pattern ${re} missing in ${rel}`);
  }
}

/** Rule 4: no shipped runtime/script constructs a `vibekit/` path via resolve/join. */
async function checkNoHardcodedPaths(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking platform paths are single-sourced (rule 4)...');
  const re = /\b(resolve|join)\(.*['"]vibekit\//;
  const offenders = [];
  for (const d of ['templates/vibekit/runtime', 'templates/vibekit/tools/scripts']) {
    for (const file of await listMjs(resolve(KIT, d))) {
      const lines = (await readFile(file, 'utf-8').catch(() => '')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (re.test(line)) offenders.push(`${file.replace(KIT, '').replaceAll('\\', '/')}:${i + 1}`);
      });
    }
  }
  offenders.length === 0
    ? ok('no hardcoded vibekit/ path construction (all via pathsFor/PLATFORM_DIR)')
    : offenders.forEach((o) => bad(`hardcoded vibekit/ path: ${o}`));
}

/** Shipped GitHub Actions must be SHA-pinned; CI must be least-privilege. */
async function checkWorkflowsPinned(rep, KIT) {
  const { ok, bad } = rep;
  const srcText = srcTextFor(KIT);
  console.log('Checking GitHub Actions are SHA-pinned...');
  const files = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'templates/github/workflows/quality.yml',
    'templates/github/workflows/security.yml',
  ];
  const floating = /uses:\s*[\w./-]+@v\d/;
  for (const rel of files) {
    const text = await srcText(rel);
    if (!text) {
      bad(`workflow missing: ${rel}`);
      continue;
    }
    floating.test(text) ? bad(`${rel} has an unpinned (floating) action tag`) : ok(`${rel} actions are SHA-pinned`);
  }
  /permissions:[\s\S]*?contents:\s*read/.test(await srcText('.github/workflows/ci.yml'))
    ? ok('ci.yml declares least-privilege permissions (contents: read)') : bad('ci.yml missing contents:read permissions');
}

/** Runs every source/structural check in order. `ctx` = { KIT }. */
export async function runSourceChecks(rep, { KIT }) {
  await checkSourceInvariants(rep, KIT);
  await checkNoHardcodedPaths(rep, KIT);
  await checkWorkflowsPinned(rep, KIT);
}
