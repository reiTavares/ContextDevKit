/**
 * Benchmark-pilot evidence surface — EACP / WF0018 (#242/#176).
 *
 * Surfaces a recorded A-vs-C PILOT result in the token report, honestly and
 * separately from the dogfood's own autonomy multiplier. A pilot is a measured
 * SIGNAL, never a published claim: this module renders `claim: null` ALWAYS,
 * regardless of the file's contents, and labels n/reps so an under-powered point
 * estimate can never read as a powered causal claim (ADR-0080 / #243 gate).
 *
 * The evidence lives in `contextkit/memory/benchmark-pilot.json` (dogfood-local);
 * absent in a normal install → no line. Read-only, best-effort, never throws.
 * Zero runtime dependencies — node:* only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Canonical schema identifier for benchmark-pilot evidence records. */
export const BENCHMARK_PILOT_SCHEMA_VERSION = 'eacp-benchmark-pilot/1';

/** Repo-relative location of the dogfood pilot-evidence file. */
const PILOT_FILE = ['contextkit', 'memory', 'benchmark-pilot.json'];

/**
 * Reads the pilot-evidence record from a project root. Missing/corrupt → null.
 * @param {string} root - repo root
 * @returns {object|null}
 */
export function readPilotEvidence(root) {
  if (typeof root !== 'string' || root.length === 0) return null;
  try {
    const raw = readFileSync(join(root, ...PILOT_FILE), 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

/** Finite number > 0 → value; else null. */
function pos(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value > 0) ? value : null;
}

/**
 * Renders a one-line pilot-evidence advisory (or '' when no/invalid evidence).
 * `claim` is ALWAYS rendered null — a pilot point estimate is never a claim.
 *
 * @param {string} root - repo root
 * @returns {string}
 */
export function presentPilot(root) {
  const ev = readPilotEvidence(root);
  if (ev === null) return '';
  const mult = pos(ev.multiplier);
  if (mult === null) return '';
  const pct = ((mult - 1) * 100).toFixed(1);
  const n = Number.isFinite(ev.n) ? ev.n : '?';
  const reps = Number.isFinite(ev.reps) ? ev.reps : '?';
  const confidence = typeof ev.confidence === 'string' ? ev.confidence : 'inferred';
  const target = typeof ev.target === 'string' ? ev.target : 'A-vs-C';
  const qa = (ev.qaGreen && typeof ev.qaGreen === 'object')
    ? ` (QA-green A ${ev.qaGreen.a ?? '?'} / C ${ev.qaGreen.c ?? '?'})` : '';
  const ref = typeof ev.reportRef === 'string' ? ` · see ${ev.reportRef}` : '';
  return [
    `Benchmark pilot (${target}, advisory): ${mult.toFixed(4)}\xD7 token efficiency vs kit-free baseline` +
      ` (${pct >= 0 ? '+' : ''}${pct}%) at equal correctness${qa}.`,
    `  n=${n}, reps=${reps} · confidence ${confidence} · claim: null` +
      ` (pilot SIGNAL, not a powered claim — ADR-0080 #243 gate: needs ≥3 reps + CI excluding 1.0)${ref}.`,
  ].join('\n');
}
