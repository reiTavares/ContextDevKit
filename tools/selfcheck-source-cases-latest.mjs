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
];
