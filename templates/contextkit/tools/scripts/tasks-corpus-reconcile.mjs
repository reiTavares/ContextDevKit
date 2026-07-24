/**
 * WF-0087 TL3 — deterministic corpus reconciliation receipt (ADR-0148, D1/D3/D5).
 *
 * Enumerates every workflow in the memory corpus, builds each workflow's
 * task-status journal from its `workflow-state.json` `events[]`, and runs the
 * provenance-aware `reconcileWorkflowCorpus`. The receipt is the G-TL3 gate
 * evidence: `ready` iff ZERO in-scope workflows are `quarantined` (an inferred
 * reconciliation is corpus-safe but NON-authorizing — see `tasks-migrate.mjs`).
 *
 * Scope rules (§8 — recorded explicitly, never silently dropped):
 *   - `BIZ-0004/**` is a parallel session's corpus (forbiddenPaths); EXCLUDED,
 *     deferred to WF-0086.
 *   - WF-0087 itself is in-flight (authors its journal natively going forward);
 *     EXCLUDED from its own migration corpus.
 *
 * Read-only: no filesystem write to any workflow-state.json. Emits a receipt with
 * a per-path list so a downstream checksum manifest can pin the exact frozen set.
 * Zero-dep beyond `node:*`. Deterministic: no wall-clock in the body (an injected
 * `--generated-at` stamps the header only).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileWorkflowCorpus } from './tasks-migrate.mjs';
import { TASK_STATUS_EVENT_TYPES } from './workflow/invariants.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

/** Membership test over the single-sourced task-status event-type set. */
const isTaskStatusEvent = (type) => TASK_STATUS_EVENT_TYPES.includes(type);

/**
 * Read a BOM-tolerant JSON file, DISTINGUISHING absent from present-but-
 * unparseable. A swallowed parse error must never look like a genuinely empty
 * concluded workflow (§8): within the corpus walk a state file always exists, so
 * a parse failure is an integrity fault that must quarantine — not collapse to a
 * `ready`/`observed` empty workflow.
 *
 * @param {string} path
 * @returns {{ present: boolean, parsed: boolean, value: object|null }}
 */
function readJsonFile(path) {
  if (!existsSync(path)) return { present: false, parsed: false, value: null };
  try {
    return { present: true, parsed: true, value: JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) };
  } catch {
    return { present: true, parsed: false, value: null };
  }
}

/**
 * Build the per-task journal map from a workflow-state's `events[]`. Only
 * task-status events with a `taskId` + string `status` contribute; a `to` is
 * synthesised for `foldStatus` when the event predates the `from/to` shape.
 *
 * @param {object} state a workflow-state.json object
 * @returns {Record<string, Array<object>>} taskId → journal events
 */
function journalsFromState(state) {
  const journals = {};
  for (const event of Array.isArray(state?.events) ? state.events : []) {
    if (!event?.taskId || !isTaskStatusEvent(event.type)) continue;
    const to = typeof event.to === 'string' ? event.to : event.status;
    (journals[event.taskId] ||= []).push({ from: event.from ?? null, to, ...event });
  }
  return journals;
}

/** True when a workflow directory belongs to the BIZ-0004 corpus (forbidden). */
function isBiz0004(dir) {
  return /[\\/]BIZ-0004-/.test(dir);
}

/** True when a workflow directory is WF-0087 itself (in-flight self). */
function isSelf(dir) {
  return /WF-0087-op-0004-task-ledger-integration-and-migration/.test(dir);
}

/** True when a directory is a scaffold template, not a real workflow (`_TEMPLATE`). */
function isTemplate(dir) {
  return /[\\/]_TEMPLATE([\\/]|$)/.test(dir);
}

/**
 * Enumerate EVERY workflow directory (any dir holding a `workflow-state.json`)
 * anywhere under the memory root — a full recursive walk, never a fixed root
 * list. This is deliberate (§8: refuse a silent omission): a hardcoded root set
 * (e.g. the fresh-install `contextkit/workflows` layout) misses this dogfood's
 * legacy `contextkit/memory/workflows/*` states, which would let the gate go
 * green while skipping a real workflow. `_TEMPLATE` scaffolds are excluded.
 *
 * @param {string} root project/worktree root
 * @returns {string[]} absolute workflow directory paths (sorted, deduped)
 */
