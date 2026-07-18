/**
 * WF-0059 W1 — deterministic Stage-0 pipeline inventory (the migration parity oracle).
 *
 * Produces a **byte-stable** snapshot of the flat DevPipeline board that later
 * waves migrate against: the frozen fact set the conservation law
 * `total == Σ{migrated|merged|cancelled|fixture|invalid|review_required}` (W7)
 * is checked against. Read-only — this module never creates, moves, or mutates a
 * card; it only observes.
 *
 * **Determinism is the contract** (SPEC §"Test plan" → "inventory determinism /
 * re-run stability"): identical board in ⇒ byte-identical JSON out. Therefore the
 * output carries **no wall-clock** (`Date.now()` is forbidden here), every array
 * is sorted by a stable key, and object shapes use fixed literal key order.
 * `contentHash` is content-derived (sha256), never time-derived.
 *
 * Per-card facts (evidence pack §1/§2): `id`, `lane` (the physical stage folder —
 * status IS the lane in the as-is board), `status`, `type`, `workflow` (the
 * by-convention owner string, empty on 148 cards), `owned`, `fixture`, `sidecar`
 * presence, `contentHash`, `sourcePath`. Anomalies enumerated: duplicate ids
 * (dup `001`), fixtures, unowned cards, and UUID-keyed sidecars (80 per the pack).
 *
 * Reuses `STAGES` + `parseFrontmatter` (pipeline-tasks.mjs) and the ADR-0053
 * sidecar path convention (state-io.mjs) — no second reader, no second board walk.
 * `node:crypto` is a builtin (not an npm dep) and this is a dev/migration tool,
 * NOT a hot-path hook, so the zero-runtime-dep rule is respected.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STAGES, parseFrontmatter } from './pipeline-tasks.mjs';

/** The sidecar substrate subdir (ADR-0053) — kept apart from the board stages. */
const STATE_SUBDIR = 'state';
/** A UUID-keyed sidecar id (`task-<uuid>-<ver>` per evidence pack §3). */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Content-derived hash, prefixed. Deterministic: same text ⇒ same hash. This is
 * half of the migration identity (`contentHash + sourcePath`) — the numeric id is
 * provenance, not a key (dup `001` proves it).
 *
 * @param {string} text — full card file contents
 * @returns {string} `sha256:<hex>`
 */
export function contentHash(text) {
  return `sha256:${createHash('sha256').update(String(text), 'utf-8').digest('hex')}`;
}

/** readdir names, never throws (missing dir ⇒ []). */
function safeNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * The set of sidecar ids present under `pipeDir/state/` (ADR-0053 layout) plus any
 * un-migrated flat `pipeDir/<id>/state.json` dirs. Sorted for determinism.
 *
 * @param {string} pipeDir — absolute path to `contextkit/pipeline/`
 * @returns {string[]} sidecar ids (dir names holding a state.json)
 */
export function listSidecarIds(pipeDir) {
  const ids = new Set();
  for (const ent of safeNames(resolve(pipeDir, STATE_SUBDIR))) {
    if (ent.isDirectory() && existsSync(resolve(pipeDir, STATE_SUBDIR, ent.name, 'state.json'))) ids.add(ent.name);
  }
  for (const ent of safeNames(pipeDir)) {
    if (!ent.isDirectory() || [...STAGES, STATE_SUBDIR].includes(ent.name)) continue;
    if (existsSync(resolve(pipeDir, ent.name, 'state.json'))) ids.add(ent.name);
  }
  return [...ids].sort();
}

/**
 * Observes one card into a normalized inventory record. Pure read.
 *
 * @param {string} pipeDir — absolute pipeline dir
 * @param {string} stage — the lane folder (backlog|working|testing|conclusion)
 * @param {string} file — the card filename
 * @param {Set<string>} sidecarIds — precomputed sidecar id set
 * @returns {object} the frozen per-card fact record
 */
