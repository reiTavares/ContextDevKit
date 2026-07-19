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
import { pathsFor } from '../config/paths.mjs';
import { listWorkflows, PHASES, currentBranch } from '../../tools/scripts/workflow-pack.mjs';
import { resolve } from 'node:path';

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

/**
 * Graph blast-radius for a target path, read DIRECTLY from the committed
 * projection via fs (never imports a graph module -> this hot-path hook stays
 * dependency-pure, ADR-0134). Returns a one-line summary, or null when the graph
 * is absent/unreadable (degrade-safe; never fabricates). Makes the L5 block
 * message name the real consumers that break (the SHARPENS verb).
 */
function graphBlastRadiusLine(root, targetPath) {
  try {
    const gp = resolve(pathsFor(root).projectMap, 'graph', 'graph.json');
    const raw = readFileSync(gp, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const g = JSON.parse(text);
    if (!Array.isArray(g.edges)) return null;
    const filePrefix = 'file:' + targetPath;
    const symPrefix = 'sym:' + targetPath + '#';
    const inbound = new Set();
    for (const e of g.edges) {
      if (e.relation !== 'calls' && e.relation !== 'imports' && e.relation !== 'references') continue;
      if (e.target === filePrefix || (typeof e.target === 'string' && e.target.indexOf(symPrefix) === 0)) inbound.add(e.source);
    }
    if (inbound.size === 0) return null;
    const sample = [...inbound].sort().slice(0, 4).join(', ');
    return 'Graph blast radius: ' + inbound.size + ' consumer(s) depend on this \u2014 e.g. ' + sample + (inbound.size > 4 ? ', \u2026' : '') + '.';
  } catch {
    return null;
  }
}

function buildBlockReason(targetPath, matchedEntry, graphLine) {
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
    ...(graphLine ? ['', graphLine] : []),
    '',
    'Why the gate exists: high-risk paths (schema, shared contracts, auth surface,',
    'core services) have outsized blast radius. The gate converts "architecture',
    'before syntax" from a suggestion into executable governance.',
  ].join('\n');
}

function isExemptPath(targetPath, root = ROOT) {
  const paths = pathsFor(root);
  const resolved = resolve(root, targetPath);
  if (resolved.startsWith(paths.memory) || resolved.startsWith(paths.pipeline)) return true;
  if (resolved === resolve(paths.changelog)) return true;
  if (resolved === resolve(root, 'AGENTS.md')) return true;
  if (resolved === resolve(root, 'CLAUDE.md')) return true;
  if (resolved === resolve(root, 'INSTRUCTIONS.md')) return true;
  if (resolved === resolve(root, 'instrucoes.md')) return true;
  if (resolved === resolve(root, '.gitignore')) return true;
  if (resolved === resolve(root, '.gitattributes')) return true;
  if (resolved === resolve(root, 'package.json')) return true;
  if (targetPath.endsWith('.md')) return true;
  return false;
}

function getActiveWorkflowBeforeShip(root = ROOT) {
  try {
    const branch = currentBranch(root);
    const list = listWorkflows(root);
    // ADR-0071: only a pre-ship workflow created ON THE CURRENT BRANCH blocks edits.
    // A workflow with no recorded branch (legacy) never branch-scopes, favouring
    // "never block unrelated flow" over over-blocking parallel sessions/worktrees.
    const active = list.find((w) => w.currentPhase && w.currentPhase !== 'done' && w.branch && branch && w.branch === branch);
    if (!active) return null;
    const index = PHASES.indexOf(active.currentPhase);
    const shipIndex = PHASES.indexOf('ship');
    if (index >= 0 && index < shipIndex) return active;
  } catch {
    /* defensive */
  }
  return null;
}

function buildWorkflowBlockReason(targetPath, workflow) {
  return [
    '🛑 L5 gate — Phase-Aware Mutation Guard.',
    '',
    'You are about to modify:',
    `  • ${targetPath}`,
    '',
    `This edit is BLOCKED because there is an active workflow: "${workflow.slug}"`,
    `which is currently in the "${workflow.currentPhase}" phase.`,
    '',
    'You cannot modify source code files until the workflow advances to the "ship" phase.',
    '',
    'Required next step — pick ONE:',
    '  1. Complete the current workflow tasks and advance the workflow:',
    `     node contextkit/tools/scripts/workflow.mjs advance ${workflow.slug}`,
    '  2. If this edit is for a completely unrelated task, ensure no active workflow',
    '     is block-restricting the repository, or cooperate with the user to finish/pause it.',
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

  if (!isExemptPath(targetPath, ROOT)) {
    const activeWf = getActiveWorkflowBeforeShip(ROOT);
    if (activeWf) {
      emitBlockDecision(buildWorkflowBlockReason(targetPath, activeWf), HOST);
      return;
    }
  }

  const config = await loadConfig(ROOT);
  const matched = matchHighRisk(targetPath, config?.l5?.highRiskPaths ?? []);
  if (!matched) return;

  const ledger = await readLedger(resolveHookSessionId(payload, HOST));
  if (hasSimulationFor(ledger, targetPath)) return;

  // The gate is autonomy-grade-blind by design (ADR-0041/0042): no consent
  // setting may weaken L5 enforcement — only a covering /simulate-impact does.
  // Host-correct decision key: Claude Code "block", agy "deny" (ADR-0049).
  const graphLine = graphBlastRadiusLine(ROOT, targetPath);
  emitBlockDecision(buildBlockReason(targetPath, matched, graphLine), HOST);
}

main().catch((err) => {
  process.stderr.write(`[simulate-gate] ${err?.message ?? err}\n`);
  process.exit(0);
});
