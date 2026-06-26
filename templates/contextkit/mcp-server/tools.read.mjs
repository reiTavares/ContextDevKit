/**
 * MCP-006 read-only tool implementations.
 *
 * Cohesion note (constitution §1 +10% tolerance): all 10 tool functions share
 * the same responsibility — "read a kit artifact and return structured data."
 * The private helpers (readLatestSession, readActiveClaims, readAdrCatalog)
 * are intentionally file-local; extracting them would create a fourth file
 * with no real consumer beyond this one. The seam to split would be if a
 * second consumer of these helpers emerged.
 *
 * Each exported function matches one tool declared in server.mjs. All are:
 *   - read-only (no mutation, no atomic writes)
 *   - best-effort (returns { error } on missing artifacts, never throws)
 *   - zero-dep (node:* only)
 *
 * Delegates to existing kit scripts where possible; falls back to direct
 * artifact reads for things with no exported API. [MCP-006, ADR-0073]
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathsFor } from '../runtime/config/paths.mjs';
import { loadConfigSync } from '../runtime/config/load.mjs';
import { listTasks } from '../tools/scripts/pipeline-tasks.mjs';
import { parseAdr, renderCatalogLine, ADR_FILENAME_RE } from '../tools/scripts/adr-digest-core.mjs';

/** Root of the project this server is running against. */
const ROOT = process.cwd();
const P = pathsFor(ROOT);

const readSafe = (abs) => readFile(abs, 'utf-8').catch(() => null);

/**
 * Reads the SESSIONS.md index and the newest session file. Returns both so
 * the caller can choose which level of detail to include.
 * @returns {Promise<{index: string|null, latest: string|null, filename: string|null}>}
 */
async function readLatestSession() {
  const ENTRY_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2,})-([a-z0-9._-]+)\.md$/;
  let files = [];
  try { files = await readdir(P.sessions); } catch { return { index: null, latest: null, filename: null }; }
  const entries = files
    .map((f) => ENTRY_RE.exec(f))
    .filter(Boolean)
    .map((m) => ({ filename: m[0], date: m[1], num: Number.parseInt(m[2], 10) }))
    .sort((a, b) => b.num - a.num || b.date.localeCompare(a.date));
  if (!entries.length) return { index: null, latest: null, filename: null };
  const filename = entries[0].filename;
  const [index, latest] = await Promise.all([
    readSafe(P.sessionsIndex),
    readSafe(resolve(P.sessions, filename)),
  ]);
  return { index, latest, filename };
}

/**
 * Lists open workspace claims from the per-session JSON files. Returns the
 * structured array rather than a string so the caller can serialize as needed.
 * @returns {Promise<Array<{sessionId: string, branch: string, claims: string[]}>>}
 */
async function readActiveClaims() {
  let files = [];
  try { files = await readdir(P.workspaceStateDir); } catch { return []; }
  const sessions = [];
  for (const name of files.filter((f) => f.endsWith('.json'))) {
    const text = await readSafe(resolve(P.workspaceStateDir, name));
    if (!text) continue;
    try {
      const ws = JSON.parse(text);
      const claims = (ws.claims || []).map((c) => (typeof c === 'string' ? c : c?.path || '')).filter(Boolean);
      if (claims.length || ws.sessionId) {
        sessions.push({ sessionId: ws.sessionId || name, branch: ws.branch || '', claims, tasks: ws.tasks || [] });
      }
    } catch { /* skip corrupt file */ }
  }
  return sessions;
}

/**
 * Lists ADR files from the decisions directory; returns catalog lines.
 * @param {number} [limit] - max number of ADRs to return (newest first)
 * @returns {Promise<Array<object>>}
 */
