/**
 * integration-test-mcp-009-table.mjs — MCP-009 AC#1/AC#5: table-driven mapping,
 * normalisation, determinism, and ACTIVATION_TABLE completeness.
 *
 * Covers:
 *   Suite 8  — AC#5 table-driven task→server mappings (resolveActivationSync)
 *   Suite 9  — AC#1 task-type normalisation (case, underscores, extra spaces)
 *   Suite 10 — AC#1 pure + deterministic (same inputs → identical output)
 *   Suite 11 — AC#5 ACTIVATION_TABLE export shape + completeness
 *
 * Standalone: node tools/integration-test-mcp-009-table.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import { FULL_MANIFEST, loadActivationModule } from './integration-test-mcp-009-helpers.mjs';

const SUITE_LABEL = 'MCP-009 table+normalisation+determinism (integration)';
const rep = reporter();

const { resolveActivationSync, ACTIVATION_TABLE } = await loadActivationModule(rep, SUITE_LABEL);

// ── Suite 8 — AC#5: table-driven task→server mappings ────────────────────────
console.log('\n[Suite 8] AC#5 — table-driven task→server mappings (sync, deterministic)');

/** @type {Array<{label:string, ctx:object, mustInclude:string[], mustExclude:string[]}>} */
const MAPPING_TABLE = [
  // UI / frontend
  { label: 'fix-ui → playwright+github+figma',
    ctx: { taskType: 'fix-ui' },     mustInclude: ['playwright','github','figma'], mustExclude: ['postgres'] },
  { label: 'ui → playwright+github+figma',
    ctx: { taskType: 'ui' },         mustInclude: ['playwright','github','figma'], mustExclude: ['postgres'] },
  { label: 'frontend → playwright+github+figma',
    ctx: { taskType: 'frontend' },   mustInclude: ['playwright','github','figma'], mustExclude: ['postgres'] },
  { label: 'component → playwright+github+figma',
    ctx: { taskType: 'component' },  mustInclude: ['playwright','github','figma'], mustExclude: ['postgres'] },
  { label: 'style → playwright+github+figma',
    ctx: { taskType: 'style' },      mustInclude: ['playwright','github','figma'], mustExclude: ['postgres'] },
  { label: 'visual → playwright+github+figma',
    ctx: { taskType: 'visual' },     mustInclude: ['playwright','github','figma'], mustExclude: ['postgres'] },
  // Database migrations
  { label: 'migration → postgres+github (no figma, no playwright)',
    ctx: { taskType: 'migration' },    mustInclude: ['postgres','github'], mustExclude: ['playwright','figma'] },
  { label: 'migrate → postgres+github',
    ctx: { taskType: 'migrate' },      mustInclude: ['postgres','github'], mustExclude: ['playwright','figma'] },
  { label: 'db-migration → postgres+github',
    ctx: { taskType: 'db-migration' }, mustInclude: ['postgres','github'], mustExclude: ['playwright','figma'] },
  { label: 'schema-change → postgres+github',
    ctx: { taskType: 'schema-change' },mustInclude: ['postgres','github'], mustExclude: ['playwright','figma'] },
  // Backend / API
  { label: 'backend → github+postgres',
    ctx: { taskType: 'backend' },   mustInclude: ['github','postgres'], mustExclude: ['playwright','figma'] },
  { label: 'api → github+postgres',
    ctx: { taskType: 'api' },       mustInclude: ['github','postgres'], mustExclude: ['playwright','figma'] },
  { label: 'service → github+postgres',
    ctx: { taskType: 'service' },   mustInclude: ['github','postgres'], mustExclude: ['playwright','figma'] },
  { label: 'endpoint → github+postgres',
    ctx: { taskType: 'endpoint' },  mustInclude: ['github','postgres'], mustExclude: ['playwright','figma'] },
  // Code review
  { label: 'review → github only',
    ctx: { taskType: 'review' },      mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  { label: 'pr-review → github only',
    ctx: { taskType: 'pr-review' },   mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  { label: 'code-review → github only',
    ctx: { taskType: 'code-review' }, mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  // QA / testing
  { label: 'test → playwright+github',
    ctx: { taskType: 'test' },             mustInclude: ['playwright','github'], mustExclude: ['figma','postgres'] },
  { label: 'e2e → playwright+github',
    ctx: { taskType: 'e2e' },              mustInclude: ['playwright','github'], mustExclude: ['figma','postgres'] },
  { label: 'integration-test → playwright+github',
    ctx: { taskType: 'integration-test' }, mustInclude: ['playwright','github'], mustExclude: ['figma','postgres'] },
  { label: 'qa → playwright+github',
    ctx: { taskType: 'qa' },               mustInclude: ['playwright','github'], mustExclude: ['figma','postgres'] },
  // Security audit
  { label: 'security → github only',
    ctx: { taskType: 'security' },   mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  { label: 'audit → github only',
    ctx: { taskType: 'audit' },      mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  { label: 'deps-audit → github only',
    ctx: { taskType: 'deps-audit' }, mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  // Documentation / design
  { label: 'docs → figma+github',
    ctx: { taskType: 'docs' },          mustInclude: ['figma','github'], mustExclude: ['playwright','postgres'] },
  { label: 'documentation → figma+github',
    ctx: { taskType: 'documentation' }, mustInclude: ['figma','github'], mustExclude: ['playwright','postgres'] },
  { label: 'design → figma+github',
    ctx: { taskType: 'design' },        mustInclude: ['figma','github'], mustExclude: ['playwright','postgres'] },
  { label: 'wireframe → figma+github',
    ctx: { taskType: 'wireframe' },     mustInclude: ['figma','github'], mustExclude: ['playwright','postgres'] },
  // Deploy / ship
  { label: 'deploy → github only',
    ctx: { taskType: 'deploy' },  mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  { label: 'ship → github only',
    ctx: { taskType: 'ship' },    mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  { label: 'release → github only',
    ctx: { taskType: 'release' }, mustInclude: ['github'], mustExclude: ['playwright','figma','postgres'] },
  // Unknown task → safe empty
  { label: 'unknown task → empty result (no always-on default)',
    ctx: { taskType: 'xyzzy-no-match-task-9999' },
    mustInclude: [], mustExclude: ['playwright','github','figma','postgres'] },
];

for (const { label, ctx, mustInclude, mustExclude } of MAPPING_TABLE) {
  const result = resolveActivationSync(ctx, FULL_MANIFEST);
  const ids = result.servers.map((s) => s.id);
  const missing   = mustInclude.filter((id) => !ids.includes(id));
  const forbidden = mustExclude.filter((id) =>  ids.includes(id));
  if (missing.length === 0 && forbidden.length === 0) {
    rep.ok(`8. ${label}`);
  } else {
    const parts = [];
    if (missing.length   > 0) parts.push(`missing: [${missing.join(',')}]`);
    if (forbidden.length > 0) parts.push(`forbidden exposed: [${forbidden.join(',')}]`);
    rep.bad(`8. ${label} — ${parts.join('; ')} (got: [${ids.join(',')}])`);
  }
}

// ── Suite 9 — AC#1: normalisation ────────────────────────────────────────────
console.log('\n[Suite 9] AC#1 — task-type normalisation (case / underscore / whitespace)');

const NORM_CASES = [
  { input: 'Fix_UI',     expectRule: 'fix-ui',    check: (ids) => ids.includes('playwright') },
  { input: 'FIX-UI',    expectRule: 'fix-ui',    check: (ids) => ids.includes('playwright') },
  { input: ' fix-ui ',  expectRule: 'fix-ui',    check: (ids) => ids.includes('playwright') },
  { input: 'MIGRATION', expectRule: 'migration',
    check: (ids) => ids.includes('postgres') && !ids.includes('playwright') },
  { input: 'REVIEW',    expectRule: 'review',
    check: (ids) => ids.includes('github')   && !ids.includes('playwright') },
];

for (const { input, expectRule, check } of NORM_CASES) {
  const ids = resolveActivationSync({ taskType: input }, FULL_MANIFEST).servers.map((s) => s.id);
  check(ids)
    ? rep.ok(`9. normalised "${input}" → ${expectRule} rule applied correctly`)
    : rep.bad(`9. normalised "${input}" did not hit ${expectRule} rule. ids=${JSON.stringify(ids)}`);
}

// ── Suite 10 — AC#1: pure + deterministic ────────────────────────────────────
console.log('\n[Suite 10] AC#1 — pure + deterministic (same inputs → identical output)');

{
  const r1 = resolveActivationSync({ taskType: 'fix-ui' }, FULL_MANIFEST);
  const r2 = resolveActivationSync({ taskType: 'fix-ui' }, FULL_MANIFEST);
  const r3 = resolveActivationSync({ taskType: 'migration' }, FULL_MANIFEST);
  const r4 = resolveActivationSync({ taskType: 'migration' }, FULL_MANIFEST);

  JSON.stringify(r1.servers.map((s) => s.id)) === JSON.stringify(r2.servers.map((s) => s.id))
    ? rep.ok('10.1 fix-ui: same server ids on repeated calls')
    : rep.bad('10.1 fix-ui: non-deterministic server ids');

  JSON.stringify(r1.allowedTools) === JSON.stringify(r2.allowedTools)
    ? rep.ok('10.2 fix-ui: same allowedTools on repeated calls')
    : rep.bad('10.2 fix-ui: non-deterministic allowedTools');

  JSON.stringify(r3.servers.map((s) => s.id)) === JSON.stringify(r4.servers.map((s) => s.id))
    ? rep.ok('10.3 migration: same server ids on repeated calls')
    : rep.bad('10.3 migration: non-deterministic server ids');
}

// ── Suite 11 — AC#5: ACTIVATION_TABLE export completeness ────────────────────
console.log('\n[Suite 11] AC#5 — ACTIVATION_TABLE export completeness');

{
  Array.isArray(ACTIVATION_TABLE)
    ? rep.ok('11.1 ACTIVATION_TABLE exported as array')
    : rep.bad('11.1 ACTIVATION_TABLE missing or not array');

  ACTIVATION_TABLE.length >= 7
    ? rep.ok(`11.2 ACTIVATION_TABLE has ${ACTIVATION_TABLE.length} rules (≥7)`)
    : rep.bad(`11.2 ACTIVATION_TABLE too short: ${ACTIVATION_TABLE.length}`);

  for (const rule of ACTIVATION_TABLE) {
    const tag = `rule[${rule.taskPatterns?.[0] ?? '?'}]`;
    const hasPatterns = Array.isArray(rule.taskPatterns) && rule.taskPatterns.length > 0;
    const hasServers  = Array.isArray(rule.servers)      && rule.servers.length > 0;
    const allHaveId   = (rule.servers ?? []).every((s) => typeof s.id === 'string' && s.id.length > 0);
    hasPatterns ? rep.ok(`11. ${tag}: taskPatterns present`)       : rep.bad(`11. ${tag}: taskPatterns missing`);
    hasServers  ? rep.ok(`11. ${tag}: servers non-empty`)          : rep.bad(`11. ${tag}: servers array empty`);
    allHaveId   ? rep.ok(`11. ${tag}: all servers have string id`) : rep.bad(`11. ${tag}: a server lacks string id`);
  }

  // AC#2 structural check: migration rule must NOT list figma or playwright
  const migRule = ACTIVATION_TABLE.find((r) => r.taskPatterns.includes('migration'));
  if (migRule) {
    const figmaOrBrowser = migRule.servers.some((s) => ['figma', 'playwright'].includes(s.id));
    !figmaOrBrowser
      ? rep.ok('11.3 migration rule: figma + playwright absent from server list (AC#2)')
      : rep.bad('11.3 migration rule erroneously includes figma or playwright (AC#2 violation in table)');
  } else {
    rep.bad('11.3 migration rule not found in ACTIVATION_TABLE');
  }

  // AC#2 structural check: fix-ui rule must list playwright, github, figma
  const uiRule = ACTIVATION_TABLE.find((r) => r.taskPatterns.includes('fix-ui'));
  if (uiRule) {
    const serverIds = uiRule.servers.map((s) => s.id);
    const hasAll = ['playwright', 'github', 'figma'].every((id) => serverIds.includes(id));
    hasAll
      ? rep.ok('11.4 fix-ui rule: playwright+github+figma all declared (AC#2)')
      : rep.bad(`11.4 fix-ui rule missing expected servers. found: ${JSON.stringify(serverIds)}`);
  } else {
    rep.bad('11.4 fix-ui rule not found in ACTIVATION_TABLE');
  }
}

// ── Finish ────────────────────────────────────────────────────────────────────
rep.finish(SUITE_LABEL);
