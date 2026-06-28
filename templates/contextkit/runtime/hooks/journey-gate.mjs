#!/usr/bin/env node
/**
 * journey-gate.mjs — PreToolUse(Edit|Write) hook: BIZ-0001 methodology journey
 * enforcement (ADR-0127 Phase 2, SECOND cut). Guarded + graceful fallback,
 * modelled 1:1 on simulate-gate.mjs and the ADR-0125 enforcement contract.
 *
 * It BLOCKS only a positively-FALSE journey checkpoint it can evaluate safely —
 * a deviation that already exists on disk, never a "not-yet-done" stage:
 *   • workflowNestedUnderOwner=false — an OWNED workflow placed loose/central
 *     instead of nested under its BIZ/OP owner (BIZ-0001 rule 3).
 *   • adrNumberContiguous=false — a duplicate / forked ADR series.
 * Each block names the EXACT corrective command from the offending stage.
 *
 * It DEGRADES to silent / advisory (exit 0, never block) whenever it cannot
 * enforce: no active entity, evidence unknown (`pending`), fresh install,
 * `enforcement.mode` not `guarded`/`strict`, an exempt path, a covering bypass,
 * or ANY error (fail-open — immutable rule 2; a broken hook never blocks work).
 *
 * Why this narrow block-set (the over-block guard): `governingAdrAccepted` and
 * `ownerContextExists` are excluded on purpose — they read `false` simply
 * because the journey has not REACHED that stage yet (the ADR is still being
 * written, the context not yet created). Blocking on those would false-block
 * legitimate early work. They are surfaced as advice by `journey-surface` and,
 * for material work, enforced by the existing ADR-0125 materiality gate
 * (`execution-gate`) — this gate does not duplicate that. The two checkpoints
 * here are false ONLY when a wrong artifact already exists, so they cannot be a
 * false positive from being early.
 *
 * Bypass: record a deliberate skip via `markSimulation` with
 * `objective: 'BYPASS: <reason>'` (or any covering `/simulate-impact`) — the
 * same auditable escape hatch the L5 simulate-gate honours.
 *
 * Zero runtime dependencies — `node:*` + kit primitives only (immutable rule 1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLevel } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';
import { hasSimulationFor, readLedger, toRepoRelative } from './ledger.mjs';
import { emitAdvisory, emitBlockDecision, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { loadJourney, selectBranch, verifyJourney } from '../work/journey-verifier.mjs';
import { gatherRegistryEvidence } from '../work/journey-evidence-registry.mjs';
import { evidenceFromSignals } from './journey-surface.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/**
 * Checkpoints this gate may BLOCK on — see the module header for why the set is
 * deliberately narrow (positively-false-only, never "not-yet-done").
 */
const BLOCKABLE = new Set(['workflowNestedUnderOwner', 'adrNumberContiguous']);

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** Exempt paths — docs/memory/pipeline/config files never carry source deviations. */
function isExemptPath(targetPath, root = ROOT) {
  const paths = pathsFor(root);
  const resolved = resolve(root, targetPath);
  if (resolved.startsWith(paths.memory) || resolved.startsWith(paths.pipeline)) return true;
  if (resolved === resolve(paths.changelog)) return true;
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'INSTRUCTIONS.md', 'instrucoes.md', '.gitignore', '.gitattributes', 'package.json']) {
    if (resolved === resolve(root, name)) return true;
  }
  return targetPath.endsWith('.md');
}

/**
 * Resolves the work-context id the journey applies to, from the saved contract's
 * work classification. Mirrors `journey-surface.resolveEntityId`. Null when none.
 */
function resolveEntityId(work) {
  if (!work || typeof work !== 'object') return null;
  if (typeof work.id === 'string' && /^(BIZ|OP)-\d{4}$/.test(work.id)) return work.id;
  const match = work.businessMatch;
  if (match && typeof match.suggested === 'string' && /^(BIZ|OP)-\d{4}$/.test(match.suggested)) return match.suggested;
  return null;
}

/**
 * Positive-deviation evidence the first-cut registry gatherer deliberately does
 * not assert: an OWNED workflow that exists but is placed loose/central (its
 * recorded `origin` is the entity, yet its path-derived `owner` is not). Reads
 * the generated workflow registry (single file, fail-open). Absence → {} (the
 * verifier keeps the checkpoint `pending`, never a false block).
 *
 * @param {string} root - project root.
 * @param {string} entityId - the BIZ/OP owner id.
 * @returns {{ workflowExists?: true, workflowNestedUnderOwner?: false }}
 */
