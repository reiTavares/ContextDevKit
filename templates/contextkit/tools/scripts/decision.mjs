#!/usr/bin/env node
/**
 * `decision` — the single public CLI entry point for the Decision / ADR domain
 * (BIZ-0001 / WF-0037, Wave 3). Atomic, idempotent, receipt-producing. Mutators
 * are DRY-RUN BY DEFAULT (constitution §8 — `--apply` writes).
 *
 * THIN DISPATCHER ONLY (constitution §2 + work.mjs convention): this file parses
 * argv and routes to a verb handler in a `decision-cli-*` helper or backing module.
 * No logic lives here. Zero runtime dependencies — `node:*` + siblings (rule 1).
 *
 * Verbs:
 *   need           Classify whether a decision is needed for a given objective.
 *   search         Search the decision registry for coverage matches.
 *   classify       Classify a decision file (new / legacy / unknown + validation).
 *   create         Render a new ADR from a template and write it atomically.
 *   link           Append a governing ADR reference to an entity JSON.
 *   accept         Stamp an ADR as accepted (human actor only).
 *   supersede      Mark an old ADR superseded; plan the new ADR record.
 *   registry       Build/refresh the decision-registry.json index.
 *   render         Print the human-readable decision catalog.
 *   validate       Validate one or all ADR front-matter files.
 *   migrate-legacy File loose top-level ADRs into owned subdirectories.
 *
 * @example node decision.mjs registry --json
 * @example node decision.mjs create --id ADR-0126 --kind ARCHITECTURE --title "Auth layer" --primary-context BIZ-0001 --apply
 * @example node decision.mjs accept --id ADR-0125 --actor human --apply
 */
import { parseArgs, resolvePosture, formatReceipt, makeReceipt } from './work-io.mjs';
import { handleCreate } from './decision-cli-create.mjs';
import { handleAccept, handleLink, handleSupersede } from './decision-cli-lifecycle.mjs';
import { handleRegistry, handleRender, handleMigrateLegacy } from './decision-cli-registry.mjs';
import { classifyDecisionNeed } from '../../runtime/execution/decision-need-classifier.mjs';
import { searchDecisions } from './decision-search-match.mjs';
import { classifyDecisionFile, validateDecision } from '../../runtime/work/schema-decision.mjs';
import { buildDecisionRegistry } from './registry/decision.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';

// ---------------------------------------------------------------------------
// Read-only verb helpers (need, search, classify, validate)
// ---------------------------------------------------------------------------