async function readAdrCatalog(limit = 50) {
  let files = [];
  try { files = await readdir(P.decisions); } catch { return []; }
  const sorted = files
    .filter((f) => ADR_FILENAME_RE.test(f) && f !== '_TEMPLATE.md')
    .sort()
    .reverse()
    .slice(0, limit);
  const catalog = [];
  for (const name of sorted) {
    const text = await readSafe(resolve(P.decisions, name));
    if (text !== null) catalog.push({ ...parseAdr(text, name), file: name });
  }
  return catalog;
}

// ─── Tool implementations ────────────────────────────────────────────────────

/**
 * get_project_state — config + level + recent ADR count.
 * @returns {Promise<object>}
 */
export async function getProjectState() {
  try {
    const config = loadConfigSync(ROOT);
    const level = config.level ?? config.contextLevel ?? 1;
    let adrCount = 0;
    try { adrCount = (await readdir(P.decisions)).filter((f) => ADR_FILENAME_RE.test(f) && f !== '_TEMPLATE.md').length; } catch { /* skip */ }
    return { level, config: { ...config }, adrCount, root: ROOT };
  } catch (err) {
    return { error: String(err.message) };
  }
}

/**
 * get_project_map — reads the saved manifest.json from memory/project-map/.
 * @returns {Promise<object>}
 */
export async function getProjectMap() {
  const manifestPath = resolve(P.projectMap, 'manifest.json');
  const text = await readSafe(manifestPath);
  if (!text) return { error: 'No project map found. Run /project-map to generate one.' };
  try { return JSON.parse(text); } catch { return { error: 'project-map manifest.json is corrupt' }; }
}

/**
 * get_module_context — returns the summary and symbol list for a given module path.
 * @param {object} params
 * @param {string} params.modulePath - relative path to the module
 * @returns {Promise<object>}
 */
export async function getModuleContext({ modulePath } = {}) {
  if (!modulePath) return { error: 'modulePath is required' };
  const manifestPath = resolve(P.projectMap, 'manifest.json');
  const text = await readSafe(manifestPath);
  if (!text) return { error: 'No project map found. Run /project-map to generate one.' };
  let manifest;
  try { manifest = JSON.parse(text); } catch { return { error: 'manifest.json is corrupt' }; }
  const modules = manifest.modules || [];
  const mod = modules.find((m) => m.path === modulePath || m.path?.includes(modulePath));
  if (!mod) return { error: `Module not found: ${modulePath}`, availableCount: modules.length };
  return mod;
}

/**
 * get_workflow_status — lists workflows and their current phases.
 * @param {object} params
 * @param {string} [params.slug] - optional workflow slug to filter
 * @returns {Promise<object>}
 */
export async function getWorkflowStatus({ slug } = {}) {
  const workflowsDir = resolve(P.memory, 'workflows');
  let entries = [];
  try { entries = await readdir(workflowsDir); } catch { return { workflows: [], error: 'No workflows directory' }; }
  const workflows = [];
  for (const entry of entries) {
    if (slug && !entry.includes(slug)) continue;
    const indexPath = resolve(workflowsDir, entry, 'index.md');
    const legacyPath = resolve(workflowsDir, `${entry}.md`);
    const text = (await readSafe(indexPath)) ?? (await readSafe(legacyPath));
    if (!text) continue;
    const fm = {};
    const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      for (const line of fmMatch[1].split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon > 0) fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }
    workflows.push({
      slug: fm.slug || entry,
      kind: fm.kind || '',
      number: fm.number || '',
      currentPhase: fm.currentPhase || '',
      branch: fm.branch || '',
      started: fm.started || '',
    });
  }
  return { workflows, total: workflows.length };
}

/**
 * get_pipeline_cards — returns pipeline tasks across all stages.
 * @param {object} params
 * @param {string} [params.stage] - filter by stage (backlog/working/testing/conclusion)
 * @returns {Promise<object>}
 */
export async function getPipelineCards({ stage } = {}) {
  try {
    const tasks = listTasks(P.pipeline);
    const filtered = stage ? tasks.filter((t) => t.stage === stage) : tasks;
    return { tasks: filtered, total: filtered.length };
  } catch (err) {
    return { tasks: [], error: String(err.message) };
  }
}

