#!/usr/bin/env node
/**
 * Blast-radius lookup — the transitive-consumer set of a single module, read
 * from the committed project-map manifest. GC1-T1 (WF-0071, BIZ-0004): a
 * zero-dependency "near-free" slice that answers "who breaks if I change this
 * file?" without re-scanning the tree.
 *
 * Pure consumer logic lives in `project-map-signals.mjs` (`reverseConsumers`);
 * this module only adds the manifest read + the degradation contract. Mirrors
 * `coChange`'s contract in the same sibling file (W0-contracts §16 — never
 * fabricate): when the manifest is absent or unparsable, returns
 * `{ available:false, reason, evidenceClass }` — NEVER a fabricated empty
 * consumer list counted as zero.
 *
 * Zero non-`node:` imports beyond the two sibling modules — no runtime deps
 * on the hot path (constitution immutable rule #1).
 */
import { existsSync as fileExists, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { reverseConsumers } from './project-map-signals.mjs';

/** Evidence class for this GRAPH_DERIVED signal (matches project-map-signals.mjs). */
const GRAPH_EVIDENCE_CLASS = 'GRAPH_DERIVED';

/**
 * Reads and parses the project-map manifest, stripping a leading UTF-8 BOM
 * (constitution rule #4) so `JSON.parse` never chokes on a PowerShell-written
 * file. Returns `null` on any read/parse failure — the caller degrades.
 *
 * @param {string} manifestPath absolute path to `manifest.json`
 * @returns {{modules?: Array<{path:string, deps?:string[]}>} | null}
 */
function readManifest(manifestPath) {
  if (!fileExists(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Blast radius for one module: every module that transitively imports it,
 * derived from the committed project-map manifest.
 *
 * DEGRADATION CONTRACT (mirrors `coChange` in `project-map-signals.mjs`):
 * when the manifest is missing or unparsable, returns
 * `{ available:false, reason, evidenceClass }`. A consumer MUST map that to
 * UNKNOWN/SKIPPED, never to a silent zero or PASS.
 *
 * @param {string} root project root (passed to `pathsFor` — rule 4, no
 *   hardcoded platform dir name)
 * @param {string} targetPath the module path to measure the blast radius of
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, consumers:string[], evidenceClass:string}}
 */
export function blastRadiusFor(root, targetPath) {
  const manifestPath = join(pathsFor(root).projectMap, 'manifest.json');
  const manifest = readManifest(manifestPath);

  if (!manifest || !Array.isArray(manifest.modules)) {
    return { available: false, reason: 'no project-map manifest', evidenceClass: GRAPH_EVIDENCE_CLASS };
  }

  const { consumers, evidenceClass } = reverseConsumers(manifest.modules, targetPath);
  return { available: true, consumers, evidenceClass };
}

/** Reads a single CLI flag's value (e.g. `--path a/b.js`), or `null` if absent. */
function argFlag(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

if (basename(process.argv[1] ?? '') === 'blast-radius.mjs') {
  const targetPath = argFlag('--path');
  if (!targetPath) {
    console.error('Usage: node blast-radius.mjs --path <module-path>');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(blastRadiusFor(process.cwd(), targetPath), null, 2) + '\n');
}
