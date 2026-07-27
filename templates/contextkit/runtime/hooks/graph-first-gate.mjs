#!/usr/bin/env node
/**
 * Graph-first exploration gate (Level >= 4) — WF-0108 / ADR-0155.
 *
 * The BIZ-0004 structural graph was built, committed and queryable, yet nothing
 * obliged anyone to use it: an agent could open a broad `Grep`/`Glob` sweep and
 * never touch it. This hook makes graph-first exploration DETERMINISTIC instead of
 * a matter of goodwill.
 *
 * It is an ACTIVE gate, not a nag. It does not ask the agent to "go consult the
 * graph" and then trust the answer — it performs the lookup itself and hands the
 * result over inside the denial. That is why a miss here is a PROVEN miss rather
 * than an unproven skip, and why no "was the graph consulted?" marker is needed.
 *
 * Two events, one file (precedent: `compaction-continuity.mjs`):
 *   UserPromptSubmit  record a human bypass token found in the prompt.
 *   PreToolUse        enforce on `Grep`/`Glob`.
 *
 * Enforcement ladder:
 *   level < 4 | graph off | non-blocking mode  -> allow, silent
 *   human bypass recorded this session         -> allow, note the audited bypass
 *   projection absent / unreadable             -> ALLOW + visible warning
 *   graph answers the term                     -> BLOCK, answer inlined
 *   miss + projection older than maxAgeMinutes -> bounded rebuild, re-query
 *   miss (fresh, or still missing post-rebuild)-> ALLOW + visible warning
 *
 * A miss is NEVER silent (the developer asked for the warning explicitly) and
 * NEVER a false block: unavailable evidence degrades to allow-with-warning, per
 * constitution section 8 (refused-silently-to-false-positive, never the reverse).
 *
 * Hot-path purity (ADR-0134, proven by `tools/selfcheck-hotpath-purity.mjs`): the
 * projection is read through `node:fs` and the builder is reached only by process
 * spawn — no graph builder/query module is ever imported. `graph-config.mjs` and
 * `graph-activation.mjs` are the two graph modules that proof exempts.
 *
 * Every path exits 0 on error (immutable rule 2).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { pathsFor, PLATFORM_DIR } from '../config/paths.mjs';
import { resolveGraphActivation } from '../../tools/scripts/graph-activation.mjs';
import { emitAdvisory, emitBlockDecision, hookHost, resolveHookSessionId } from './host-adapter.mjs';
import { sanitizeSid, SESSIONS_DIR } from './ledger.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** Minimum capability level for the graph (mirrors `graph-activation.mjs`). */
const MIN_LEVEL = 4;
/** Max matches listed in a denial — enough to act on, not a context dump. */
const MAX_MATCHES_SHOWN = 12;
/** Wall-clock ceiling for the on-demand rebuild, so a hung builder never hangs a tool call. */
const REBUILD_TIMEOUT_MS = 90_000;

/**
 * Human bypass tokens (bilingual, WF-0095 precedent: pt-BR carries the same
 * weight as English). Only a HUMAN prompt can carry one — the agent cannot mint a
 * bypass for itself, which is what keeps the gate meaningful.
 */
export const BYPASS_TOKENS = Object.freeze(['no-graph', 'skip-graph', 'sem-grafo', 'pular-grafo']);

/**
 * True when a prompt carries an explicit human bypass token.
 * @param {unknown} prompt raw prompt text
 * @returns {boolean}
 */
export function hasBypassToken(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) return false;
  const lower = prompt.toLowerCase();
  return BYPASS_TOKENS.some((token) => lower.includes(token));
}

/**
 * Tokens that are NOT a searchable literal even though they look like one: file
 * extensions and generic directory names match a huge share of node ids, so
 * accepting them would turn a routine `Glob **\/*.mjs` into a false block. Treating
 * them as "no literal" is the safe direction (allow + warn, never a bogus deny).
 */
