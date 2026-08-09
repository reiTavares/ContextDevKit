/**
 * Conflict-safe tree sync for the personalizable kit surfaces [ADR-0054].
 *
 * `.claude/commands`, `.claude/agents` and `contextkit/workflows` are kit-owned
 * but user-personalizable: the old force-copy on `--update` silently destroyed
 * tuned agents/commands. This module replaces that copy with a 3-way merge per
 * file — manifest hash (what the kit last wrote) vs the file on disk (the
 * user's side) vs the new template (the kit's side):
 *
 *   target absent ............................. write (new file / restore)
 *   user unchanged ............................ refresh silently
 *   user changed, kit unchanged ............... keep the user's file
 *   both changed, identical content ........... stamp only
 *   both changed, divergent ................... CONFLICT — the user decides
 *   no manifest baseline + target differs ..... CONFLICT (refuse to clobber)
 *   file on disk not in the templates ......... never touched (user-created)
 *
 * Conflict resolution: with a TTY the user picks per file — [b]oth (keep mine,
 * stash the kit version under `contextkit/.updates/v<version>/`), [r]eplace
 * (take the kit's, stash mine as `*.mine`), [k]eep (mine only, no stash).
 * Append 'a' to any choice (e.g. `ba` / `ra` / `ka`, also `…all` or `!`) to
 * apply it to every remaining conflict instead of being asked one by one.
 * Without a TTY the default is "both" — no side is ever lost.
 * Zero third-party deps: the installer runs via bare `npx`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { read, overwrite, ensureDir } from './fs.mjs';

const MANIFEST_REL = 'contextkit/.install-manifest.json';
const UPDATES_DIR = 'contextkit/.updates';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Yields every file under `dir` as a forward-slash relative path. */
function* walkFiles(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkFiles(join(dir, entry.name), rel);
    else yield rel;
  }
}

/** Loads the install manifest; a missing/corrupt one degrades to an empty baseline. */
export async function loadManifest(target) {
  try {
    const parsed = JSON.parse(await read(join(target, MANIFEST_REL)));
    return { schema: 1, files: parsed.files && typeof parsed.files === 'object' ? parsed.files : {} };
  } catch {
    return { schema: 1, files: {} };
  }
}

