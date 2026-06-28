/**
 * Journey verifier (BIZ-0001 / ADR-0127) — the deterministic core that walks the
 * canonical journey map (`policy/journey.json`) and reports the EXACT next step.
 *
 * Split by responsibility (constitution §1): this module is PURE — it takes a
 * loaded journey def, a branch id, and a plain `evidence` object (checkpoint →
 * boolean|null) and returns the journey position. The impure evidence gathering
 * (filesystem / registry reads) lives in `journey-evidence.mjs`; the host
 * surfacing lives in the boot + execution-contract hooks. Pure ⇒ trivially
 * testable, and the "unknown" (null) path makes graceful degradation explicit:
 * a checkpoint we cannot evaluate is `pending`, never silently `satisfied`.
 *
 * Zero runtime dependencies — `node:*` only (immutable rule 1).
 *
 * @module journey-verifier
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Per-stage verdicts. `pending` = some requirement unknown; `blocked` = a hard fail. */
export const STAGE_STATES = Object.freeze(['satisfied', 'pending', 'blocked', 'skipped']);

/**
 * Loads the canonical journey definition. Defensive: a missing/!valid file yields
 * `null` so callers degrade to advisory silence rather than throwing (rule 2).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {object|null} the parsed journey def, or null when unreadable.
 */
export function loadJourney(root = process.cwd()) {
  const candidates = [
    join(root, 'contextkit', 'policy', 'journey.json'),
    join(root, 'templates', 'contextkit', 'policy', 'journey.json'),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Resolves the journey branch id from classifier signals. Mirrors the methodology:
 * operation → direct vs workflow ceremony; business → the decision branch.
 *
 * @param {{ nature?: string, executionMode?: string }} signals - work signals.
 * @returns {string|null} a branch key present in `journey.branches`, or null.
 */
export function selectBranch(signals = {}) {
  const nature = signals.nature;
  const mode = signals.executionMode;
  if (nature === 'business') return 'business-decision';
  if (nature === 'operation') return mode === 'workflow' ? 'operation-workflow' : 'operation-direct';
  return null;
}

/**
 * Evaluates one stage against the evidence map.
 *
 * @param {object} stage - a stage def from the journey.
 * @param {Record<string, boolean|null|undefined>} evidence - checkpoint verdicts.
 * @returns {{ id: string, state: string, unmet: string[], unknown: string[] }}
 */
function evaluateStage(stage, evidence) {
  const requires = Array.isArray(stage.requires) ? stage.requires : [];
  const unmet = [];
  const unknown = [];
  for (const checkpoint of requires) {
    const verdict = evidence[checkpoint];
    if (verdict === false) unmet.push(checkpoint);
    else if (verdict === null || verdict === undefined) unknown.push(checkpoint);
  }
  let state = 'satisfied';
  if (unmet.length) state = 'blocked';
  else if (unknown.length) state = 'pending';
  return { id: stage.id, state, unmet, unknown };
}

/**
 * Walks the selected branch and returns the journey position: per-stage verdicts,
 * the current stage (first not-satisfied), the next command, and any hard blocks.
 *
 * @param {object} journey - the loaded journey def (from {@link loadJourney}).
 * @param {string} branchId - a key of `journey.branches`.
 * @param {Record<string, boolean|null>} evidence - checkpoint → verdict map.
 * @returns {{ branchId, stages, currentStageId, nextCommand, nextGuidance, blocked }|null}
 */
export function verifyJourney(journey, branchId, evidence = {}) {
  if (!journey || !journey.branches || !journey.branches[branchId]) return null;
  const byId = new Map((journey.stages || []).map((stage) => [stage.id, stage]));
  const sequence = journey.branches[branchId];
  const stages = [];
  for (const stageId of sequence) {
    const def = byId.get(stageId);
    if (!def) continue; // defensive — selfcheck guarantees referential integrity
    stages.push({ ...evaluateStage(def, evidence), title: def.title, command: def.command || null, guidance: def.guidance || '' });
  }
  const current = stages.find((stage) => stage.state !== 'satisfied' && stage.state !== 'skipped') || null;
  const blocked = stages.filter((stage) => stage.state === 'blocked');
  return {
    branchId,
    stages,
    currentStageId: current ? current.id : null,
    nextCommand: current ? current.command : null,
    nextGuidance: current ? current.guidance : '',
    blocked,
  };
}
