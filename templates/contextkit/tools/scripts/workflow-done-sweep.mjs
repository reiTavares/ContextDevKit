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
 * The number stays counted after the move because the `ids.mjs` allocator recurses
 * into every `done/` archive — so a filed-away id is NEVER reused.
 *
 * Dry-run by DEFAULT (constitution §8 — mutators are dry-run until `--write`);
 * `--write` performs an atomic `rename`. Idempotent: a target that already exists
 * is skipped. Pure `node:*`, zero runtime dependencies; defensive I/O throughout.
 *
 * Usage:
 *   node contextkit/tools/scripts/workflow-done-sweep.mjs            # dry-run plan
 *   node contextkit/tools/scripts/workflow-done-sweep.mjs --write    # apply moves
 *   node contextkit/tools/scripts/workflow-done-sweep.mjs --json     # machine view
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

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
 * Plans the moves for every concluded workflow. A workflow is "concluded" when its
 * `index.md` frontmatter has `conclusion: done`. Owned workflows whose owner dir
 * can't be resolved degrade to the global archive with `ownerMissing: true` so the
 * caller can warn (ADR-0116's owner field is the source of truth; a stripped owner
 * is surfaced, never silently lost).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {{from:string, to:string, owner:string|null, ownerMissing:boolean}[]}
 */
export function planSweep(root = ROOT) {
  const memory = pathsFor(root).memory;
  const plan = [];
  for (const holder of activeWorkflowDirs(root)) {
    for (const name of childDirs(holder)) {
      const indexPath = `${holder}/${name}/index.md`;
      if (!existsSync(indexPath)) continue;
      let front;
      try {
        front = parseFrontmatter(readFileSync(indexPath, 'utf-8'));
      } catch {
        continue; // unreadable index → leave it in place
      }
      if (front.conclusion !== 'done') continue;
      const owner = /^(BIZ|OP)-\d{4}$/.test(front.owner || '') ? front.owner : null;
      const ownerDir = owner ? resolveOwnerDir(root, owner) : null;
      const target = ownerDir ? `${ownerDir}/done` : `${memory}/workflows/done`;
      plan.push({
        from: `${holder}/${name}`,
        to: `${target}/${name}`,
        owner,
        ownerMissing: Boolean(owner) && !ownerDir,
      });
    }
  }
  return plan;
}

/**
 * Applies a sweep plan with atomic renames. Skips any move whose target already
 * exists (idempotent). Returns the moves actually performed.
 *
 * @param {{from:string,to:string}[]} plan - the move plan.
 * @returns {{from:string,to:string}[]} the moves that were applied.
 */
export function applySweep(plan) {
  const applied = [];
  for (const move of plan) {
    if (existsSync(move.to)) continue; // already filed
    mkdirSync(move.to.slice(0, move.to.lastIndexOf('/')), { recursive: true });
    renameSync(move.from, move.to);
    applied.push(move);
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
