#!/usr/bin/env node
/**
 * quota-snapshot.mjs - explicit writer for advisory quota snapshots.
 *
 * WHY: token-report can summarize quota data, but the platform had no first-party
 * command to write a metadata-only observation. This CLI is intentionally
 * explicit and dry-run by default; `--write` is required before it appends to
 * the JSONL substrate.
 *
 * Zero runtime dependencies: node:* plus sibling quota modules.
 *
 * @module economics/quota-snapshot
 */
import { join, resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import {
  buildSnapshot,
  appendSnapshot,
  readSnapshots,
  quotaSummary,
  presentQuota,
} from './quota-snapshots.mjs';

/** CLI result schema for machine-readable callers. */
export const QUOTA_SNAPSHOT_CLI_SCHEMA_VERSION = 'cdk-quota-snapshot-cli/1';

/** Prints usage text. */
function usage() {
  return [
    'Usage: quota-snapshot.mjs --host <host> [quota flags] [--write] [--json]',
    '',
    'Quota flags:',
    '  --plan <name>              plan or tier label',
    '  --window-type <type>       quota window type (daily, weekly, rolling, etc.)',
    '  --window-start <iso>       quota window start',
    '  --reset-at <iso>           expected quota reset timestamp',
    '  --remaining-pct <0-100>    observed remaining quota percentage',
    '  --used-pct <0-100>         observed used quota percentage',
    '  --capture-method <method>  api | manual | inferred (default manual)',
    '  --source <id>              caller/source command id',
    '  --session-id <id>          optional session linkage',
    '  --run-id <id>              optional run linkage',
    '  --task-id <id>             optional task linkage',
    '  --file <path>              override JSONL destination',
    '',
    'Dry-run is the default. Pass --write to append.',
  ].join('\n');
}

/**
 * Parses argv into flags. Last value wins; boolean flags are true.
 *
 * @param {string[]} argv raw CLI args excluding node/script.
 * @returns {Record<string, string|boolean>}
 */
export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'write' || key === 'json' || key === 'help') {
      flags[key] = true;
      continue;
    }
    flags[key] = argv[i + 1] ?? '';
    i++;
  }
  return flags;
}

/** Converts a pct flag to a number or undefined. */
function pctFlag(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Returns the default append-only JSONL path for this project. */
export function defaultQuotaFile(root) {
  return join(pathsFor(root).memory, 'quota-snapshots.jsonl');
}

/**
 * Builds the snapshot input from parsed flags.
 *
 * @param {Record<string, string|boolean>} flags
 * @returns {object}
 */
function inputFromFlags(flags) {
  return {
    host: flags.host,
    plan: flags.plan,
    windowType: flags['window-type'],
    windowStart: flags['window-start'],
    resetAt: flags['reset-at'],
    remainingPct: pctFlag(flags['remaining-pct'] ?? flags.remaining),
    usedPct: pctFlag(flags['used-pct'] ?? flags.used),
    captureMethod: flags['capture-method'],
    source: flags.source,
    sessionId: flags['session-id'],
    runId: flags['run-id'],
    taskId: flags['task-id'],
  };
}

/**
 * Executes the quota snapshot command. Side effects occur only with `write:true`.
 *
 * @param {Record<string, string|boolean>} flags parsed CLI flags.
 * @param {{ root?: string, now?: number }} [opts]
 * @returns {object} machine-readable command receipt.
 */
export function runQuotaSnapshot(flags, opts = {}) {
  const root = opts.root || process.cwd();
  const file = typeof flags.file === 'string' && flags.file.trim()
    ? resolve(root, flags.file)
    : defaultQuotaFile(root);
  const snapshot = buildSnapshot(inputFromFlags(flags), { now: opts.now });

  if (snapshot.status === 'skipped') {
    return Object.freeze({
      schemaVersion: QUOTA_SNAPSHOT_CLI_SCHEMA_VERSION,
      status: 'skipped',
      reason: snapshot.reason,
      applied: false,
      file,
    });
  }

  const before = readSnapshots(file).length;
  const shouldWrite = flags.write === true;
  if (shouldWrite) appendSnapshot(snapshot, file);
  const after = readSnapshots(file).length;

  return Object.freeze({
    schemaVersion: QUOTA_SNAPSHOT_CLI_SCHEMA_VERSION,
    status: shouldWrite ? 'ok' : 'dry-run',
    applied: shouldWrite && after > before,
    idempotentNoop: shouldWrite && after === before,
    file,
    before,
    after,
    snapshot,
    summary: shouldWrite ? quotaSummary(readSnapshots(file)) : null,
  });
}

/** Human-readable receipt for terminal usage. */
function presentReceipt(receipt) {
  if (receipt.status === 'skipped') {
    return `quota-snapshot: skipped (${receipt.reason})`;
  }
  if (receipt.status === 'dry-run') {
    return [
      'quota-snapshot: dry-run (pass --write to append)',
      `  file: ${receipt.file}`,
      `  host: ${receipt.snapshot.host}`,
      `  fingerprint: ${receipt.snapshot.fingerprint}`,
    ].join('\n');
  }
  const writeLine = receipt.applied
    ? `quota-snapshot: wrote ${receipt.file}`
    : `quota-snapshot: idempotent no-op ${receipt.file}`;
  return [
    writeLine,
    `  fingerprint: ${receipt.snapshot.fingerprint}`,
    presentQuota(receipt.summary),
  ].join('\n');
}

if (process.argv[1]?.endsWith('quota-snapshot.mjs')) {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(usage() + '\n');
    process.exit(0);
  }
  const receipt = runQuotaSnapshot(flags, { now: Date.now() });
  process.stdout.write(
    flags.json
      ? JSON.stringify(receipt, null, 2) + '\n'
      : presentReceipt(receipt) + '\n',
  );
}
