#!/usr/bin/env node
/**
 * `docs-public-lint.mjs` — banned-token + secret-leak scanner for public docs.
 *
 * Reads `docs/.public-projection.json` as its single source of truth and greps
 * ONLY the enumerated public path-set. Internal paths are never scanned.
 * Usable as a CLI check (exits non-zero on hits) OR as a library (`lintPublicDocs`).
 *
 * Zero runtime dependencies — node:fs, node:path, node:url only (ADR-0001).
 * Constitution §8: missing policy file → exit non-zero (never a silent pass).
 *
 * DOC-005 / WF0016 / ADR-0075
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip a UTF-8 BOM before JSON.parse (immutable rule 4).
 * @param {string} text
 * @returns {string}
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Normalise a filesystem path to forward-slashes for comparison and reporting.
 * @param {string} filePath
 * @returns {string}
 */
function toForwardSlash(filePath) {
  return filePath.replace(/\\/g, '/');
}

/**
 * Recursively walk a directory and collect `*.md` files.
 * @param {string} dir  Absolute path to directory.
 * @param {string[]} accumulator  Collects found file paths (mutated in-place).
 */
function walkMarkdown(dir, accumulator) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      walkMarkdown(full, accumulator);
    } else if (stat.isFile() && entry.endsWith('.md')) {
      accumulator.push(full);
    }
  }
}

/**
 * Resolve concrete file paths to scan from publicPaths in the policy.
 * Directories expand to all `*.md` files; plain file entries are added as-is.
 * Missing entries are collected in `skipped`.
 *
 * @param {string} root
 * @param {string[]} publicPaths
 * @param {string[]} internalPaths
 * @returns {{ files: string[], skipped: string[] }}
 */
function resolveTargetFiles(root, publicPaths, internalPaths) {
  const internalAbsolute = internalPaths.map((p) => toForwardSlash(resolve(root, p)));

  function isInternal(absFile) {
    const fwd = toForwardSlash(absFile);
    return internalAbsolute.some((i) => fwd.startsWith(i + '/') || fwd === i);
  }

  const files = [];
  const skipped = [];

  for (const entry of publicPaths) {
    const absEntry = resolve(root, entry);
    if (!existsSync(absEntry)) { skipped.push(entry); continue; }
    let stat;
    try { stat = statSync(absEntry); } catch { skipped.push(entry); continue; }
    if (stat.isDirectory()) {
      const found = [];
      walkMarkdown(absEntry, found);
      for (const f of found) { if (!isInternal(f)) files.push(f); }
    } else if (stat.isFile()) {
      if (!isInternal(absEntry)) files.push(absEntry);
    }
  }

  return { files, skipped };
}

/**
 * Compile pattern descriptor arrays from the policy into live RegExp instances.
 * `scope === 'prose'` tokens are exempt inside fenced/inline code;
 * `scope === 'all'` (default) tokens scan everywhere, code included.
 *
 * @param {Array<{id:string, pattern:string, flags:string, reason:string, scope?:string}>} entries
 * @returns {Array<{id:string, re:RegExp, reason:string, scope:string}>}
 */
function compilePatterns(entries) {
  return entries.map(({ id, pattern, flags, reason, scope }) => ({
    id, re: new RegExp(pattern, flags), reason,
    scope: scope === 'prose' ? 'prose' : 'all',
  }));
}

/**
 * Build a fast-lookup set from the merged allow list.
 * Key format: `"<forwardSlashFilePath>|<tokenId>"`.
 *
 * @param {string} root
 * @param {Array<{file:string, tokens:string[]}>} allowList
 * @returns {Set<string>}
 */
function buildAllowSet(root, allowList) {
  const set = new Set();
  for (const { file, tokens } of allowList) {
    const absFile = toForwardSlash(resolve(root, file));
    for (const tokenId of tokens) set.add(`${absFile}|${tokenId}`);
  }
  return set;
}

/**
 * Scan a single markdown file for banned tokens and secret-shaped patterns,
 * honouring the allow set.
 *
 * @param {string} absFile
 * @param {string} root
 * @param {Array<{id:string, re:RegExp, reason:string, scope:string}>} patterns
 * @param {Set<string>} allowSet
 * @returns {Array<{file:string, line:number, token:string, reason:string}>}
 */
