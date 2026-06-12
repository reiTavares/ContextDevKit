/**
 * Grade-4 eligibility bar (ADR-0045 §1) — the deterministic gate `/autonomy 4`
 * consults before it will set grade 4. Pure measurement over artifacts the kit
 * already produces; every criterion is a number, never a vibe. Any miss ⇒ refuse
 * naming the failing criterion (constitution §8 — a validator, not a warner), and
 * an UNMEASURABLE criterion is a miss, never a pass (rule 8: refuse-by-default).
 *
 * Sources (all in-repo, no network):
 *   - ADR-0043 transition events (`state-io` listStates → events): the
 *     transition count. (ADR-0058 dropped the rollback-rate criterion — a `qa`
 *     bounce is the QA gate working, not an autonomy failure; counting it
 *     penalised honest QA use.)
 *   - session log files (durable per-session record): the session count.
 *   - a wiring-drift incident log (absent ⇒ 0, since the CI wiring-drift gate
 *     blocks drift from ever landing — ADR-0041 F0).
 *   - a readiness marker written by `autonomy-readiness.mjs`: self-coverage
 *     (NODE_V8_COVERAGE over runtime/hooks + runtime/config) green AND ADR-0044
 *     attribution data present. Absent ⇒ both criteria fail (refuse).
 *
 * THREAT MODEL of the readiness marker (ADR-0045 post-acceptance note, task 138).
 * The marker is TRUST-ON-WRITE: asserted by the harness, not re-proven here. It is
 * acceptable because the real control is elsewhere — `grade-change` is a human-only
 * floor at every grade (an agent can never set grade 4 itself, ADR-0042), the
 * marker's dir `memory/autonomy/**` is a floored path (`floor:autonomy-evidence-
 * self-edit`, so editing it through the resolver needs human approval), the stamp
 * expires after `maxReadinessAgeMs`, and persisting still needs `--persist
 * --confirm`. An HMAC/commit-binding was considered and deferred: it cannot stop a
 * deliberate forge of the current tree, and staleness is already covered by the
 * freshness window. Revisit only if grade-change ever stops being human.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from './paths.mjs';
import { listStates } from '../state/state-io.mjs';
import { SESSION_FILENAME_RE } from '../hooks/session-digest-core.mjs';

/** The fixed bar (ADR-0045 §1, amended by ADR-0058) — changing a threshold requires a new ADR. */
export const ELIGIBILITY = Object.freeze({
  minTransitions: 30,
  minSessions: 20,
  maxReadinessAgeMs: 14 * 24 * 60 * 60 * 1000, // a stale readiness stamp is not evidence
});

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

/** Number of non-empty lines in a JSONL file; 0 when absent (meaningful zero). */
function countLines(file) {
  try {
    return readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/** Count of durable session-log files under the sessions dir. */
function sessionCount(sessionsDir) {
  try {
    return readdirSync(sessionsDir).filter((f) => SESSION_FILENAME_RE.test(f)).length;
  } catch {
    return 0;
  }
}

/**
 * Evaluates the grade-4 eligibility bar.
 *
 * @param {string} root project root
 * @returns {{ eligible: boolean, criteria: Array<{ id: string, label: string, pass: boolean, detail: string }>, failing: string[] }}
 */
export function checkEligibility(root) {
  const paths = pathsFor(root);
  const autonomyDir = resolve(paths.memory, 'autonomy');
  // Count only genuine stage transitions (from ≠ to) — a self-loop is not progress.
  const transitionEvents = listStates(paths.pipeline).flatMap((state) => state.events || []).filter((e) => e && e.from !== e.to);
  const transitions = transitionEvents.length;
  const sessions = sessionCount(paths.sessions);
  const driftIncidents = countLines(resolve(autonomyDir, 'wiring-drift-incidents.jsonl'));
  const readiness = readJson(resolve(autonomyDir, 'readiness.json')) || {};
  // A readiness marker only counts while fresh — a forgotten/stale `true` is not evidence (rule 8).
  const stampMs = Date.parse(readiness.ts);
  const readinessFresh = Number.isFinite(stampMs) && Date.now() - stampMs < ELIGIBILITY.maxReadinessAgeMs;
  const coverageGreen = readiness.coverageGreen === true && readinessFresh;
  const attributionPresent = readiness.attributionPresent === true && readinessFresh;
  const stamp = readinessFresh ? '' : ' (no fresh readiness stamp — run /autonomy-readiness)';

  const criteria = [
    { id: 'transitions', label: `≥ ${ELIGIBILITY.minTransitions} recorded transitions`, pass: transitions >= ELIGIBILITY.minTransitions, detail: `${transitions} evented` },
    { id: 'sessions', label: `≥ ${ELIGIBILITY.minSessions} sessions`, pass: sessions >= ELIGIBILITY.minSessions, detail: `${sessions} session logs` },
    { id: 'wiring-drift', label: 'zero wiring-drift incidents since F0', pass: driftIncidents === 0, detail: `${driftIncidents} incident(s)` },
    { id: 'self-coverage', label: 'self-coverage harness green', pass: coverageGreen, detail: coverageGreen ? 'green' : `absent/red/stale${stamp}` },
    { id: 'attribution', label: 'attribution data (D3) present', pass: attributionPresent, detail: attributionPresent ? 'present' : `absent/stale${stamp}` },
  ];
  const failing = criteria.filter((c) => !c.pass).map((c) => `${c.label} (${c.detail})`);
  return { eligible: failing.length === 0, criteria, failing };
}