const NON_LITERAL_TOKENS = new Set([
  'mjs', 'cjs', 'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'json', 'md', 'mdx', 'yml', 'yaml', 'toml',
  'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'sql', 'css', 'scss', 'html', 'txt', 'lock',
  'src', 'lib', 'app', 'test', 'tests', 'spec', 'dist', 'build', 'node_modules', 'index', 'main',
]);

/**
 * Reduces a search pattern to the longest LITERAL token the graph can be asked
 * about: regex/glob metacharacters carry no meaning against node ids. Returns null
 * when nothing meaningful survives (e.g. `**\/*.mjs`, whose only token is the
 * extension) — the honest answer there is "the graph cannot answer this", which
 * degrades to allow-with-warning rather than a fabricated match.
 *
 * @param {unknown} pattern raw Grep regex or Glob pattern
 * @returns {string|null} the longest meaningful literal token (>= 4 chars), or null
 */
export function literalOf(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return null;
  const tokens = pattern
    .split(/[^A-Za-z0-9_.-]+/)
    .flatMap((token) => token.split('.'))
    .map((token) => token.replace(/^[_-]+|[_-]+$/g, ''))
    .filter((token) => token.length >= 4 && /[A-Za-z_]/.test(token) && !NON_LITERAL_TOKENS.has(token.toLowerCase()));
  if (tokens.length === 0) return null;
  return tokens.sort((a, b) => b.length - a.length)[0];
}

/**
 * Extracts the searchable literal from a PreToolUse payload for the broad-search
 * tools. Returns null for any other tool or an unusable pattern.
 *
 * @param {any} payload parsed stdin JSON (Claude/Codex shape, or agy `toolCall`)
 * @returns {{tool:string, pattern:string, term:string}|null}
 */
export function extractSearchTerm(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const call = payload.toolCall && typeof payload.toolCall === 'object' ? payload.toolCall : null;
  const tool = String((call ? call.name ?? call.tool : payload.tool_name) ?? '');
  if (!/^(Grep|Glob|grep|glob|search_files|find_by_name|grep_search)$/.test(tool)) return null;
  const input = (call ? call.args : payload.tool_input) ?? {};
  const pattern = input.pattern ?? input.Pattern ?? input.query ?? input.Query ?? input.regex ?? null;
  if (typeof pattern !== 'string' || pattern.length === 0) return null;
  const term = literalOf(pattern);
  return term ? { tool, pattern, term } : null;
}

/**
 * Substring lookup over node ids — the same shape `graph-consumers.mjs#query_graph`
 * exposes, re-implemented here in three lines rather than imported, because
 * importing it would break hot-path purity. Case-insensitive.
 *
 * @param {{nodes?:Array<{id:string}>}|null} graph parsed projection
 * @param {string} term literal search term
 * @returns {string[]} matching node ids (unbounded; the caller slices)
 */
export function queryProjection(graph, term) {
  if (!graph || !Array.isArray(graph.nodes) || typeof term !== 'string' || term.length === 0) return [];
  const needle = term.toLowerCase();
  const matches = [];
  for (const node of graph.nodes) {
    const id = typeof node?.id === 'string' ? node.id : null;
    if (id && id.toLowerCase().includes(needle)) matches.push(id);
  }
  return matches;
}

/**
 * PURE decision core. Given the resolved facts, what should the gate do? Kept
 * separate from all I/O so every branch is unit-testable without a project tree.
 *
 * @param {object} input
 * @param {number} input.level resolved capability level
 * @param {string} input.mode resolved graph activation mode
 * @param {boolean} input.bypassed a human bypass was recorded this session
 * @param {boolean} input.projectionPresent a readable projection exists
 * @param {string[]} input.matches node ids matching the term
 * @param {number|null} input.ageMinutes projection age, or null when unknown
 * @param {number} input.maxAgeMinutes staleness threshold
 * @param {boolean} [input.rebuilt] a rebuild was already attempted this call
 * @returns {{action:'allow'|'block'|'rebuild', reason:string}}
 */