function scanFile(absFile, root, patterns, allowSet) {
  const hits = [];
  let content;
  try { content = readFileSync(absFile, 'utf-8'); } catch { return hits; }
  content = stripBom(content);
  const displayPath = toForwardSlash(relative(root, absFile));
  const absFileFwd = toForwardSlash(absFile);
  const lines = content.split('\n');

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNum = i + 1;
    const fenceDelim = /^\s*(```|~~~)/.test(lineText);
    if (fenceDelim) inFence = !inFence;
    const proseText = lineText.replace(/`[^`]*`/g, '');
    for (const { id, re, reason, scope } of patterns) {
      let target;
      if (scope === 'prose') {
        if (inFence || fenceDelim) continue;
        target = proseText;
      } else {
        target = lineText;
      }
      re.lastIndex = 0;
      if (re.test(target)) {
        re.lastIndex = 0;
        if (allowSet.has(`${absFileFwd}|${id}`)) continue;
        hits.push({ file: displayPath, line: lineNum, token: id, reason });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Lint the public documentation surface for banned tokens and secret-shaped
 * leaks, using `docs/.public-projection.json` as the single source of truth.
 *
 * @param {string} root  Absolute path to the project root.
 * @param {{ allow?: Array<{file:string, tokens:string[], reason:string}> }} [options]
 *   Extra allow-list entries merged with the policy's `allow` array.
 * @returns {{ hits: Array<{file:string, line:number, token:string, reason:string}>, ok: boolean }}
 * @throws {Error}  When the policy file is missing or unparseable.
 */
export function lintPublicDocs(root, { allow: extraAllow = [] } = {}) {
  const policyPath = resolve(root, 'docs', '.public-projection.json');

  if (!existsSync(policyPath)) {
    throw new Error(`Policy file not found: ${policyPath} — cannot lint without a source of truth.`);
  }

  let policy;
  try {
    policy = JSON.parse(stripBom(readFileSync(policyPath, 'utf-8')));
  } catch (err) {
    throw new Error(`Failed to parse policy file ${policyPath}: ${err.message}`);
  }

  const {
    publicPaths = [], internalPaths = [], bannedTokens = [],
    secretShaped = [], allow: policyAllow = [],
  } = policy;

  const allowSet = buildAllowSet(root, [...policyAllow, ...extraAllow]);
  const patterns = compilePatterns([...bannedTokens, ...secretShaped]);
  const { files } = resolveTargetFiles(root, publicPaths, internalPaths);

  const hits = [];
  for (const absFile of files) hits.push(...scanFile(absFile, root, patterns, allowSet));

  return { hits, ok: hits.length === 0 };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Returns true when this module is the direct entry point.
 * @returns {boolean}
 */
function isMain() {
  try {
    return process.argv[1] && toForwardSlash(process.argv[1]) === toForwardSlash(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) {
  // Script lives at <root>/templates/contextkit/tools/scripts/ — 4 levels deep.
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const rootFlagIdx = process.argv.indexOf('--root');
  const projectRoot =
    rootFlagIdx !== -1 && process.argv[rootFlagIdx + 1]
      ? resolve(process.argv[rootFlagIdx + 1])
      : resolve(scriptDir, '..', '..', '..', '..');

  let result;
  try {
    result = lintPublicDocs(projectRoot);
  } catch (err) {
    process.stderr.write(`docs-public-lint: FATAL: ${err.message}\n`);
    process.exit(1);
  }

  const { hits, ok } = result;

  if (ok) {
    process.stdout.write('docs-public-lint: OK — no banned tokens or secret-shaped leaks found in public docs.\n');
    process.exit(0);
  }

  process.stdout.write(`docs-public-lint: ${hits.length} hit(s) found in public docs:\n`);
  for (const { file, line, token, reason } of hits) {
    process.stdout.write(`  ${file}:${line}  [${token}]  ${reason}\n`);
  }
  process.exit(1);
}