/**
 * get_active_claims — returns current workspace claims per session.
 * @returns {Promise<object>}
 */
export async function getActiveClaims() {
  const sessions = await readActiveClaims();
  return { sessions, totalSessions: sessions.length, totalClaims: sessions.reduce((n, s) => n + s.claims.length, 0) };
}

/**
 * get_latest_session — returns the newest registered session content.
 * @returns {Promise<object>}
 */
export async function getLatestSession() {
  const { index, latest, filename } = await readLatestSession();
  if (!latest) return { error: 'No session logs found.' };
  return { filename, content: latest, indexEntry: index ? index.split('\n').slice(0, 10).join('\n') : null };
}

/**
 * get_relevant_decisions — returns ADR catalog lines (optionally filtered by keyword).
 * @param {object} params
 * @param {string} [params.query] - keyword to filter ADR titles/decisions
 * @param {number} [params.limit] - max results (default 20)
 * @returns {Promise<object>}
 */
export async function getRelevantDecisions({ query, limit = 20 } = {}) {
  const catalog = await readAdrCatalog(100);
  const filtered = query
    ? catalog.filter((a) => {
        const haystack = `${a.title} ${a.decision} ${a.slug}`.toLowerCase();
        return query.toLowerCase().split(/\s+/).some((word) => haystack.includes(word));
      })
    : catalog;
  return {
    decisions: filtered.slice(0, limit).map((a) => ({ ...a, line: renderCatalogLine(a) })),
    total: filtered.length,
    query: query || null,
  };
}

/**
 * get_context_pack — the bounded start-of-work bundle (context-pack.mjs output).
 * @returns {Promise<object>}
 */
export async function getContextPack() {
  const [sessionData, changelogText, recentAdrs, backlogTasks] = await Promise.all([
    readLatestSession(),
    readSafe(P.changelog),
    readAdrCatalog(5),
    getPipelineCards({ stage: 'backlog' }),
  ]);

  const unreleasedBlock = (() => {
    if (!changelogText) return null;
    const idx = changelogText.indexOf('[Unreleased]');
    if (idx < 0) return null;
    const end = changelogText.indexOf('\n## [', idx + 1);
    return changelogText.slice(idx, end > 0 ? end : undefined).trim();
  })();

  return {
    latestSession: sessionData.filename || null,
    sessionSummary: sessionData.latest ? sessionData.latest.split('\n').slice(0, 20).join('\n') : null,
    unreleased: unreleasedBlock,
    recentDecisions: recentAdrs.map((a) => renderCatalogLine(a)).filter(Boolean),
    openBacklog: (backlogTasks.tasks || []).slice(0, 8).map((t) => `- **${t.priority}** · #${t.id} · ${t.title}`),
  };
}

/**
 * get_quality_status — reads QA gate receipts / tech-debt from saved state.
 * @returns {Promise<object>}
 */
export async function getQualityStatus() {
  const stateDir = resolve(P.platform, 'state');
  const receiptsDir = resolve(stateDir, 'receipts');
  let receipts = [];
  try {
    const files = await readdir(receiptsDir);
    receipts = await Promise.all(
      files.filter((f) => f.endsWith('.json')).map(async (f) => {
        const text = await readSafe(resolve(receiptsDir, f));
        if (!text) return null;
        try { return { file: f, ...JSON.parse(text) }; } catch { return null; }
      })
    );
    receipts = receipts.filter(Boolean);
  } catch { /* no receipts dir */ }

  const snapshotPath = resolve(P.platform, 'state', 'quality-snapshot.json');
  const snapshot = await readSafe(snapshotPath);
  let qualitySnapshot = null;
  if (snapshot) { try { qualitySnapshot = JSON.parse(snapshot); } catch { /* ignore */ } }

  return { receipts, qualitySnapshot, receiptsCount: receipts.length };
}
