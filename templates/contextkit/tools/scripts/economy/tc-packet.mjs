/**
 * Task-Compiler: work-packet builder (WF0022 / ADR-0087..0090).
 *
 * Single responsibility: compile a MINIMAL work-packet — the specific file,
 * symbol, and line range needed to fix a task — instead of dumping an entire
 * package (1-3k tokens vs 10-40k). Compile-only: this module NEVER edits code.
 * `claim` and `cost` are always null (not our concern at compile time).
 *
 * Design invariants:
 *   - DETERMINISTIC: no Date.now()/Math.random()/new Date(). Callers inject
 *     `now` (ISO string or epoch) when a timestamp is needed; default null.
 *   - ZERO HOT-PATH DEPS: node:* + relative imports only.
 *   - SKIPPED-NOT-PASSED: when a symbol cannot be located the function returns
 *     a skipped() marker — never count absence as a pass (constitution §8).
 *   - FROZEN OUTPUT: all returned packets are Object.freeze()'d so callers
 *     cannot accidentally mutate them downstream.
 *
 * [task-compiler] [token-economy] [WF0022]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDenseIndex } from '../project-map-dense.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for all packets produced by this module. */
export const WORK_PACKET_SCHEMA_VERSION = 'cdk-work-packet/1';

// ---------------------------------------------------------------------------
// Symbol-range detector
// ---------------------------------------------------------------------------

/**
 * Regex patterns that identify a symbol declaration line.
 * Ordered: most-specific first, so class beats func for names like `classFoo`.
 * @type {RegExp[]}
 */
const DECLARATION_PATTERNS = [
  /\bclass\s+(\w+)/,
  /\bfunction\s+(\w+)/,
  /\bfunc\s+(\w+)/,
  /\bdef\s+(\w+)/,
  /\btype\s+(\w+)\s/,
  /\bconst\s+(\w+)/,
  /\blet\s+(\w+)/,
  /\bvar\s+(\w+)/,
];

/** Maximum line span for a single symbol block (guards against runaway scans). */
const MAX_SPAN = 80;

/**
 * Given a file's full text and a symbol name, returns the 1-based {start, end}
 * line range of the symbol's definition block.
 *
 * Algorithm:
 *   1. Find the first line that declares `symbol` via any known pattern.
 *   2. For brace-languages: balance `{`/`}` from that line forward (cap at
 *      MAX_SPAN). For indent-languages (Python): extend while indent > 0.
 *   3. For single-line declarations (no opening brace / empty body): end = start.
 *
 * @param {string} text   - full file content
 * @param {string} symbol - symbol name to locate (exact identifier match)
 * @returns {{ start: number, end: number } | null}
 */
export function symbolRange(text, symbol) {
  if (!text || !symbol) return null;
  const lines = text.split('\n');
  let startLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of DECLARATION_PATTERNS) {
      const match = pat.exec(line);
      if (match && match[1] === symbol) {
        startLine = i;
        break;
      }
    }
    if (startLine !== -1) break;
  }

  if (startLine === -1) return null;

  // Detect block style from the declaration line and the next few lines.
  const declarationText = lines.slice(startLine, Math.min(startLine + 3, lines.length)).join('\n');
  const usesBraces = declarationText.includes('{');

  if (!usesBraces) {
    // Python-style or single-line: measure by indent depth of body lines.
    const baseIndent = (lines[startLine].match(/^(\s*)/) || ['', ''])[1].length;
    let endLine = startLine;
    for (let i = startLine + 1; i < lines.length && i - startLine < MAX_SPAN; i++) {
      const trimmed = lines[i].trimEnd();
      if (trimmed.length === 0) continue; // blank lines are part of the block
      const indent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
      if (indent <= baseIndent) break;
      endLine = i;
    }
    return { start: startLine + 1, end: endLine + 1 };
  }

  // Brace-balanced scan (C / Go / JS / TS / Rust).
  let depth = 0;
  let opened = false;
  let endLine = startLine;

  for (let i = startLine; i < lines.length && i - startLine < MAX_SPAN; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') { depth--; }
    }
    endLine = i;
    if (opened && depth <= 0) break;
  }

  return { start: startLine + 1, end: endLine + 1 };
}

