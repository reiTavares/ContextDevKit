#!/usr/bin/env node
/**
 * `done/` lifecycle sweep (ADR-0119).
 *
 * At the end of a ceremony, files away every CONCLUDED workflow so finished and
 * in-flight work are visually distinct and an owner has a grouped record of what
 * it delivered:
 *   - owned (`owner: BIZ-/OP-####`) → `<owner-dir>/done/<workflow-dir>`
 *   - unowned                       → `memory/workflows/done/<workflow-dir>`
 *
 * A workflow counts as CONCLUDED from `workflow-state.json` plus one valid
 * `workflow.concluded` journal event. Legacy packs without state retain their
 * frontmatter compatibility path. An explicit index/state mismatch is refused;
 * the sweep never silently chooses one of two truths. For wave workflows, whose
 * index carries no `owner:` frontmatter,
 * the filing owner is recovered from the context dir the workflow lives under.
 *
 * The number stays counted after the move because the `ids.mjs` allocator recurses
 * into every `done/` archive — so a filed-away id is NEVER reused.
 *
 * Dry-run by DEFAULT (constitution §8 — mutators are dry-run until `--write`);
 * `--write` performs an atomic `rename`. A missing source plus an existing target
 * is idempotent; both source and target existing is a refusal. Pure `node:*`, zero
 * runtime dependencies; defensive I/O throughout.
 *
 * Usage:
 *   node contextkit/tools/scripts/workflow-done-sweep.mjs            # dry-run plan
 *   node contextkit/tools/scripts/workflow-done-sweep.mjs --write    # apply moves
 *   node contextkit/tools/scripts/workflow-done-sweep.mjs --json     # machine view
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';
import { finalizationEvent, moveWorkflowDirectory } from './workflow/finalization.mjs';

const ROOT = process.cwd();

/** Immediate child directory names of `dir` (excluding `_TEMPLATE`), or []. */
function childDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE' && entry.name !== 'done')
    .map((entry) => entry.name);
}

/**
 * Parses the leading `--- ... ---` YAML-ish frontmatter of an index.md into a flat
 * `{ key: value }` map. Only the simple `key: value` lines this kit writes are
 * supported (no nesting). Returns `{}` when there is no frontmatter.
 *
 * @param {string} text - file contents.
 * @returns {Record<string,string>} the parsed key/value map.
 */
export function parseFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const map = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) map[kv[1]] = kv[2].trim();
  }
  return map;
}

/**
 * Every ACTIVE workflow-holding directory under the local memory root (the `done/`
 * archives are deliberately excluded — we never re-sweep what is already filed).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string[]} absolute active workflow-holding directories.
 */
export function activeWorkflowDirs(root = ROOT) {
  const memory = pathsFor(root).memory;
  const dirs = [`${memory}/workflows`];
  for (const contextsRoot of [`${memory}/business`, `${memory}/operations`]) {
    for (const name of childDirs(contextsRoot)) {
      dirs.push(`${contextsRoot}/${name}/workflows`);
    }
  }
  return dirs;
}

/**
 * Resolves the on-disk directory of an owner id (e.g. `BIZ-0001`) by matching the
 * `BIZ-0001-*` / `OP-0001-*` folder under business/ or operations/.
 *
 * @param {string} root - project root.
 * @param {string} owner - owner id (`BIZ-####` or `OP-####`).
 * @returns {string|null} absolute owner dir, or null when not found.
 */
export function resolveOwnerDir(root, owner) {
  if (!/^(BIZ|OP)-\d{4}$/.test(owner || '')) return null;
  const memory = pathsFor(root).memory;
  const contextsRoot = owner.startsWith('BIZ') ? `${memory}/business` : `${memory}/operations`;
  for (const name of childDirs(contextsRoot)) {
    if (name.startsWith(`${owner}-`)) return `${contextsRoot}/${name}`;
  }
  return null;
}

/**
 * Inspect the two lifecycle projections without treating index frontmatter as
 * an authority. State-bearing workflows require a valid finalization event;
 * legacy packs without state use the historical frontmatter compatibility path.
 *
 * @param {string} dir - absolute workflow directory.
 * @returns {{status:'concluded'|'active'|'refused',authority?:string,reason?:string}}
 */
export function inspectConclusion(dir) {
  const indexPath = `${dir}/index.md`;
  let index = {};
  if (existsSync(indexPath)) {
    try {
      index = parseFrontmatter(readFileSync(indexPath, 'utf-8'));
    } catch {
      return { status: 'refused', reason: 'index-unreadable' };
    }
  }
  const statePath = `${dir}/workflow-state.json`;
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(stripBom(readFileSync(statePath, 'utf-8')));
      if (!state || typeof state !== 'object') return { status: 'refused', reason: 'state-invalid' };
      if (state.overallStatus === 'done') {
        let event;
        try { event = finalizationEvent(state); } catch { return { status: 'refused', reason: 'finalization-journal-invalid' }; }
        if (!event) return { status: 'refused', reason: 'finalization-event-missing' };
        if (index.conclusion && index.conclusion !== 'done') {
          return { status: 'refused', reason: 'index-state-mismatch' };
        }
        return { status: 'concluded', authority: 'workflow-state', event };
      }
      if (index.conclusion === 'done') return { status: 'refused', reason: 'index-state-mismatch' };
      return { status: 'active', authority: 'workflow-state' };
    } catch {
      return { status: 'refused', reason: 'state-unreadable' };
    }
  }
  return index.conclusion === 'done'
    ? { status: 'concluded', authority: 'legacy-frontmatter' }
    : { status: 'active', authority: 'legacy-frontmatter' };
}