function detectMisplacedWorkflow(root, entityId) {
  try {
    if (!entityId) return {};
    const registryPath = pathsFor(root).workflowRegistry;
    if (!existsSync(registryPath)) return {};
    const registry = JSON.parse(readFileSync(registryPath, 'utf8').replace(/^﻿/, ''));
    const rows = Array.isArray(registry?.workflows) ? registry.workflows : [];
    const misplaced = rows.some((row) => row && row.origin === entityId && row.owner !== entityId);
    // The workflow positively exists (just placed centrally) → both verdicts honest.
    return misplaced ? { workflowExists: true, workflowNestedUnderOwner: false } : {};
  } catch {
    return {}; // fail-open — placement evidence is best-effort
  }
}

/** Renders the host-resolved corrective command from a stage command descriptor. */
function commandText(command) {
  if (!command || typeof command !== 'object') return null;
  if (command.work) return `node contextkit/tools/scripts/work.mjs ${command.work}${command.args ? ` ${command.args}` : ''}`;
  if (command.slash) return `/${command.slash}${command.args ? ` ${command.args}` : ''}`;
  if (command.tool) return `node contextkit/tools/scripts/${command.tool}${command.args ? ` ${command.args}` : ''}`;
  if (command.shell) return command.shell;
  return null;
}

/** One human line per blocked checkpoint, naming the exact corrective command. */
function checkpointLine(stage, checkpoint) {
  const cmd = commandText(stage.command);
  const fix = checkpoint === 'workflowNestedUnderOwner'
    ? `move the workflow under its owner's workflows/ dir (BIZ-0001 rule 3)${cmd ? `, e.g. \`${cmd}\`` : ''}`
    : checkpoint === 'adrNumberContiguous'
      ? `renumber via the fleet-aware allocator (never a hand-picked number; ADR-0119)${cmd ? `, e.g. \`${cmd}\`` : ''}`
      : cmd ? `run \`${cmd}\`` : 'follow the journey stage';
  return `  • ${checkpoint} (stage "${stage.title || stage.id}") → ${fix}`;
}

/** Builds the block / advisory body for the offending checkpoints. */
function buildReason(targetPath, branch, offenders, mode) {
  const verb = mode === 'guarded' || mode === 'strict' ? '🛑 Journey gate — methodology deviation BLOCKED.' : '⚠ Journey gate — methodology deviation (advisory).';
  return [
    verb,
    '',
    'You are about to modify:',
    `  • ${targetPath}`,
    '',
    `This deviates from the canonical journey (branch "${branch}", ADR-0127). A`,
    'checkpoint is positively FALSE — a wrong artifact already exists on disk:',
    ...offenders.map(({ stage, checkpoint }) => checkpointLine(stage, checkpoint)),
    '',
    'Correct the deviation above, or — if this edit is genuinely unrelated —',
    'record a bypass via markSimulation (objective "BYPASS: <reason>") then retry.',
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
  if (!targetPath || isExemptPath(targetPath, ROOT)) return;

  const journey = loadJourney(ROOT);
  if (!journey) return; // fresh install / unreadable map → degrade silently.
  const mode = journey.enforcement?.mode;

  // Resolve the active entity from the saved execution contract (ADR-0125).
  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const ledger = await readLedger(sessionId);
  const input = payload?.tool_input ?? {};
  const taskId = (typeof input.taskId === 'string' && input.taskId) || (typeof input.task_id === 'string' && input.task_id) || ledger.activeTask;
  if (!taskId) return; // no active entity → degrade.

  const contract = loadContract(ROOT, taskId);
  const work = contract?.signals?.work;
  const branch = selectBranch(work || {});
  if (!branch) return; // no resolvable branch → degrade.

  const entityId = resolveEntityId(work);
  const evidence = {
    ...evidenceFromSignals({ work, tier: contract?.signals?.tier }),
    ...gatherRegistryEvidence(ROOT, entityId),
    ...detectMisplacedWorkflow(ROOT, entityId),
  };

  const result = verifyJourney(journey, branch, evidence);
  if (!result || !result.blocked.length) return; // nothing positively false → silent.

  // Keep only checkpoints this gate is allowed to enforce (the over-block guard).
  const offenders = [];
  for (const stage of result.blocked) {
    for (const checkpoint of stage.unmet) {
      if (BLOCKABLE.has(checkpoint)) offenders.push({ stage, checkpoint });
    }
  }
  if (!offenders.length) return; // only "not-yet-done" stages → not our concern; silent.

  // Auditable escape hatch — a covering /simulate-impact or BYPASS: record stands the gate down.
  if (hasSimulationFor(ledger, targetPath)) return;

  const reason = buildReason(targetPath, branch, offenders, mode);
  if (mode === 'guarded' || mode === 'strict') {
    emitBlockDecision(reason, HOST);
  } else {
    emitAdvisory(reason + '\n', HOST, 'PreToolUse'); // advisory mode → warn, never block.
  }
}

main().catch((err) => {
  process.stderr.write(`[journey-gate] ${err?.message ?? err}\n`);
  process.exit(0);
});
