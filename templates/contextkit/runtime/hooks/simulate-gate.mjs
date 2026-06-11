#!/usr/bin/env node
/**
 * PreToolUse hook (Level 5) — high-risk path gate.
 *
 * Wired with matcher `Edit|Write|MultiEdit`. When the file being edited
 * matches the `l5.highRiskPaths` allowlist from `contextkit/config.json` AND the
 * current session's ledger has no covering `/simulate-impact` record, it emits
 * a `decision: "block"` with instructions.
 *
 * Defensive: any error path exits 0 silently. A broken hook MUST NEVER block
 * real work.
 *
 * Bypass: record a deliberate skip by calling `markSimulation` with
 * `objective: 'BYPASS: <reason>'` and `coveredPaths: [highRiskPath]` — an
 * auditable escape hatch for trivial edits.
 */
import { getLevel, loadConfig } from '../config/load.mjs';
import { hasSimulationFor, readLedger, toRepoRelative } from './ledger.mjs';
import { emitBlockDecision, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { matchHighRisk } from './path-classification.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

function buildBlockReason(targetPath, matchedEntry) {
  return [
    '🛑 L5 gate — high-risk path detected.',
    '',
    'You are about to modify:',
    `  • ${targetPath}`,
    '',
    `That path matches the configured high-risk entry \`${matchedEntry}\` and the`,
    'current session has no `/simulate-impact` record covering it.',
    '',
    'Required next step — pick ONE:',
    '  1. Run `/simulate-impact "<one-sentence objective>"` first. It produces a',
    '     Blast Radius Report and marks the ledger, unblocking edits inside the',
    '     covered paths.',
    '  2. If this edit is genuinely trivial (typo / comment), record an explicit',
    '     bypass via markSimulation (objective "BYPASS: <reason>") then retry.',
    '',
    'Why the gate exists: high-risk paths (schema, shared contracts, auth surface,',
    'core services) have outsized blast radius. The gate converts "architecture',
    'before syntax" from a suggestion into executable governance.',
  ].join('\n');
}

async function main() {
  if (getLevel(ROOT) < 5) return; // Inert below Level 5.

  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const filePath = normalizeToolPayload(payload).filePaths[0];
  if (!filePath) return;
  const targetPath = toRepoRelative(filePath);
  if (!targetPath) return;

  const config = await loadConfig(ROOT);
  const matched = matchHighRisk(targetPath, config?.l5?.highRiskPaths ?? []);
  if (!matched) return;

  const ledger = await readLedger(resolveHookSessionId(payload, HOST));
  if (hasSimulationFor(ledger, targetPath)) return;

  // The gate is autonomy-grade-blind by design (ADR-0041/0042): no consent
  // setting may weaken L5 enforcement — only a covering /simulate-impact does.
  // Host-correct decision key: Claude Code "block", agy "deny" (ADR-0049).
  emitBlockDecision(buildBlockReason(targetPath, matched), HOST);
}

main().catch((err) => {
  process.stderr.write(`[simulate-gate] ${err?.message ?? err}\n`);
  process.exit(0);
});
