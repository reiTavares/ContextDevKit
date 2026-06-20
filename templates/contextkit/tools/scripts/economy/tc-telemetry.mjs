/**
 * Task-Compiler: packet-cost + escalation telemetry — I/O + public API
 * (WF0022 / ADR-0087..0090).
 *
 * Single responsibility: JSONL persistence (append + read) and the public
 * entry-point API. Pure logic (validators, record builders, summarize,
 * present) lives in tc-telemetry-core.mjs; this file only wires them to
 * filesystem I/O and re-exports the stable public surface.
 *
 * Split rationale: I/O (node:fs, ledger path handling, BOM-strip) is a
 * distinct concern from analytics; tc-telemetry-core.mjs has no node:fs
 * dependency so it can be unit-tested without touching the filesystem.
 *
 * Design invariants:
 *   - ZERO HOT-PATH DEPS: node:* + relative imports only.
 *   - FAIL-FAST VALIDATE: record constructors in core throw typed errors.
 *   - DEFENSIVE READ: missing / unreadable ledger → []; never throws.
 *   - BOM-STRIP before JSON.parse (Windows / PowerShell 5.1 compat).
 *   - caller passes ledger file path; contextkit/ never hardcoded.
 *   - Phase-1 read/compile-only: never mutates source files.
 *
 * // consumes: economics/usage-event.mjs → SCHEMA_VERSION, normalizeEvent()
 *              (imported via tc-telemetry-core.mjs for eacp family alignment)
 *
 * [task-compiler] [token-economy] [WF0022] [ADR-0087]
 */
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname }                                 from 'node:path';
import {
  TC_TELEMETRY_SCHEMA_VERSION,
  buildPacketCostEvent,
  buildEscalationEvent,
  summarizeTelemetry,
  presentTelemetry,
} from './tc-telemetry-core.mjs';

// Re-export the full public API so callers need only one import.
export {
  TC_TELEMETRY_SCHEMA_VERSION,
  summarizeTelemetry,
  presentTelemetry,
};

// ---------------------------------------------------------------------------
// Internal JSONL persistence helpers
// ---------------------------------------------------------------------------

/**
 * Appends a single validated telemetry event to the JSONL ledger.
 * Creates parent directories as needed.
 *
 * @param {object} event        - Fully-formed telemetry event from a builder.
 * @param {string} ledgerFile   - Absolute path to the JSONL ledger.
 * @returns {void}
 */
function appendEvent(event, ledgerFile) {
  mkdirSync(dirname(ledgerFile), { recursive: true });
  appendFileSync(ledgerFile, JSON.stringify(event) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// recordPacketCost
// ---------------------------------------------------------------------------

/**
 * Validates and appends a packet-cost event to the JSONL ledger.
 *
 * All cost fields are in USD. qaGreen must be an explicit boolean —
 * constitution §8: callers must assert QA outcome; null is refused.
 *
 * @param {{
 *   taskId:        string,
 *   route:         string,
 *   model:         string,
 *   inputTokens:   number,
 *   outputTokens:  number,
 *   compileCost:   number,
 *   executionCost: number,
 *   qaGreen:       boolean,
 *   capturedAt?:   string | number | null
 * }} record - Telemetry fields for one completed task.
 * @param {string} file - Absolute path to the JSONL ledger.
 * @returns {void}
 * @throws {TypeError|RangeError} On invalid or missing required fields.
 */
export function recordPacketCost(record, file) {
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new TypeError('tc-telemetry recordPacketCost: file must be a non-empty string');
  }
  appendEvent(buildPacketCostEvent(record), file);
}

// ---------------------------------------------------------------------------
// recordEscalation
// ---------------------------------------------------------------------------

/**
 * Validates and appends an escalation event to the JSONL ledger.
 *
 * Escalation occurs when the execution ladder steps up from a cheaper tier
 * to a more capable one (e.g. scripts → haiku → sonnet).
 *
 * @param {{
 *   taskId:      string,
 *   fromTier:    string,
 *   toTier:      string,
 *   trigger:     string,
 *   retryCount:  number,
 *   capturedAt?: string | number | null
 * }} record - Escalation telemetry.
 * @param {string} file - Absolute path to the JSONL ledger.
 * @returns {void}
 * @throws {TypeError|RangeError} On invalid or missing required fields.
 */
export function recordEscalation(record, file) {
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new TypeError('tc-telemetry recordEscalation: file must be a non-empty string');
  }
  appendEvent(buildEscalationEvent(record), file);
}

// ---------------------------------------------------------------------------
// readTelemetry
// ---------------------------------------------------------------------------

/**
 * Reads all telemetry events from a JSONL ledger. Missing or unreadable file
 * returns []. Blank lines and malformed JSON are silently skipped. Never throws.
 * Strips a leading BOM before parsing (PowerShell 5.1 / Windows compat).
 *
 * @param {string} file - Path to the JSONL telemetry ledger.
 * @returns {object[]} Parsed events (may be empty).
 */
export function readTelemetry(file) {
  let raw;
  try { raw = readFileSync(file, 'utf-8'); } catch { return []; }
  // Strip BOM if present (Windows PowerShell 5.1 writes UTF-8+BOM)
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const events = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch { /* skip malformed JSONL */ }
  }
  return events;
}
