/**
 * Boot-context content readers — pure I/O for `session-start.mjs`.
 *
 * Each function reads ONE source artifact and returns a Markdown snippet (or
 * null when missing/empty). All helpers are defensive — they never throw.
 * Zero third-party deps.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHANGELOG, PLATFORM_DIR, SESSIONS_DIR, SESSIONS_INDEX, WORKSPACE_INDEX } from '../config/paths.mjs';

const SECTION_LIMIT = 60;

/** Matches `<YYYY-MM-DD>-<NN>-<slug>.md`. Slug allows `a-z0-9._-`. */
const ENTRY_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{2,})-([a-z0-9._-]+)\.md$/;

async function readSafe(root, relPath) {
  try {
    return await readFile(resolve(root, relPath), 'utf-8');
  } catch {
    return null;
  }
}

export async function exists(root, relPath) {
  try {
    await stat(resolve(root, relPath));
    return true;
  } catch {
    return false;
  }
}

/** Most recent registered session entry as a Markdown snippet + its path. */
export async function extractLatestSession(root) {
  let files = [];
  try {
    files = await readdir(resolve(root, SESSIONS_DIR));
  } catch {
    return null;
  }
  const entries = files
    .map((f) => ENTRY_PATTERN.exec(f))
    .filter(Boolean)
    .map((m) => ({ filename: m[0], num: Number.parseInt(m[2], 10) }))
    .sort((a, b) => b.num - a.num);
  if (entries.length === 0) return null;
  const content = await readSafe(root, `${SESSIONS_DIR}/${entries[0].filename}`);
  if (!content) return null;
  const lines = content.split('\n').slice(0, SECTION_LIMIT);
  return { path: resolve(root, SESSIONS_DIR, entries[0].filename), content: lines.join('\n').trim() };
}

/** Extracts the `[Unreleased]` block from a CHANGELOG-shaped string. */
export function extractUnreleased(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+\[Unreleased\]/i.test(l));
  if (startIdx === -1) return null;
  const slice = lines.slice(startIdx + 1);
  const endRel = slice.findIndex((l) => l.trim() === '---' || /^##\s+\[/.test(l));
  const end = endRel === -1 ? slice.length : endRel;
  const content = slice.slice(0, Math.min(end, SECTION_LIMIT)).join('\n').trim();
  if (!content || /add your changes|empty|vazio/i.test(content)) return null;
  return content;
}

/** Active-session table from WORKSPACE.md (first ~12 lines after the header). */
export async function readWorkspaceSummary(root) {
  const md = await readSafe(root, WORKSPACE_INDEX);
  if (!md) return null;
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+🟢\s+Active/.test(l));
  if (startIdx === -1) return null;
  return lines.slice(startIdx).slice(0, 12).join('\n').trim();
}

/**
 * The "In testing / in progress" lane of the generated DevPipeline board — so a
 * new session sees what is already in flight (and which session owns it) at boot.
 * Returns null when the board is missing or that lane is empty (zero noise).
 */
export async function readPipelineInProgress(root) {
  const md = await readSafe(root, `${PLATFORM_DIR}/pipeline/devpipeline.md`);
  if (!md) return null;
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+🟡\s+In testing/.test(l));
  if (startIdx === -1) return null;
  const rest = lines.slice(startIdx + 1);
  const endRel = rest.findIndex((l) => /^##\s+/.test(l));
  const body = rest.slice(0, endRel === -1 ? rest.length : endRel).join('\n').trim();
  if (!body || /^_\(empty/.test(body)) return null;
  return body.split('\n').slice(0, 14).join('\n').trim();
}

export async function readChangelog(root) {
  return readSafe(root, CHANGELOG);
}

export async function readSessionsIndex(root) {
  return readSafe(root, SESSIONS_INDEX);
}
