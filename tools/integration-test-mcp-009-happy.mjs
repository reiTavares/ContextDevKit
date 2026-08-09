/**
 * integration-test-mcp-009-happy.mjs — MCP-009 AC#2: happy-path task→server mappings
 *
 * Covers:
 *   Suite 3 — "fix-ui" → playwright+github+figma; no postgres (sync, pure)
 *   Suite 4 — "migration" → postgres+github; no figma/playwright (sync, pure)
 *
 * Both suites use resolveActivationSync (deterministic, no policy noise) to
 * verify the task→server mapping rules in isolation.
 *
 * Standalone: node tools/integration-test-mcp-009-happy.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import { FULL_MANIFEST, loadActivationModule } from './integration-test-mcp-009-helpers.mjs';

const SUITE_LABEL = 'MCP-009 happy-path task→server mapping (integration)';
const rep = reporter();

const { resolveActivationSync } = await loadActivationModule(rep, SUITE_LABEL);

// ── Suite 3 — AC#2: fix-ui mapping ───────────────────────────────────────────
console.log('\n[Suite 3] AC#2 — fix-ui → playwright+github+figma; NO postgres (sync, pure)');

{
  const result = resolveActivationSync({ taskType: 'fix-ui' }, FULL_MANIFEST);
  const ids = result.servers.map((s) => s.id);

  ids.includes('playwright')  ? rep.ok('3.1 playwright present')
    : rep.bad(`3.1 playwright missing. ids=${JSON.stringify(ids)}`);
  ids.includes('github')      ? rep.ok('3.2 github present')
    : rep.bad(`3.2 github missing. ids=${JSON.stringify(ids)}`);
  ids.includes('figma')       ? rep.ok('3.3 figma present')
    : rep.bad(`3.3 figma missing. ids=${JSON.stringify(ids)}`);
  !ids.includes('postgres')   ? rep.ok('3.4 postgres NOT exposed (AC#2)')
    : rep.bad('3.4 postgres must NOT appear in fix-ui result');

  const pwTools = result.allowedTools['playwright'] ?? [];
  pwTools.includes('navigate')
    ? rep.ok('3.5 playwright allowedTools includes navigate (write-capable tool)')
    : rep.bad(`3.5 navigate missing from playwright tools: ${JSON.stringify(pwTools)}`);

  const ghTools = result.allowedTools['github'] ?? [];
  const WRITE_TOOLS = ['create_pull_request', 'create_issue', 'push', 'update_file'];
  const exposedWrite = WRITE_TOOLS.filter((t) => ghTools.includes(t));
  exposedWrite.length === 0
    ? rep.ok('3.6 github in fix-ui: no write tools exposed (read-only ceiling)')
    : rep.bad(`3.6 github write tools leaked: ${JSON.stringify(exposedWrite)}`);
}

// fix-ui alias variants
for (const [alias, label] of [
  ['ui',        '"ui"'],
  ['frontend',  '"frontend"'],
  ['component', '"component"'],
  ['visual',    '"visual"'],
]) {
  const ids = resolveActivationSync({ taskType: alias }, FULL_MANIFEST).servers.map((s) => s.id);
  ids.includes('playwright') && ids.includes('github') && ids.includes('figma')
    ? rep.ok(`3.7 alias ${label} hits fix-ui rule (playwright+github+figma)`)
    : rep.bad(`3.7 alias ${label} missed fix-ui rule. ids=${JSON.stringify(ids)}`);
}

// ── Suite 4 — AC#2: migration mapping ────────────────────────────────────────
console.log('\n[Suite 4] AC#2 — migration → postgres+github only; NO figma/playwright (sync, pure)');

{
  const result = resolveActivationSync({ taskType: 'migration' }, FULL_MANIFEST);
  const ids = result.servers.map((s) => s.id);

  ids.includes('postgres')    ? rep.ok('4.1 postgres present')
    : rep.bad(`4.1 postgres missing. ids=${JSON.stringify(ids)}`);
  ids.includes('github')      ? rep.ok('4.2 github present')
    : rep.bad(`4.2 github missing. ids=${JSON.stringify(ids)}`);
  !ids.includes('figma')      ? rep.ok('4.3 figma NOT exposed (AC#2 explicit exclusion)')
    : rep.bad('4.3 figma must NOT be in migration result (AC#2)');
  !ids.includes('playwright') ? rep.ok('4.4 playwright NOT exposed (no browser in migration)')
    : rep.bad('4.4 playwright must NOT be in migration result');

  const pgTools = result.allowedTools['postgres'] ?? [];
  pgTools.includes('query')
    ? rep.ok('4.5 postgres.allowedTools includes query')
    : rep.bad(`4.5 query missing from postgres tools: ${JSON.stringify(pgTools)}`);

  const PG_WRITE = ['insert', 'update', 'delete', 'execute', 'run', 'write'];
  const pgWrite = PG_WRITE.filter((t) => pgTools.includes(t));
  pgWrite.length === 0
    ? rep.ok('4.6 postgres: no write/mutating tools (read-only ceiling)')
    : rep.bad(`4.6 postgres exposed mutating tools: ${JSON.stringify(pgWrite)}`);
}

// migration alias variants
for (const [alias, label] of [
  ['db-migration',  '"db-migration"'],
  ['migrate',       '"migrate"'],
  ['schema-change', '"schema-change"'],
]) {
  const ids = resolveActivationSync({ taskType: alias }, FULL_MANIFEST).servers.map((s) => s.id);
  ids.includes('postgres') && !ids.includes('playwright') && !ids.includes('figma')
    ? rep.ok(`4.7 alias ${label} → postgres+github (no playwright/figma)`)
    : rep.bad(`4.7 alias ${label} wrong. ids=${JSON.stringify(ids)}`);
}

// ── Finish ────────────────────────────────────────────────────────────────────
rep.finish(SUITE_LABEL);