function inventoryCard(pipeDir, stage, file, sidecarIds) {
  const raw = readFileSync(resolve(pipeDir, stage, file), 'utf-8');
  const fm = parseFrontmatter(raw);
  const id = String(fm.id || file.split('-')[0]);
  const workflow = fm.workflow || '';
  return {
    id,
    lane: stage,
    status: fm.status || stage,
    type: fm.type || 'task',
    workflow,
    owned: workflow !== '',
    fixture: fm.fixture === 'true',
    sidecar: sidecarIds.has(id),
    contentHash: contentHash(raw),
    sourcePath: `pipeline/${stage}/${file}`,
  };
}

/**
 * Enumerates the structural anomalies the migration must account for. All arrays
 * are sorted for byte-stability.
 *
 * @param {object[]} cards — inventory records
 * @param {string[]} sidecarIds — all sidecar ids on disk
 * @returns {{ duplicateIds: string[], fixtures: string[], unowned: string[], uuidSidecars: string[], orphanSidecars: string[] }}
 */
export function detectAnomalies(cards, sidecarIds) {
  const counts = new Map();
  for (const card of cards) counts.set(card.id, (counts.get(card.id) || 0) + 1);
  const cardIds = new Set(cards.map((card) => card.id));
  return {
    duplicateIds: [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort(),
    fixtures: cards.filter((card) => card.fixture).map((card) => card.id).sort(),
    unowned: cards.filter((card) => !card.owned).map((card) => card.id).sort(),
    uuidSidecars: sidecarIds.filter((id) => UUID_RE.test(id)).sort(),
    orphanSidecars: sidecarIds.filter((id) => !cardIds.has(id) && !UUID_RE.test(id)).sort(),
  };
}

/** Per-lane counts + total, fixed key order. */
function totalsByLane(cards) {
  const totals = { total: cards.length };
  for (const stage of STAGES) totals[stage] = cards.filter((card) => card.lane === stage).length;
  return totals;
}

/** Stable card order: lane (lifecycle order) → id (numeric-aware) → sourcePath. */
function byLaneThenId(a, b) {
  const laneDelta = STAGES.indexOf(a.lane) - STAGES.indexOf(b.lane);
  if (laneDelta !== 0) return laneDelta;
  const idDelta = a.id.localeCompare(b.id, undefined, { numeric: true });
  return idDelta !== 0 ? idDelta : a.sourcePath.localeCompare(b.sourcePath);
}

/**
 * Builds the complete Stage-0 inventory. Deterministic — no wall-clock, every
 * collection sorted. A missing pipeline dir yields a valid empty inventory
 * (greenfield), never throws.
 *
 * @param {string} pipeDir — absolute path to `contextkit/pipeline/`
 * @returns {object} the frozen inventory (schemaVersion, kind, totals, anomalies, cards)
 */
export function buildInventory(pipeDir) {
  const sidecarIds = listSidecarIds(pipeDir);
  const sidecarSet = new Set(sidecarIds);
  const cards = [];
  for (const stage of STAGES) {
    const names = safeNames(resolve(pipeDir, stage))
      .filter((ent) => ent.isFile() && ent.name.endsWith('.md'))
      .map((ent) => ent.name)
      .sort();
    for (const file of names) cards.push(inventoryCard(pipeDir, stage, file, sidecarSet));
  }
  cards.sort(byLaneThenId);
  return {
    schemaVersion: 1,
    kind: 'pipeline-inventory-stage0',
    totals: totalsByLane(cards),
    anomalies: detectAnomalies(cards, sidecarIds),
    cards,
  };
}

/**
 * Serializes an inventory to a byte-stable JSON string (2-space indent, trailing
 * newline). Given a deterministic inventory, this is a byte-identical function.
 *
 * @param {object} inventory — from `buildInventory`
 * @returns {string}
 */
export function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

/** Thin CLI: print the current project's Stage-0 inventory to stdout (read-only). */
async function main() {
  const { pathsFor } = await import('../../runtime/config/paths.mjs');
  process.stdout.write(serializeInventory(buildInventory(pathsFor(process.cwd()).pipeline)));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`[pipeline-inventory] ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