/**
 * Boolean compatibility view of {@link inspectConclusion}.
 * @param {string} dir absolute workflow directory
 * @returns {boolean} true only for a positively concluded workflow
 */
export function isConcluded(dir) {
  return inspectConclusion(dir).status === 'concluded';
}

/**
 * Owner id (`BIZ-####`/`OP-####`) implied by a holder PATH, or null for the global
 * `workflows/` holder. Wave-format index files carry no `owner:` frontmatter, so the
 * filing owner is recovered from the context dir the workflow lives under. Pure
 * string parsing — reads no files.
 *
 * @param {string} holder - absolute workflow-holding directory.
 * @returns {string|null}
 */
export function ownerFromHolder(holder) {
  const match = holder.replace(/\\/g, '/').match(/\/(?:business|operations)\/((?:BIZ|OP)-\d{4})-[^/]*\/workflows$/);
  return match ? match[1] : null;
}

/** Owner id from a legacy `index.md` frontmatter `owner:` field, or null. */
export function ownerFromIndex(dir) {
  const indexPath = `${dir}/index.md`;
  if (!existsSync(indexPath)) return null;
  try {
    const owner = parseFrontmatter(readFileSync(indexPath, 'utf-8')).owner;
    return /^(BIZ|OP)-\d{4}$/.test(owner || '') ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Plans the moves for every concluded workflow (legacy frontmatter OR wave state).
 * The filing owner is the frontmatter `owner:` when present, else the owner implied
 * by the holder path. Owned workflows whose owner dir can't be resolved degrade to
 * the global archive with `ownerMissing: true` so the caller can warn (ADR-0116's
 * owner field is the source of truth; a stripped owner is surfaced, never lost).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {{from:string, to:string, owner:string|null, ownerMissing:boolean}[]}
 */
export function planSweep(root = ROOT) {
  const memory = pathsFor(root).memory;
  const plan = [];
  for (const holder of activeWorkflowDirs(root)) {
    const holderOwner = ownerFromHolder(holder);
    for (const name of childDirs(holder)) {
      const dir = `${holder}/${name}`;
      const verdict = inspectConclusion(dir);
      if (verdict.status === 'refused') {
        throw new Error(`done-sweep refused ${dir}: ${verdict.reason}`);
      }
      if (verdict.status !== 'concluded') continue;
      const owner = ownerFromIndex(dir) || holderOwner;
      const ownerDir = owner ? resolveOwnerDir(root, owner) : null;
      const target = ownerDir ? `${ownerDir}/done` : `${memory}/workflows/done`;
      plan.push({ from: dir, to: `${target}/${name}`, owner, ownerMissing: Boolean(owner) && !ownerDir });
    }
  }
  return plan;
}

/**
 * Applies a sweep plan with atomic renames. A source already filed at its target
 * is an idempotent no-op; a source/target collision is a refusal.
 *
 * @param {{from:string,to:string}[]} plan - the move plan.
 * @returns {{from:string,to:string}[]} the moves that were applied.
 */
export function applySweep(plan) {
  const applied = [];
  for (const move of plan) {
    const receipt = moveWorkflowDirectory(move);
    if (receipt.status === 'applied') applied.push(move);
  }
  return applied;
}

function main() {
  const write = process.argv.includes('--write');
  const json = process.argv.includes('--json');
  const plan = planSweep(ROOT);

  if (json) {
    const applied = write ? applySweep(plan) : [];
    process.stdout.write(`${JSON.stringify({ write, plan, applied }, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.length === 0) {
    process.stdout.write('🧹 done-sweep: no concluded workflows to file.\n');
    process.exit(0);
  }

  process.stdout.write(`🧹 done-sweep — ${plan.length} concluded workflow(s)${write ? '' : ' (dry-run)'}\n`);
  for (const move of plan) {
    const tag = move.owner ? (move.ownerMissing ? `owner ${move.owner} NOT FOUND → global` : move.owner) : 'unowned → global';
    const rel = move.to.replace(/\\/g, '/').replace(/^.*\/memory\//, 'memory/');
    process.stdout.write(`  ${basename(move.from)}  →  ${rel}  [${tag}]\n`);
  }
  if (write) {
    const applied = applySweep(plan);
    process.stdout.write(`\n✅ filed ${applied.length} (skipped ${plan.length - applied.length} already-present).\n`);
  } else {
    process.stdout.write('\nDry-run. Re-run with --write to file these moves.\n');
  }
  process.exit(0);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('workflow-done-sweep.mjs')) {
  main();
}
