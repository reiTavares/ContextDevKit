#!/usr/bin/env node
/**
 * Ownership-based filing of loose top-level ADRs (ADR-0123, amends ADR-0102).
 *
 * Files every plain `NNNN-slug.md` ADR sitting at the `decisions/` top level into
 * the folder its OWNER implies:
 *   - attributed to a Business (`primaryContext.id: BIZ-####`, or a plain
 *     `**Business**: BIZ-####` bullet) → `decisions/business/`
 *   - attributed to an Operation (`OP-####`, same two signals)              → `decisions/operations/`
 *   - no owner attribution                                                  → `decisions/legacy/`
 *
 * Filenames are PRESERVED on move (legacy do-not-touch filename shape, ADR-0102);
 * the decision resolver resolves by `ADR-####` id across every root, so id-based
 * references survive. Path-based references (e.g. `decisions/0050-…md` links) are
 * REPORTED by the audit, never silently broken.
 *
 * Dry-run by DEFAULT (constitution §8); `--write` performs atomic `rename`.
 * Idempotent: a target that already exists is skipped. Pure `node:*`, zero deps.
 *
 * Usage:
 *   node contextkit/tools/scripts/decisions-file.mjs            # dry-run plan + ref audit
 *   node contextkit/tools/scripts/decisions-file.mjs --write    # apply the moves
 *   node contextkit/tools/scripts/decisions-file.mjs --json     # machine view
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const ADR_FILE_RE = /^(\d{4})-([a-z0-9._-]+)\.md$/;

/** The `decisions/` directory under a project's memory root. */
function decisionsDir(root) {
  return `${pathsFor(root).memory}/decisions`;
}

/** Loose top-level ADR filenames (plain `NNNN-slug.md`), excluding non-ADR files. */
function looseAdrFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ADR_FILE_RE.test(entry.name))
    .map((entry) => entry.name);
}

/**
 * Owner id (`BIZ-####`/`OP-####`) attributed to an ADR, or null. Reads the
 * canonical `primaryContext` block first, then a plain-markdown `**Business**` /
 * `**Operation**` bullet. The top-level `id:` (the ADR's OWN id) is deliberately
 * not consulted — only the owning context.
 *
 * @param {string} text - ADR file contents.
 * @returns {string|null} the owner id, or null when unattributed.
 */
export function detectOwner(text) {
  const frontmatter = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const primary = frontmatter[1].match(/primaryContext:[\s\S]*?\bid:\s*((?:BIZ|OP)-\d{4})/);
    if (primary) return primary[1];
  }
  const bullet = String(text).match(/\*\*(?:Business|Operation)\*\*:\s*((?:BIZ|OP)-\d{4})/);
  return bullet ? bullet[1] : null;
}

/** Target subfolder for an owner id (null owner → legacy). */
function subfolderFor(owner) {
  if (!owner) return 'legacy';
  return owner.startsWith('BIZ') ? 'business' : 'operations';
}

/**
 * Plans the filing of every loose top-level ADR. Each row records the source, the
 * owner-implied target, the owner (or null), and the destination subfolder.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {{from:string, to:string, owner:string|null, subfolder:string, file:string}[]}
 */
export function planFiling(root = ROOT) {
  const dir = decisionsDir(root);
  const plan = [];
  for (const file of looseAdrFiles(dir)) {
    let owner = null;
    try {
      owner = detectOwner(readFileSync(`${dir}/${file}`, 'utf-8'));
    } catch {
      owner = null; // unreadable → treat as unattributed (→ legacy)
    }
    const subfolder = subfolderFor(owner);
    plan.push({ from: `${dir}/${file}`, to: `${dir}/${subfolder}/${file}`, owner, subfolder, file });
  }
  return plan;
}

/**
 * Applies a filing plan with atomic renames, skipping any target that already
 * exists (idempotent). Returns the moves actually performed.
 *
 * @param {{from:string,to:string}[]} plan - the filing plan.
 * @returns {{from:string,to:string}[]} the moves applied.
 */
export function applyFiling(plan) {
  const applied = [];
  for (const move of plan) {
    if (existsSync(move.to)) continue;
    mkdirSync(move.to.slice(0, move.to.lastIndexOf('/')), { recursive: true });
    renameSync(move.from, move.to);
    applied.push(move);
  }
  return applied;
}

/** Recursively collect text-file paths under `dir` (.md/.mjs/.json), defensively. */
function textFilesUnder(dir, acc = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      textFilesUnder(full, acc);
    } else if (/\.(md|mjs|json)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Counts path-based references (`decisions/<basename>` style) to each moved file,
 * so a dry-run can warn which links would break. Id-based (`ADR-####`) references
 * are NOT counted — they resolve across roots regardless of folder. One walk.
 *
 * @param {string} root - project root.
 * @param {string[]} files - basenames being moved.
 * @returns {Record<string, number>} basename → reference count.
 */
export function auditReferences(root, files) {
  const counts = Object.fromEntries(files.map((file) => [file, 0]));
  const memory = pathsFor(root).memory;
  for (const path of textFilesUnder(memory)) {
    let text;
    try {
      text = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    for (const file of files) {
      if (text.includes(`decisions/${file}`) && !path.endsWith(`/${file}`)) counts[file] += 1;
    }
  }
  return counts;
}

function main() {
  const write = process.argv.includes('--write');
  const json = process.argv.includes('--json');
  const plan = planFiling(ROOT);

  if (json) {
    const applied = write ? applyFiling(plan) : [];
    process.stdout.write(`${JSON.stringify({ write, plan, applied }, null, 2)}\n`);
    return;
  }

  if (plan.length === 0) {
    process.stdout.write('🗂  decisions-file: no loose top-level ADRs to file.\n');
    return;
  }

  const byFolder = plan.reduce((acc, move) => ({ ...acc, [move.subfolder]: (acc[move.subfolder] || 0) + 1 }), {});
  process.stdout.write(`🗂  decisions-file — ${plan.length} loose ADR(s)${write ? '' : ' (dry-run)'}\n`);
  process.stdout.write(`   business: ${byFolder.business || 0} · operations: ${byFolder.operations || 0} · legacy: ${byFolder.legacy || 0}\n`);
  for (const move of plan) {
    const tag = move.owner ? `${move.owner} → ${move.subfolder}/` : `unowned → legacy/`;
    process.stdout.write(`  ${move.file}  [${tag}]\n`);
  }

  if (write) {
    const applied = applyFiling(plan);
    process.stdout.write(`\n✅ filed ${applied.length} (skipped ${plan.length - applied.length} already-present).\n`);
  } else {
    const refs = auditReferences(ROOT, plan.map((move) => move.file));
    const breakable = Object.entries(refs).filter(([, count]) => count > 0);
    if (breakable.length) {
      process.stdout.write(`\n⚠️  path-based references that would need updating (id-based ADR-#### refs are unaffected):\n`);
      for (const [file, count] of breakable) process.stdout.write(`  ${file}: ${count} ref(s)\n`);
    }
    process.stdout.write('\nDry-run. Re-run with --write to file these moves.\n');
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('decisions-file.mjs')) {
  main();
}
