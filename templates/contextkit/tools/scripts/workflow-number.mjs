/**
 * Workflow numbering (ADR-0070). Workflows are numbered like ADRs (`NNNN-slug`)
 * so they order and reference cleanly. This module owns the numbering + folder
 * resolution + the date-ordered migration, keeping `workflow-pack.mjs` within the
 * line budget. Pure `node:fs`, zero deps.
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

const NUM_RE = /^(\d{4})-(.+)$/;

function dirNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '_TEMPLATE').map((e) => e.name);
}

/** Next 4-digit number = max existing leading `NNNN-` + 1 (starts at 0001). */
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
