#!/usr/bin/env node
/**
 * indirect-write-reconcile.mjs — PostToolUse hook: detect and reconcile files
 * changed outside the Edit/Write tools (CDK-034, ADR-0072).
 *
 * Advisory + dormant: this hook is UNREGISTERED by default and NEVER blocks.
 * It detects files written by Bash/MCP/formatters/codegen that bypass the
 * explicit Edit/Write tools, compares them against the active contract's declared
 * paths, and writes an advisory stderr note when out-of-contract files appear.
 *
 * Fail-open: any unhandled error exits 0 silently (immutable rule 2 — a broken
 * hook MUST NEVER interrupt real work).
 *
 * Inert below Level 3: exits 0 immediately.
 *
 * Operation modes:
 *   - Edit / Write / MultiEdit payload  → record file paths into ledger.directEdits
 *     (baseline for later indirect detection). Exit 0.
 *   - Any other tool (Bash / MCP / etc.) → run `git status --porcelain`, derive
 *     indirect writes, compare against contract.paths, emit advisory if needed.
 */
import { getLevel } from '../config/load.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { readLedger, writeLedger, toRepoRelative, resolveSessionId } from './ledger.mjs';
import { hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const HOST = hookHost();

// ---------------------------------------------------------------------------
// Pure core — zero I/O, exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Classifies the origin of an indirect write based on tool name and (for Bash)
 * the command string.
 *
 * Mapping:
 *   Edit | Write | MultiEdit              → 'direct-edit'   (should never reach indirect detection)
 *   Bash with prettier/eslint/black/fmt   → 'allowed-formatter'
 *   Bash with codegen/generate/scaffold   → 'allowed-generator'
 *   any other Bash                        → 'shell'
 *   MCP tool (name contains '__' or 'mcp')→ 'mcp'
 *   everything else                       → 'external'
 *
 * @param {string|null} toolName  tool_name from the PostToolUse payload
 * @param {string}      command   Bash command string (empty for non-Bash tools)
 * @returns {'direct-edit'|'allowed-formatter'|'allowed-generator'|'shell'|'mcp'|'external'}
 */
export function classifyOrigin(toolName, command) {
  if (!toolName) return 'external';
  const name = String(toolName);

  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') return 'direct-edit';

  if (name === 'Bash') {
    const cmd = typeof command === 'string' ? command : '';
    if (/\b(prettier|eslint|black|gofmt|rustfmt|clang-format|biome|dprint)\b/.test(cmd)) {
      return 'allowed-formatter';
    }
    if (/\b(codegen|generate|scaffold|plop|hygen|yo\s)\b/.test(cmd)) {
      return 'allowed-generator';
    }
    return 'shell';
  }

  // MCP tools: Claude Code names them with double-underscore namespace separator
  // (e.g. mcp__drive__read_file) or the tool name itself starts with 'mcp'.
  if (/__/.test(name) || /^mcp/i.test(name)) return 'mcp';

  return 'external';
}

/**
 * Pure core: computes indirect writes and which of those fall outside the contract.
 *
 * @param {{
 *   changedFiles:   string[],  repo-relative paths reported by git status
 *   directEdits:   string[],  repo-relative paths the agent wrote via Edit/Write
 *   contractPaths: string[],  repo-relative paths declared in the contract signals
 * }} params
 * @returns {{
 *   indirect:       string[],  changedFiles not in directEdits
 *   outOfContract:  string[],  indirect files not covered by contractPaths
 *   origin:         string     (populated by the caller, not computed here)
 * }}
 */
export function reconcileIndirectWrites({ changedFiles, directEdits, contractPaths }) {
  const directSet = new Set(Array.isArray(directEdits) ? directEdits : []);
  const contractSet = new Set(Array.isArray(contractPaths) ? contractPaths : []);
  const files = Array.isArray(changedFiles) ? changedFiles : [];

  const indirect = files.filter((f) => !directSet.has(f));

  // When contractPaths is empty/unknown we cannot judge scope — skip outOfContract.
  const outOfContract =
    contractSet.size === 0
      ? []
      : indirect.filter((f) => !contractSet.has(f));

  return { indirect, outOfContract, origin: '' };
}

// ---------------------------------------------------------------------------
// Git helper — best-effort, returns [] on any failure
// ---------------------------------------------------------------------------

/**
 * Runs `git status --porcelain` in the project root and returns a list of
 * repo-relative changed file paths (forward-slashed).
 *
 * @param {string} root absolute project root
 * @returns {string[]}
 */
function gitChangedFiles(root) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

// ---------------------------------------------------------------------------
// Direct-edit tools whose outputs we track as the baseline
// ---------------------------------------------------------------------------

const DIRECT_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Inert below Level 3.
  if (getLevel(ROOT) < 3) return;

  const raw = await readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed stdin → silent, fail-open
  }

  const { toolName, filePaths } = normalizeToolPayload(payload);
  if (!toolName) return;

  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const ledger = await readLedger(sessionId);

  // Ensure directEdits array exists in ledger.
  if (!Array.isArray(ledger.directEdits)) ledger.directEdits = [];

  // --- Edit / Write / MultiEdit: record path into directEdits baseline ---
  if (DIRECT_EDIT_TOOLS.has(toolName)) {
    const relative = filePaths.map((p) => toRepoRelative(p)).filter(Boolean);
    if (relative.length > 0) {
      const existingSet = new Set(ledger.directEdits);
      for (const p of relative) existingSet.add(p);
      ledger.directEdits = [...existingSet];
      await writeLedger(sessionId, ledger);
    }
    return; // baseline recorded; nothing more to do here
  }

  // --- Other tools (Bash / MCP / etc.): detect indirect writes ---
  const changedFiles = gitChangedFiles(ROOT);
  if (changedFiles.length === 0) return; // nothing changed → silent

  // Load contract for scope comparison (best-effort; null → empty contractPaths).
  const activeTaskId = ledger.activeTask ?? null;
  const contract = activeTaskId ? loadContract(ROOT, activeTaskId) : null;
  const contractPaths = Array.isArray(contract?.signals?.paths) ? contract.signals.paths : [];

  const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
  const origin = classifyOrigin(toolName, command);

  const { indirect, outOfContract } = reconcileIndirectWrites({
    changedFiles,
    directEdits: ledger.directEdits,
    contractPaths,
  });

  // Persist indirect set + origin into ledger for auditability.
  if (!Array.isArray(ledger.indirectWrites)) ledger.indirectWrites = [];
  if (indirect.length > 0) {
    ledger.indirectWrites.push({ files: indirect, origin, at: Date.now() });
    await writeLedger(sessionId, ledger);
  }

  // Advisory: warn to stderr when out-of-contract files detected (never block).
  if (outOfContract.length > 0) {
    process.stderr.write(
      `[indirect-write-reconcile] Advisory: ${outOfContract.length} file(s) changed by ` +
        `${toolName} (origin: ${origin}) outside the declared contract scope:\n` +
        outOfContract.map((f) => `  - ${f}`).join('\n') + '\n' +
        'Consider adding these paths to the task contract or using Edit/Write directly.\n'
    );
  }
}

main().catch(() => process.exit(0));
