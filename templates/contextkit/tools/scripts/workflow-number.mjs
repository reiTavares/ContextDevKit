/**
 * Workflow numbering primitives + folder resolution + date-ordered migration.
 * Workflows are numbered like ADRs (`NNNN-slug`) so they order and reference
 * cleanly. Pure `node:fs`, zero deps.
 *
 * ⛔ INVIOLABLE LAW — workflow ids are UNIVERSAL, never per-directory.
 * (BIZ-0001 / WF-0036 A4 "global numbering scanning every root"; ADR-0119.)
 * A workflow's number is unique across the WHOLE hierarchy — legacy
 * `memory/workflows/`, every `business/<BIZ>/workflows/`, every
 * `operations/<OP>/workflows/`, and every `done/` archive — as ONE sequence. If a
 * BIZ already holds workflow 20, the next workflow (even in a brand-new Operation)
 * is 21, not 01.
 *
 * Therefore: to ALLOCATE a new workflow id you MUST call `nextWorkflowNumber` /
 * `allocateWorkflowId` from `registry/ids.mjs` (the single source of truth, which
 * scans every root + the worktree fleet). NEVER use `nextNumber` below to allocate
 * — it is a per-directory primitive that `ids.mjs` composes into the global max.
 * Using it for allocation collides ids across contexts (the bug ADR-0119 fixes).
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

const NUM_RE = /^(\d{4})-(.+)$/;

function dirNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '_TEMPLATE').map((e) => e.name);
}

/**
 * PER-DIRECTORY max+1 of leading `NNNN-` (starts at 0001). Internal primitive only.
 *
 * ⛔ NOT a workflow-id allocator. For a new workflow id use `nextWorkflowNumber` /
 * `allocateWorkflowId` (`registry/ids.mjs`) — ids are UNIVERSAL (see file header).
 * The only legitimate callers are `ids.mjs` (which folds this into the global max)
 * and the date-ordered migration below.
 *
 * @param {string} dir - a single workflow-holding directory.
 * @returns {string} the per-directory next number — DO NOT use to allocate an id.
 */
export function nextNumber(dir) {
  let max = 0;
  for (const name of dirNames(dir)) {
    const m = name.match(NUM_RE);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(4, '0');
}

/**
 * Resolves the actual folder name for an id-or-slug: an exact match (slug or
 * `NNNN-slug`), else the folder whose slug-suffix matches, else (for a numeric
 * id) the folder with that number. Falls back to the literal input (new-create).
 */
export function resolveFolderName(dir, idOrSlug) {
  if (!idOrSlug || existsSync(resolve(dir, idOrSlug))) return idOrSlug;
  const num = /^\d{1,4}$/.test(idOrSlug) ? idOrSlug.padStart(4, '0') : null;
  const hit = dirNames(dir).find((name) => {
    const m = name.match(NUM_RE);
    const slug = m ? m[2] : name;
    return slug === idOrSlug || (num && m && m[1] === num);
  });
  return hit || idOrSlug;
}

/** Reads `started` + `slug` from a pack index, or null when unparseable. */
function readMeta(dir, folder) {
  const idxPath = resolve(dir, folder, 'index.md');
  if (!existsSync(idxPath)) return null;
  const text = readFileSync(idxPath, 'utf-8');
  const started = (text.match(/^started:\s*(.*)$/m)?.[1] || '').trim();
  const slug = (text.match(/^slug:\s*(.*)$/m)?.[1] || '').trim();
  const m = folder.match(NUM_RE);
  return { folder, idxPath, text, started, slug: slug || (m ? m[2] : folder) };
}

/**
 * Renumbers every well-formed workflow by `started` ascending (oldest = 0001),
 * stamping `number:` into each index and renaming the folder to `NNNN-slug`.
 * Idempotent: a folder already at its target name + number is left untouched.
 * Returns the rename plan `[{ from, to, number }]` (also the dry-run output).
 *
 * @param {string} dir the workflows directory
 * @param {{ write?: boolean }} [opts]
 */
export function renumberByStarted(dir, { write = false } = {}) {
  const metas = dirNames(dir).map((f) => readMeta(dir, f)).filter((m) => m && m.text);
  metas.sort((a, b) => String(a.started).localeCompare(String(b.started)));
  const plan = [];
  metas.forEach((meta, i) => {
    const number = String(i + 1).padStart(4, '0');
    const target = `${number}-${meta.slug}`;
    const needsRename = target !== meta.folder;
    const needsField = !new RegExp(`^number:\\s*${number}\\s*$`, 'm').test(meta.text);
    if (!needsRename && !needsField) return;
    plan.push({ from: meta.folder, to: target, number });
    if (!write) return;
    const text = /^number:\s*/m.test(meta.text)
      ? meta.text.replace(/^number:\s*.*$/m, `number: ${number}`)
      : meta.text.replace(/^(started:.*)$/m, `$1\nnumber: ${number}`);
    writeFileAtomicSync(meta.idxPath, text);
    if (needsRename) renameSync(resolve(dir, meta.folder), resolve(dir, target));
  });
  return plan;
}