// ---------------------------------------------------------------------------
// Skipped marker (inline fallback when economics/privacy.mjs unavailable)
// ---------------------------------------------------------------------------

/**
 * Produces a frozen skipped marker compatible with the economics privacy layer.
 * @param {string} reason
 * @returns {Readonly<{status:'skipped', reason:string}>}
 */
function makeSkipped(reason) {
  return Object.freeze({ status: 'skipped', reason });
}

// ---------------------------------------------------------------------------
// Packet compiler
// ---------------------------------------------------------------------------

/**
 * Compiles a minimal, frozen work-packet for a single symbol fix task.
 *
 * Locates the symbol's file via `buildDenseIndex(root).bySymbol[symbol]`,
 * computes the line range with `symbolRange`, and returns a structured packet
 * that gives an agent exactly what it needs — no more.
 *
 * @param {{
 *   objective:   string,
 *   symbol:      string,
 *   pkgPath:     string,
 *   root:        string,
 *   acceptance?: string[]
 * }} params
 * @param {{
 *   now?: string | number | null
 * }} [opts={}]
 * @returns {Readonly<object> | Readonly<{status:'skipped', reason:string}>}
 */
export function compilePacket(
  { objective, symbol, pkgPath, root, acceptance },
  opts = {}
) {
  if (!symbol) return makeSkipped('symbol is required');
  if (!root)   return makeSkipped('root is required');

  // Locate symbol's file via the dense index.
  let index;
  try {
    index = buildDenseIndex(resolve(root));
  } catch (err) {
    return makeSkipped(`buildDenseIndex failed: ${err?.message ?? String(err)}`);
  }

  const candidateFiles = index.bySymbol[symbol];
  if (!candidateFiles || candidateFiles.length === 0) {
    return makeSkipped(`symbol "${symbol}" not found in dense index under ${root}`);
  }

  const resolvedFile = candidateFiles[0];
  const confidence   = candidateFiles.length === 1 ? 'derived' : 'inferred';
  const closure      = candidateFiles.length === 1;

  // Read the file and compute the symbol's line range.
  let fileText;
  try {
    fileText = readFileSync(resolve(root, resolvedFile), 'utf-8');
  } catch (err) {
    return makeSkipped(`could not read "${resolvedFile}": ${err?.message ?? String(err)}`);
  }

  const range = symbolRange(fileText, symbol);
  const lines  = range ? [range.start, range.end] : [1, 1];

  const capturedAt = opts?.now ?? null;

  return Object.freeze({
    schemaVersion:      WORK_PACKET_SCHEMA_VERSION,
    objective:          objective || '',
    taskClass:          'bugfix',
    files: Object.freeze([
      Object.freeze({
        path:    resolvedFile,
        symbols: Object.freeze([symbol]),
        lines:   Object.freeze(lines),
      }),
    ]),
    acceptanceCriteria: Object.freeze(acceptance || []),
    verification:       Object.freeze([
      'run the project test suite',
      'confirm the target symbol compiles without error',
    ]),
    outputContract: Object.freeze({ artifactFirst: true }),
    confidence,
    coverage:           'symbol',
    closure,
    capturedAt,
    claim:              null,
    cost:               null,
  });
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

/**
 * Renders a work-packet (or skipped marker) as a terse human-readable string.
 *
 * @param {Readonly<object>} packet
 * @returns {string}
 */
export function presentPacket(packet) {
  if (!packet || typeof packet !== 'object') return 'work-packet: invalid';
  if (packet.status === 'skipped') {
    return `work-packet: skipped (${packet.reason})`;
  }

  const file  = packet.files?.[0];
  const sym   = file?.symbols?.[0] ?? '(unknown)';
  const path  = file?.path ?? '(unknown)';
  const lines = file?.lines ?? [0, 0];

  return [
    `work-packet [${packet.schemaVersion}]`,
    `  objective : ${packet.objective}`,
    `  task-class: ${packet.taskClass}`,
    `  file      : ${path}`,
    `  symbol    : ${sym}`,
    `  lines     : ${lines[0]}–${lines[1]}`,
    `  confidence: ${packet.confidence}  closure: ${packet.closure}`,
    `  claim     : ${packet.claim}  cost: ${packet.cost}`,
    `  capturedAt: ${packet.capturedAt ?? 'null'}`,
  ].join('\n');
}