/** Persists the manifest, merging this run's stamps over the previous baseline. */
export async function saveManifest(target, sync, version) {
  const manifest = {
    schema: 1,
    version,
    updatedAt: new Date().toISOString(),
    files: { ...sync.manifest.files, ...sync.nextFiles },
  };
  await overwrite(join(target, MANIFEST_REL), JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Applies the 3-way manifest matrix to one kit-owned template file.
 * @param {string} srcPath absolute template file path
 * @param {string} target project root
 * @param {string} destRel forward-slash destination path
 * @param {{manifest:object, nextFiles:object, conflicts:Array}} sync shared sync context
 * @returns {Promise<'written'|'kept'|'conflicted'|'unchanged'>} sync outcome
 */
async function syncTemplateFile(srcPath, target, destRel, sync) {
  const destPath = join(target, ...destRel.split('/'));
  const templateBuffer = await readFile(srcPath);
  const templateHash = sha256(templateBuffer);
  if (!existsSync(destPath)) {
    await ensureDir(dirname(destPath));
    await writeFile(destPath, templateBuffer);
    sync.nextFiles[destRel] = templateHash;
    return 'written';
  }
  const currentHash = sha256(await readFile(destPath));
  if (currentHash === templateHash) {
    sync.nextFiles[destRel] = templateHash;
    return 'unchanged';
  }
  const baselineHash = sync.manifest.files[destRel];
  const userChanged = !baselineHash || currentHash !== baselineHash;
  const kitChanged = !baselineHash || templateHash !== baselineHash;
  if (!userChanged) {
    await writeFile(destPath, templateBuffer);
    sync.nextFiles[destRel] = templateHash;
    return 'written';
  }
  if (!kitChanged) {
    sync.nextFiles[destRel] = baselineHash;
    return 'kept';
  }
  sync.conflicts.push({ destRel, destPath, templateBuffer, templateHash });
  return 'conflicted';
}

/**
 * Syncs one template file into the target with the same 3-way matrix as
 * `syncTree()`. Use for single kit-owned docs such as `contextkit/README.md`.
 * @param {string} srcPath absolute template file path
 * @param {string} target project root
 * @param {string} destRel forward-slash destination path
 * @param {{manifest:object, nextFiles:object, conflicts:Array}} sync shared sync context
 * @returns {Promise<{written:number, kept:number, conflicted:number}>}
 */
export async function syncFile(srcPath, target, destRel, sync) {
  const state = await syncTemplateFile(srcPath, target, destRel, sync);
  return {
    written: state === 'written' ? 1 : 0,
    kept: state === 'kept' ? 1 : 0,
    conflicted: state === 'conflicted' ? 1 : 0,
  };
}

/**
 * Syncs one template tree into the target with the 3-way matrix above.
 * Writes safe cases immediately; defers conflicts into `sync.conflicts` so the
 * orchestrator can resolve them all in one pass (one prompt session).
 *
 * @param {string} srcDir - absolute template tree root
 * @param {string} target - project root
 * @param {string} destRelBase - forward-slash destination base (e.g. ".claude/agents")
 * @param {{manifest:object, nextFiles:object, conflicts:Array}} sync - shared sync context
 * @returns {Promise<{written:number, kept:number, conflicted:number}>}
 */
export async function syncTree(srcDir, target, destRelBase, sync) {
  const counters = { written: 0, kept: 0, conflicted: 0 };
  if (!existsSync(srcDir)) return counters;
  for (const rel of walkFiles(srcDir)) {
    const destRel = `${destRelBase}/${rel}`;
    const destPath = join(target, ...destRel.split('/'));
    const templateBuffer = await readFile(join(srcDir, rel));
    const templateHash = sha256(templateBuffer);
    if (!existsSync(destPath)) {
      await ensureDir(dirname(destPath));
      await writeFile(destPath, templateBuffer);
      sync.nextFiles[destRel] = templateHash;
      counters.written++;
      continue;
    }
    const currentHash = sha256(await readFile(destPath));
    if (currentHash === templateHash) {
      sync.nextFiles[destRel] = templateHash;
      continue;
    }
    const baselineHash = sync.manifest.files[destRel];
    const userChanged = !baselineHash || currentHash !== baselineHash;
    const kitChanged = !baselineHash || templateHash !== baselineHash;
    if (!userChanged) {
      // Only the kit moved — a normal engine refresh.
      await writeFile(destPath, templateBuffer);
      sync.nextFiles[destRel] = templateHash;
      counters.written++;
    } else if (!kitChanged) {
      // Only the user moved — their personalization, keep it silently.
      sync.nextFiles[destRel] = baselineHash;
      counters.kept++;
    } else {
      // Both moved (or no baseline to prove otherwise) — the user decides.
      sync.conflicts.push({ destRel, destPath, templateBuffer, templateHash });
      counters.conflicted++;
    }
  }
  return counters;
}

/**
 * Parses one interactive conflict answer into a resolution.
 * Base letter: 'r' (replace) or 'k' (keep); anything else → 'b' (both, the default).
 * "Apply to all remaining" is requested by appending 'a' / 'all' / '!' to the
 * letter (e.g. `ba`, `ra`, `ka`, `r all`, `keepall`, `b!`). The option words
 * themselves (`both` / `replace` / `keep`) never trigger the all-flag.
 *
 * @param {string} answer - raw user input
 * @returns {{ choice: 'b'|'r'|'k', all: boolean }}
 */
export function parseConflictChoice(answer) {
  const compact = String(answer ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const choice = compact[0] === 'r' || compact[0] === 'k' ? compact[0] : 'b';
  const all = compact.includes('all') || compact.endsWith('!') || /^[brk]a$/.test(compact);
  return { choice, all };
}

/** Stashes `content` under contextkit/.updates/v<version>/<rel>, returning the rel path. */
async function stash(target, version, rel, content) {
  const stashRel = `${UPDATES_DIR}/v${version}/${rel}`;
  const stashPath = join(target, ...stashRel.split('/'));
  await ensureDir(dirname(stashPath));
  await writeFile(stashPath, content);
  return stashRel;
}

/**
 * Resolves every collected conflict. Interactive (both stdio are TTYs): the
 * user picks per file. Non-interactive (CI / piped / --update without a
 * terminal): defaults to "both" — keeps the user's file on disk untouched and
 * stashes the kit's incoming version under `contextkit/.updates/v<version>/`
 * so no data is ever lost.
 *
 * Non-TTY conflicts are counted and surfaced on `sync.pendingMerges` so the
 * orchestrator (install.mjs / update-status.mjs) can report an honest
 * UPDATED_WITH_PENDING_MERGES status instead of a clean "UPDATED SUCCESSFULLY"
 * — the P0-07 honesty fix. The orchestrator reads `sync.pendingMerges` after
 * this call; this function only sets it.
 *
 * `sync.pendingMerges` is always initialized to 0 (even when there are no
 * conflicts) so callers can test `> 0` without an existence guard.
 *
 * @param {string} target project root
 * @param {{ manifest:object, nextFiles:object, conflicts:Array, pendingMerges:number }} sync
 *   shared sync context — `pendingMerges` is SET here (initialized to 0 first)
 * @param {string} version kit semver (used to name the stash directory)
 * @returns {Promise<string[]>} report lines for the install summary (return type unchanged)
 */
export async function resolveConflicts(target, sync, version) {
  sync.pendingMerges = 0; // always initialize so callers can rely on the field
  const lines = [];
  if (sync.conflicts.length === 0) return lines;
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let rl = null;
  if (interactive) {
    const { createInterface } = await import('node:readline/promises');
    rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\n⚠️  ${sync.conflicts.length} file(s) you personalized also changed in this kit version:`);
  }
  let sticky = null; // an "…all" pick, reused for every remaining conflict
  for (const conflict of sync.conflicts) {
    let choice = sticky || 'b';
    if (!sticky && rl) {
      const answer = await rl.question(
        `  ${conflict.destRel}\n` +
          `    [b]oth  — YOUR file stays on disk; the kit's new version is stashed under contextkit/.updates/ so you can diff & merge later\n` +
          `    [r]eplace — the KIT's version replaces your file; YOUR version is stashed as <file>.mine so you can recover it\n` +
          `    [k]eep  — YOUR file stays; the kit's version is DISCARDED (cannot be recovered)\n` +
          `    — append 'a' to apply to ALL remaining (e.g. 'ba' / 'ra' / 'ka') (b): `,
      );
      const parsed = parseConflictChoice(answer);
      choice = parsed.choice;
      if (parsed.all) {
        sticky = choice;
        console.log(`    → applying [${choice}] to all remaining conflict(s)`);
      }
    }
    if (choice === 'r') {
      const mine = await readFile(conflict.destPath);
      const stashed = await stash(target, version, `${conflict.destRel}.mine`, mine);
      await writeFile(conflict.destPath, conflict.templateBuffer);
      lines.push(`⚠️  conflict ${conflict.destRel}: replaced with the kit's — yours stashed at ${stashed}`);
    } else if (choice === 'k') {
      lines.push(`⚠️  conflict ${conflict.destRel}: kept yours (kit version discarded)`);
    } else {
      // "both": keep user's file, stash the kit's incoming version for later manual merge.
      // In non-TTY mode this is the automatic default — no user data is lost.
      const stashed = await stash(target, version, conflict.destRel, conflict.templateBuffer);
      lines.push(`⚠️  conflict ${conflict.destRel}: kept yours — kit version stashed at ${stashed} (diff & merge by hand)`);
      if (!interactive) sync.pendingMerges += 1;
    }
    sync.nextFiles[conflict.destRel] = conflict.templateHash;
  }
  rl?.close();
  return lines;
}