export function decideGate({ level, mode, bypassed, projectionPresent, matches, ageMinutes, maxAgeMinutes, rebuilt = false }) {
  if (typeof level !== 'number' || level < MIN_LEVEL) return { action: 'allow', reason: `level < ${MIN_LEVEL}` };
  if (mode !== 'guarded' && mode !== 'strict') return { action: 'allow', reason: `graph mode "${mode}" does not block` };
  if (bypassed) return { action: 'allow', reason: 'human bypass token recorded this session' };
  if (!projectionPresent) return { action: 'allow', reason: 'no readable graph projection — cannot evaluate (skipped, never a pass)' };
  if (Array.isArray(matches) && matches.length > 0) return { action: 'block', reason: `graph answers this: ${matches.length} match(es)` };
  // A miss against a stale projection is not yet a real miss — refresh once, then
  // re-ask. `rebuilt` stops that from recursing.
  if (!rebuilt && typeof ageMinutes === 'number' && ageMinutes > maxAgeMinutes) {
    return { action: 'rebuild', reason: `graph is ${Math.round(ageMinutes)}min old (> ${maxAgeMinutes}min) — rebuild and re-query before answering` };
  }
  return { action: 'allow', reason: 'graph has no match for this term' };
}

/** Absolute path of the committed projection. */
function projectionPath(root) {
  return resolve(pathsFor(root).projectMap, 'graph', 'graph.json');
}

/**
 * Reads the committed projection through `node:fs`. Returns null on absence or any
 * parse failure — never throws, never fabricates an empty graph.
 *
 * @param {string} root project root
 * @returns {{nodes:Array<object>}|null}
 */
function readProjection(root) {
  try {
    const path = projectionPath(root);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const graph = JSON.parse(text);
    return Array.isArray(graph?.nodes) ? graph : null;
  } catch {
    return null;
  }
}

/** Projection age in minutes, or null when it cannot be determined. */
function projectionAgeMinutes(root, now) {
  try {
    return (now - statSync(projectionPath(root)).mtimeMs) / 60_000;
  } catch {
    return null;
  }
}

/** Per-session bypass marker path — sanitized so a session id cannot escape the dir. */
function bypassMarkerPath(sessionId) {
  return resolve(SESSIONS_DIR, `${sanitizeSid(sessionId)}.graph-bypass`);
}

/**
 * Rebuilds the projection synchronously, bounded by `REBUILD_TIMEOUT_MS`. This is
 * the ONE place the gate accepts latency: the developer asked for a stale graph to
 * self-heal before the search is answered. Returns true when the builder ran.
 *
 * @param {string} root project root
 * @returns {boolean}
 */
