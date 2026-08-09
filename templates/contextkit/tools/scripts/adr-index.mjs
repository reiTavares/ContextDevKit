/**
 * ADR Legacy Indexer (BIZ-0001 / WF-0037, B4-T1).
 *
 * Scans one or more directories for legacy `NNNN-slug.md` ADRs and emits a
 * sorted, in-memory index — files are NEVER moved or rewritten (compatibility
 * plan §"Do-not-touch list", constitution §8: read-only by default). Callers
 * consume the returned array; writing it to disk is an explicit caller action.
 *
 * Reuses `parseAdr` (adr-digest-core) for number/title/status extraction and
 * the ADR_FILENAME_RE sentinel from the same module, so the legacy filename
 * contract is single-sourced.
 *
 * Zero runtime dependencies — `node:*` only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADR_FILENAME_RE, parseAdr } from './adr-digest-core.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Defensive UTF-8 read with BOM strip; returns '' on any error (fail-open). */
function safeRead(filePath) {
  try {
    return stripBom(readFileSync(filePath, 'utf-8'));
  } catch {
    return '';
  }
}

/**
 * Lists legacy ADR filenames (matches ADR_FILENAME_RE) inside `dir`.
 * Returns [] when the directory is absent or unreadable.
 *
 * @param {string} dir - absolute directory path.
 * @returns {string[]} sorted bare filenames matching the legacy pattern.
 */
function legacyFilenames(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ADR_FILENAME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * One entry in the legacy ADR index — all fields derived from the existing
 * file; the file itself is never written.
 *
 * @typedef {object} LegacyAdrEntry
 * @property {string}      id          - `ADR-NNNN` logical id.
 * @property {string}      filename    - bare filename, e.g. `0001-zero-dep.md`.
 * @property {string}      absolutePath - resolved absolute path on disk.
 * @property {string}      dir         - directory that contains the file.
 * @property {string}      number      - four-digit string, e.g. `"0001"`.
 * @property {string}      title       - extracted H1 title (may be empty).
 * @property {string}      status      - extracted status keyword (may be empty).
 * @property {string}      slug        - slug from filename.
 * @property {'legacy'}    format      - always `'legacy'`.
 */

/**
 * Builds the legacy ADR index for one directory. Reads every matching file
 * once (parse only). The files remain untouched on disk.
 *
 * @param {string}   dir       - absolute directory to scan.
 * @param {object}  [opts]
 * @param {boolean} [opts.recursive=false] - recurse into immediate subdirs.
 * @returns {LegacyAdrEntry[]} sorted by id.
 */
export function indexLegacyAdrs(dir, opts = {}) {
  const resolvedDir = resolve(String(dir));
  const entries = [];
  _collectFromDir(resolvedDir, entries);

  if (opts.recursive) {
    try {
      if (existsSync(resolvedDir)) {
        for (const entry of readdirSync(resolvedDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            _collectFromDir(resolve(resolvedDir, entry.name), entries);
          }
        }
      }
    } catch {
      // fail-open: partial scan is better than crash
    }
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  return entries;
}

/** Scan one directory and push parsed entries into `out`. */
function _collectFromDir(dir, out) {
  for (const filename of legacyFilenames(dir)) {
    const absolutePath = resolve(dir, filename);
    const contents = safeRead(absolutePath);
    const parsed = parseAdr(contents, filename);
    const number = parsed.number && parsed.number !== '????' ? parsed.number : filename.slice(0, 4);
    out.push({
      id: `ADR-${number}`,
      filename,
      absolutePath,
      dir,
      number,
      title: parsed.title || '',
      status: parsed.status || '',
      slug: parsed.slug || '',
      format: 'legacy',
    });
  }
}

/**
 * Builds legacy ADR indexes across multiple directories (e.g. the flat
 * decisions root AND a decisions/legacy subdirectory). Deduplicates on
 * `absolutePath` so a file scanned from two roots only appears once.
 *
 * @param {string[]} dirs    - list of absolute directory paths.
 * @param {object}  [opts]
 * @param {boolean} [opts.recursive=false] - recurse into each dir's subdirs.
 * @returns {LegacyAdrEntry[]} merged, sorted by id then absolutePath.
 */
export function indexLegacyAdrsDirs(dirs, opts = {}) {
  const seen = new Set();
  const merged = [];
  for (const dir of dirs) {
    for (const entry of indexLegacyAdrs(dir, opts)) {
      if (!seen.has(entry.absolutePath)) {
        seen.add(entry.absolutePath);
        merged.push(entry);
      }
    }
  }
  merged.sort(
    (a, b) => a.id.localeCompare(b.id) || a.absolutePath.localeCompare(b.absolutePath),
  );
  return merged;
}

// ---------------------------------------------------------------------------
// CLI entry point — node adr-index.mjs [--dir <path>] [--json] [--recursive]
// ---------------------------------------------------------------------------

function parseCliFlags(argv) {
  const flags = { dirs: [], json: false, recursive: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if ((t === '--dir' || t === '-d') && argv[i + 1]) {
      flags.dirs.push(argv[i + 1]);
      i += 1;
    } else if (t.startsWith('--dir=')) {
      flags.dirs.push(t.slice(6));
    } else if (t === '--json') {
      flags.json = true;
    } else if (t === '--recursive') {
      flags.recursive = true;
    }
  }
  return flags;
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));
  const dirs = flags.dirs.length ? flags.dirs : [process.cwd()];
  const entries = indexLegacyAdrsDirs(dirs, { recursive: flags.recursive });
  if (flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }
  if (!entries.length) {
    console.log('adr-index: no legacy NNNN-slug.md ADRs found.');
    return;
  }
  console.log(`adr-index: found ${entries.length} legacy ADR(s):`);
  for (const e of entries) {
    const status = e.status ? ` [${e.status}]` : '';
    console.log(`  ${e.id}${status} — ${e.title || '(no title)'}`);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
