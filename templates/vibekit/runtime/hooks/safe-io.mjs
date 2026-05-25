/**
 * Atomic file writes — shared, zero-dependency I/O helper.
 *
 * Strategy: write to a unique temp sibling, then `rename` it over the target.
 * `rename(2)` is atomic on the same filesystem, so a concurrent reader always
 * sees either the previous file or the complete new one — never a half-written,
 * truncated, or interleaved file. This is the safe replacement for the bare
 * `writeFile` calls in the ledger, workspace and pipeline writers, which could
 * corrupt state when two sessions wrote the same artifact at once.
 *
 * Lives in `runtime/hooks/` alongside the other internal libs (ledger.mjs,
 * path-classification.mjs) so both the runtime hooks and the tool scripts share
 * one source. Sync variant for the scripts, async for the hot-path hooks.
 */
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';

/** Unique temp path next to the target (same dir → same filesystem → atomic rename). */
function tmpName(path) {
  return `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Atomically write `data` to `path` (synchronous — for the tool scripts).
 * On failure the temp file is cleaned up and the original error re-thrown.
 */
export function writeFileAtomicSync(path, data, encoding = 'utf-8') {
  const tmp = tmpName(path);
  try {
    writeFileSync(tmp, data, encoding);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* temp may not exist */
    }
    throw err;
  }
}

/**
 * Atomically write `data` to `path` (async — for the runtime hooks).
 * On failure the temp file is cleaned up and the original error re-thrown.
 */
export async function writeFileAtomic(path, data, encoding = 'utf-8') {
  const tmp = tmpName(path);
  try {
    await writeFile(tmp, data, encoding);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
