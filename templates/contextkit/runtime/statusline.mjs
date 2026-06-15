#!/usr/bin/env node
/**
 * Status-line widget for Claude Code (wired as `settings.statusLine` at level >= 1).
 *
 * Prints ONE compact line about the ContextDevKit state of the current project:
 *   🌀 L6 · A3 · 11 sess · 5 ADR · 2 bklog · ✓ 3/3 evidence
 *
 * It runs on every prompt, so it stays cheap (a few directory counts + one config
 * read) and zero-dependency. It NEVER throws — on any error it prints a minimal
 * fallback so the status line can't break the session. Claude Code pipes session
 * JSON on stdin; we don't need it (we read the project at `process.cwd()`).
 *
 * Compliance segment (CDK-043, ADR-0072): advisory, read-only, fail-open.
 * Shows satisfied vs required `requiredBeforeCompletion` evidence for the active
 * task. Absent when no active task, no contract, or any read error.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathsFor, LEDGER_DIR } from './config/paths.mjs';
import { readAutonomyOverride, resolveAutonomy } from './config/resolve-autonomy.mjs';
import { readJsonSafe } from './hooks/safe-io.mjs';
import { isReceiptValid } from './execution/receipt-store.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);

function count(dir, re) {
  try {
    return readdirSync(resolve(ROOT, dir)).filter((f) => re.test(f)).length;
  } catch {
    return 0;
  }
}

function level() {
  const lvl = Number(readJsonSafe(P.config, {}).level);
  return Number.isInteger(lvl) ? lvl : null;
}

/** Effective dial grade for display — derived from the resolver (ADR-0042 §6:
 * displayed grade ≡ enforced grade); degrades to null, never breaks the line. */
function autonomyGrade() {
  try {
    return resolveAutonomy('edit', readJsonSafe(P.config, {}), readAutonomyOverride(ROOT)).grade;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Compliance segment (CDK-043, ADR-0072) — pure compute + defensive loader
// ---------------------------------------------------------------------------

/**
 * Computes the compliance badge text for the active task's beforeCompletion
 * capabilities. This function is PURE: zero I/O, no Date.now() in the
 * signature path (caller supplies `now` for deterministic testing).
 *
 * Returns a non-empty string badge when the contract has
 * `requiredBeforeCompletion` entries; returns an empty string to signal
 * "segment absent" when there is nothing meaningful to display.
 *
 * @param {{
 *   contract: object|null,
 *   receipts: object[],
 *   scope: { branch: string, taskId: string, paths?: string[] },
 *   now: number
 * }} params
 * @returns {string} badge text or '' (empty = segment absent)
 */
export function computeComplianceSegment({ contract, receipts, scope, now }) {
  if (!contract || typeof contract !== 'object') return '';
  const required = contract.requiredBeforeCompletion;
  if (!Array.isArray(required) || required.length === 0) return '';

  const receiptByCapability = new Map(
    receipts
      .filter((r) => r && typeof r.capability === 'string')
      .map((r) => [r.capability, r]),
  );

  let satisfied = 0;
  for (const cap of required) {
    const receipt = receiptByCapability.get(cap);
    if (!receipt) continue;
    const { valid } = isReceiptValid(receipt, scope, now);
    if (valid) satisfied += 1;
  }

  const total = required.length;
  return satisfied === total
    ? `✓ ${satisfied}/${total} evidence`
    : `⚠ ${satisfied}/${total} evidence`;
}

/**
 * Reads the active-task id from the most-recently-touched ledger pointer
 * (`.claude/.sessions/.last-touched`). Returns null defensively on any error.
 *
 * @returns {string|null}
 */
function readActiveTaskId() {
  try {
    const ptr = readJsonSafe(resolve(ROOT, LEDGER_DIR, '.last-touched'), null);
    if (!ptr || typeof ptr.sessionId !== 'string') return null;
    const ledger = readJsonSafe(
      resolve(ROOT, LEDGER_DIR, `${ptr.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}.json`),
      null,
    );
    return typeof ledger?.activeTask === 'string' ? ledger.activeTask : null;
  } catch {
    return null;
  }
}

/**
 * Reads all on-disk receipts for `taskId` from the pipeline state dir.
 * Defensive: never throws; returns [] on any error.
 *
 * @param {string} taskId
 * @returns {object[]}
 */
function readReceiptsSync(taskId) {
  try {
    const dir = join(P.pipeline, 'state', String(taskId), 'receipts');
    return readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => readJsonSafe(join(dir, n), null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Builds the compliance segment string for inclusion in the status line.
 * Wraps all I/O and the pure compute function in a single defensive try/catch.
 * Returns '' (empty) if anything goes wrong or there is nothing to show.
 *
 * @returns {string}
 */
function complianceSegment() {
  try {
    const taskId = readActiveTaskId();
    if (!taskId) return '';

    const contract = readJsonSafe(
      join(P.pipeline, 'state', taskId, 'execution-contract.json'),
      null,
    );
    if (!contract) return '';

    const required = contract.requiredBeforeCompletion;
    if (!Array.isArray(required) || required.length === 0) return '';

    const branch = contract.branch ?? '';
    const scope = { branch, taskId, paths: contract.signals?.paths ?? [] };
    const receipts = readReceiptsSync(taskId);

    return computeComplianceSegment({ contract, receipts, scope, now: Date.now() });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  try {
    if (!existsSync(P.platform)) {
      process.stdout.write('🌀 contextdevkit');
      return;
    }
    const lvl = level();
    const sess = count('contextkit/memory/sessions', /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/);
    const adrs = count('contextkit/memory/decisions', /^\d{4}-.+\.md$/);
    const bklog = count('contextkit/pipeline/backlog', /\.md$/);
    const grade = autonomyGrade();
    const compliance = complianceSegment();
    const parts = [
      lvl ? `L${lvl}` : null,
      grade ? `A${grade}` : null,
      `${sess} sess`,
      `${adrs} ADR`,
      `${bklog} bklog`,
      compliance || null,
    ].filter(Boolean);
    process.stdout.write(`🌀 ${parts.join(' · ')}`);
  } catch {
    process.stdout.write('🌀 contextdevkit');
  }
}

main();