function enumerateWorkflowDirs(root) {
  const memoryRoot = pathsFor(root).memory;
  if (!memoryRoot || !existsSync(memoryRoot)) return [];
  const dirs = new Set();
  const stack = [memoryRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(current, entry.name);
      if (existsSync(join(child, 'workflow-state.json'))) dirs.add(child);
      stack.push(child);
    }
  }
  return [...dirs].filter((dir) => !isTemplate(dir)).sort();
}

/**
 * Reconcile the whole corpus into a deterministic receipt.
 *
 * @param {string} root project/worktree root
 * @param {string} generatedAt injected header stamp (no wall-clock in the body)
 * @returns {object} the corpus receipt
 */
export function reconcileCorpusReceipt(root, generatedAt) {
  const dirs = enumerateWorkflowDirs(root);
  const refs = [];
  const pathIndex = [];
  for (const dir of dirs) {
    const planRead = readJsonFile(join(dir, 'workflow-plan.json'));
    const stateRead = readJsonFile(join(dir, 'workflow-state.json'));
    const plan = planRead.value;
    const state = stateRead.value;
    const rel = relative(root, dir).replace(/\\/g, '/');
    const excluded = isBiz0004(dir) || isSelf(dir);
    const exclusionReason = isBiz0004(dir)
      ? 'BIZ-0004 parallel session (deferred to WF-0086)'
      : isSelf(dir) ? 'WF-0087 in-flight self (native journal go-forward)' : null;
    // A present-but-unparseable plan or state is an integrity fault → quarantine,
    // NEVER a silent empty-ready workflow (§8: a swallowed parse error must not
    // look like a genuinely empty concluded workflow).
    const unreadable = (planRead.present && !planRead.parsed) || (stateRead.present && !stateRead.parsed);
    if (excluded) {
      refs.push({ plan: plan || { workflowId: rel }, excluded: true, exclusionReason });
    } else if (unreadable) {
      refs.push({ plan: plan || { workflowId: rel }, unreadable: true, workflowId: plan?.workflowId ?? rel });
    } else {
      refs.push({ plan, workflowState: state, journals: journalsFromState(state) });
    }
    pathIndex.push({ path: `${rel}/workflow-state.json`, workflowId: plan?.workflowId ?? rel, excluded });
  }
  const receipt = reconcileWorkflowCorpus(refs);
  const inferred = receipt.results.filter((result) => result.status === 'reconciled-by-inference').length;
  const ready = receipt.results.filter((result) => result.status === 'ready').length;
  const quarantined = receipt.results
    .filter((result) => result.status === 'quarantined')
    .map((result) => result.workflowId);
  return {
    kind: 'wf-0087-tl3-corpus-reconcile',
    generatedAt,
    status: receipt.status,
    workflowCount: receipt.workflowCount,
    counts: { ready, reconciledByInference: inferred, quarantined: quarantined.length, excluded: receipt.excluded.length },
    quarantined,
    excluded: receipt.excluded,
    frozenPaths: pathIndex.filter((entry) => !entry.excluded).map((entry) => entry.path),
    excludedPaths: pathIndex.filter((entry) => entry.excluded).map((entry) => entry.path),
  };
}

/** CLI: `node tasks-corpus-reconcile.mjs [--write <path>] [--generated-at <iso>]`. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const writeAt = argv.includes('--write') ? argv[argv.indexOf('--write') + 1] : null;
  const stampIndex = argv.indexOf('--generated-at');
  const generatedAt = stampIndex >= 0 ? argv[stampIndex + 1] : new Date().toISOString();
  const receipt = reconcileCorpusReceipt(process.cwd(), generatedAt);
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (writeAt) {
    writeFileSync(writeAt, text, 'utf8');
    console.log(`corpus receipt written to ${writeAt} — status ${receipt.status}`);
  } else {
    process.stdout.write(text);
  }
  process.exit(receipt.status === 'quarantined' ? 1 : 0);
}