function rebuildProjection(root) {
  try {
    const builder = resolve(root, PLATFORM_DIR, 'tools/scripts/project-map-graph.mjs');
    if (!existsSync(builder)) return false;
    execFileSync(process.execPath, [builder, '--apply'], { cwd: root, stdio: 'ignore', timeout: REBUILD_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/** The denial body: the graph's answer, plus how to go deeper in it. */
function buildBlockReason({ tool, pattern, term, matches }) {
  const shown = matches.slice(0, MAX_MATCHES_SHOWN);
  return [
    '🕸️  Graph-first gate — the structural graph already answers this.',
    '',
    `You asked \`${tool}\` for \`${pattern}\`. The committed graph holds`,
    `**${matches.length} node(s)** matching \`${term}\`:`,
    '',
    ...shown.map((id) => `  • ${id}`),
    ...(matches.length > shown.length ? [`  … and ${matches.length - shown.length} more.`] : []),
    '',
    'Use that instead of a broad text sweep — it is cheaper and it carries',
    'relationships a text search cannot see:',
    '',
    `  node ${PLATFORM_DIR}/tools/scripts/graph.mjs query "${term}"`,
    `  node ${PLATFORM_DIR}/tools/scripts/graph.mjs callers <id>     # who calls it`,
    `  node ${PLATFORM_DIR}/tools/scripts/graph.mjs impact <id>      # blast radius`,
    '',
    'Reading one named file is never gated — only broad exploration is.',
    'A human (not the agent) can waive this for a turn by putting `no-graph`',
    'or `sem-grafo` in the prompt.',
  ].join('\n');
}

/** The warn-and-allow body: the miss is stated out loud, then the search proceeds. */
function buildMissWarning({ tool, pattern, term, reason, rebuilt }) {
  return [
    '<graph-first-gate>',
    `⚠️  Graph could not answer \`${term}\` (from \`${tool}\` \`${pattern}\`).`,
    `   ${reason}${rebuilt ? ' — a rebuild was attempted and the term still did not appear.' : ''}`,
    '   Falling back to the broad search. Treat the graph as INCOMPLETE for this',
    '   term rather than as proof the symbol does not exist.',
    '</graph-first-gate>',
  ].join('\n');
}

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** Records a human bypass for this session (UserPromptSubmit branch). */
function recordBypass(sessionId) {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(bypassMarkerPath(sessionId), JSON.stringify({ at: Date.now(), source: 'human-prompt' }), 'utf-8');
  } catch {
    /* a failed marker only means the gate stays active — fail toward enforcement */
  }
}

/**
 * UserPromptSubmit branch: capture an explicit human bypass. Emits nothing (the
 * bypass is acknowledged when the gate later honors it), so a prompt is never
 * decorated with hook noise.
 */
function handlePrompt(payload, sessionId) {
  const prompt = payload?.prompt ?? payload?.user_prompt ?? payload?.message ?? '';
  if (hasBypassToken(prompt)) recordBypass(sessionId);
}

/** PreToolUse branch: the enforcement itself. */
function handleToolUse(payload, sessionId, config, level) {
  const search = extractSearchTerm(payload);
  if (!search) return; // not a broad search, or no literal to ask about

  const { mode } = resolveGraphActivation(level, config, {});
  const maxAgeMinutes = Number(config?.projectMap?.graph?.maxAgeMinutes) || 60;
  const bypassed = existsSync(bypassMarkerPath(sessionId));

  let graph = readProjection(ROOT);
  let matches = queryProjection(graph, search.term);
  let decision = decideGate({
    level,
    mode,
    bypassed,
    projectionPresent: graph !== null,
    matches,
    ageMinutes: projectionAgeMinutes(ROOT, Date.now()),
    maxAgeMinutes,
  });

  let rebuilt = false;
  if (decision.action === 'rebuild') {
    rebuilt = rebuildProjection(ROOT);
    graph = readProjection(ROOT);
    matches = queryProjection(graph, search.term);
    decision = decideGate({
      level,
      mode,
      bypassed,
      projectionPresent: graph !== null,
      matches,
      ageMinutes: projectionAgeMinutes(ROOT, Date.now()),
      maxAgeMinutes,
      rebuilt: true,
    });
  }

  if (decision.action === 'block') {
    emitBlockDecision(buildBlockReason({ ...search, matches }), HOST);
    return;
  }
  // Allow — but a MISS is always said out loud. A silent-by-config allow (level
  // too low, non-blocking mode, honored bypass) stays quiet.
  if (decision.reason.startsWith('graph has no match') || decision.reason.startsWith('no readable graph')) {
    emitAdvisory(buildMissWarning({ ...search, reason: decision.reason, rebuilt }), HOST, 'PreToolUse');
  }
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const level = getLevel(ROOT);
  const config = loadConfigSync(ROOT);
  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const event = String(payload.hook_event_name ?? payload.hookEventName ?? '');

  // UserPromptSubmit carries a prompt and no tool; PreToolUse the reverse. Dispatch
  // on the event when the host sends one, else infer from the payload shape.
  if (event === 'UserPromptSubmit' || (!event && typeof payload.prompt === 'string')) {
    handlePrompt(payload, sessionId);
    return;
  }
  handleToolUse(payload, sessionId, config, level);
}

// Run ONLY when invoked as a hook process, never on import: the pure decision core
// is imported by the selftest, and an unguarded `main()` would read stdin (and
// possibly rebuild the graph) from a test (precedent: `graph-activation.mjs`).
if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-first-gate.mjs') {
  main().catch((err) => {
    process.stderr.write(`[graph-first-gate] ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