/**
 * `need` verb — classify whether a decision is required for an objective.
 * Delegates to `classifyDecisionNeed` (fail-open, never throws).
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {string} args.root  - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
function handleNeed({ flags, root }) {
  const objective = String(flags.objective || flags.goal || '');
  const signals = {
    objective,
    touchedPaths: String(flags.paths || '').split(',').filter(Boolean),
    workKind: String(flags['work-kind'] || flags.workKind || ''),
  };
  const registry = buildDecisionRegistry(root);
  const result = classifyDecisionNeed({ signals, decisionRegistry: registry, platformRoot: root });
  return makeReceipt({
    command: 'need',
    applied: false,
    writes: [],
    detail: result,
  });
}

/**
 * `search` verb — find matching decisions for a given objective/triple.
 * Requires a registry; delegates to `searchDecisions` (fail-open, never throws).
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {string} args.root  - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
function handleSearch({ flags, root }) {
  const objective = String(flags.objective || flags.goal || '');
  const registry = buildDecisionRegistry(root);
  const need = {
    triple: { primaryContextType: null, decisionKind: null, decisionScope: null },
    objective,
    work: {},
    signals: { objective },
    materialityScore: 0,
    needVerdict: 'recommended',
  };
  const result = searchDecisions(registry, need);
  return makeReceipt({
    command: 'search',
    applied: false,
    writes: [],
    detail: result,
  });
}

/**
 * `classify` verb — classify a single decision file or all files in the tree.
 * When `--file` is given, classifies that one file. Otherwise scans decisions/.
 * Never throws; uses `classifyDecisionFile` (fail-open on bad input).
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {string} args.root  - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
function handleClassify({ flags, root }) {
  const filePath = String(flags.file || '');
  if (filePath) {
    const absPath = /^(?:\/|[A-Za-z]:)/.test(filePath) ? resolve(filePath) : resolve(root, filePath);
    if (!existsSync(absPath)) throw new Error(`decision classify: file not found: ${absPath}`);
    const contents = stripBom(readFileSync(absPath, 'utf-8'));
    const result = classifyDecisionFile(absPath.split(/[\\/]/).pop(), contents);
    return makeReceipt({ command: 'classify', applied: false, writes: [], detail: { file: absPath, result } });
  }
  // Scan all decisions in known directories.
  const paths = pathsFor(root);
  const scanDirs = [paths.decisions, paths.decisionsBusiness, paths.decisionsOperations, paths.decisionsLegacy].filter(Boolean);
  const rows = [];
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const abs = resolve(dir, entry.name);
      const text = stripBom(readFileSync(abs, 'utf-8'));
      rows.push({ file: abs, result: classifyDecisionFile(entry.name, text) });
    }
  }
  return makeReceipt({ command: 'classify', applied: false, writes: [], detail: { scanned: rows.length, rows } });
}

/**
 * `validate` verb — validate ADR front-matter against the v2 schema.
 * When `--file` is given, validates that one file. Otherwise validates all.
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {string} args.root  - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 */
function handleValidate({ flags, root }) {
  const filePath = String(flags.file || '');
  if (filePath) {
    const absPath = /^(?:\/|[A-Za-z]:)/.test(filePath) ? resolve(filePath) : resolve(root, filePath);
    if (!existsSync(absPath)) throw new Error(`decision validate: file not found: ${absPath}`);
    const contents = stripBom(readFileSync(absPath, 'utf-8'));
    const classified = classifyDecisionFile(absPath.split(/[\\/]/).pop(), contents);
    const validation = classified.data ? validateDecision(classified.data) : { ok: false, errors: ['not a v2 decision file'] };
    const ok = validation.ok;
    return makeReceipt({ command: 'validate', applied: false, writes: [], detail: { file: absPath, ok, errors: validation.errors } });
  }
  // Scan + validate all.
  const paths = pathsFor(root);
  const scanDirs = [paths.decisionsBusiness, paths.decisionsOperations].filter(Boolean);
  const results = [];
  let allOk = true;
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const abs = resolve(dir, entry.name);
      const text = stripBom(readFileSync(abs, 'utf-8'));
      const classified = classifyDecisionFile(entry.name, text);
      const validation = classified.data ? validateDecision(classified.data) : { ok: false, errors: ['not a v2 decision file'] };
      if (!validation.ok) allOk = false;
      results.push({ file: abs, ok: validation.ok, errors: validation.errors });
    }
  }
  return makeReceipt({ command: 'validate', applied: false, writes: [], detail: { allOk, scanned: results.length, results } });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches one parsed invocation to its verb handler.
 *
 * @param {object} parsed - `{ command, positionals, flags }` from `parseArgs`.
 * @param {{ root?: string }} [env] - injectable environment (tests pass a root).
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on unknown verb or handler error.
 */
export function dispatch(parsed, env = {}) {
  const root = env.root || process.cwd();
  const { apply } = resolvePosture(parsed.flags);
  const ctx = { flags: parsed.flags, apply, root };
  switch (parsed.command) {
    case 'need':          return handleNeed(ctx);
    case 'search':        return handleSearch(ctx);
    case 'classify':      return handleClassify(ctx);
    case 'create':        return handleCreate(ctx);
    case 'link':          return handleLink(ctx);
    case 'accept':        return handleAccept(ctx);
    case 'supersede':     return handleSupersede(ctx);
    case 'registry':      return handleRegistry(ctx);
    case 'render':        return handleRender(ctx);
    case 'validate':      return handleValidate(ctx);
    case 'migrate-legacy': return handleMigrateLegacy(ctx);
    default:
      throw new Error(
        `decision: unknown verb "${parsed.command || ''}". ` +
        `Try: need | search | classify | create | link | accept | supersede | registry | render | validate | migrate-legacy`,
      );
  }
}

/** CLI bootstrap — parse argv, dispatch, print receipt (JSON or human). */
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { json } = resolvePosture(parsed.flags);
  try {
    const receipt = dispatch(parsed);
    if (json) {
      // For render verb, print catalog as-is if available, then receipt.
      if (parsed.command === 'render' && receipt.detail?.catalog) {
        process.stdout.write(`${receipt.detail.catalog}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      }
    } else {
      if (parsed.command === 'render' && receipt.detail?.catalog) {
        process.stdout.write(`${receipt.detail.catalog}\n`);
      } else {
        process.stdout.write(`${formatReceipt(receipt)}\n`);
      }
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('decision.mjs')) {
  main();
}
