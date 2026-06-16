#!/usr/bin/env node
/**
 * resume-pack.mjs — Checkpoint reader and renderer for WF0020 Economy Runtime
 * (ECON-07, card #260).
 *
 * WHY: A session interrupted at any stage of `/ship` loses its working context.
 * The `checkpoint` verb on ship-state.mjs stamps a `resume` object into the
 * pipeline-run state. This module reads that stamp and renders a bounded
 * ≤120-line markdown brief so the resuming session reconstructs intent in
 * one read — pointers only, never inlined payloads.
 *
 * Advisory + fail-open: every function gracefully handles missing/corrupt data.
 * UNREGISTERED (Phase 1) — no hook or boot wiring.
 *
 * @module resume-pack
 */
import { readState } from '../../../runtime/state/state-io.mjs';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeState } from '../../../runtime/state/state-io.mjs';
import { checkpoint } from '../ship-state.mjs';

// ─── Reader ────────────────────────────────────────────────────────────────────

/**
 * Builds a resume pack from the `resume` field of a pipeline-run state.
 * Derives `currentStep` from `state.step.current` when not set on the
 * checkpoint (so the pack always reflects the latest known stage).
 *
 * @param {string} pipeDir  path to the pipeline directory
 * @param {string} id       run id (e.g. "ship-my-objective")
 * @returns {{ ok: true, id: string, objective: string, currentStep: string,
 *             decisions: string[], touchSet: object[], openThreads: string[],
 *             pointers: object, stampedAt: number, step: object|null } |
 *           { ok: false, reason: string }}
 */
export function buildResumePack(pipeDir, id) {
  if (!pipeDir || !id) return { ok: false, reason: 'no-checkpoint' };

  let state;
  try {
    state = readState(pipeDir, id);
  } catch {
    return { ok: false, reason: 'read-error' };
  }

  if (!state) return { ok: false, reason: 'no-checkpoint' };
  if (!state.resume || typeof state.resume !== 'object') {
    return { ok: false, reason: 'no-checkpoint' };
  }

  const r = state.resume;
  // Prefer the live step from state.step over the snapshot in resume.currentStep,
  // so a pack built after additional `step` calls reflects the true position.
  const currentStep =
    (state.step && typeof state.step.current === 'string' && state.step.current)
      ? state.step.current
      : (typeof r.currentStep === 'string' ? r.currentStep : '');

  return {
    ok: true,
    id: state.id,
    objective: typeof r.objective === 'string' ? r.objective : '',
    currentStep,
    decisions: Array.isArray(r.decisions) ? r.decisions : [],
    touchSet: Array.isArray(r.touchSet) ? r.touchSet : [],
    openThreads: Array.isArray(r.openThreads) ? r.openThreads : [],
    pointers: (r.pointers && typeof r.pointers === 'object') ? r.pointers : {},
    stampedAt: typeof r.stampedAt === 'number' ? r.stampedAt : 0,
    step: state.step ?? null,
  };
}

// ─── Renderer ──────────────────────────────────────────────────────────────────

/** Maximum rendered lines — enforced by truncating low-priority lists. */
const MAX_RENDER_LINES = 120;

/**
 * Renders a resume pack as a bounded ≤120-line markdown brief.
 * Sections in priority order (highest survives truncation):
 *   1. Objective + current step  (always present)
 *   2. Decisions (non-derivable why)
 *   3. Pointers (paths to ADR/spec/session — never their bodies)
 *   4. Touch-set (file + one-line why)
 *   5. Open threads (next 1-3 actions)
 *
 * @param {{ ok: boolean, [key: string]: any }} pack  result of buildResumePack
 * @returns {string}  markdown text, ≤120 lines
 */
export function renderResumePack(pack) {
  if (!pack.ok) {
    return `# Resume Pack — No Checkpoint\n\nReason: \`${pack.reason ?? 'unknown'}\`\n`;
  }

  const lines = [];
  const stamp = pack.stampedAt ? new Date(pack.stampedAt).toISOString() : 'unknown';

  lines.push(`# Resume Pack — ${pack.id}`);
  lines.push('');
  lines.push(`**Objective:** ${pack.objective || '(not set)'}`);
  lines.push(`**Current Step:** \`${pack.currentStep || '(unknown)'}\``);
  lines.push(`**Checkpoint:** ${stamp}`);
  lines.push('');

  // Section: Decisions (highest priority non-header content)
  if (pack.decisions.length > 0) {
    lines.push('## Decisions So Far');
    for (const d of pack.decisions) lines.push(`- ${d}`);
    lines.push('');
  }

  // Section: Pointers — paths only, never file bodies
  const pointerEntries = Object.entries(pack.pointers);
  if (pointerEntries.length > 0) {
    lines.push('## Pointers');
    for (const [key, value] of pointerEntries) lines.push(`- **${key}:** \`${value}\``);
    lines.push('');
  }

  // Section: Touch-set (lower priority — truncatable)
  if (pack.touchSet.length > 0) {
    lines.push('## Touch Set');
    for (const entry of pack.touchSet) {
      const p = typeof entry.path === 'string' ? entry.path : String(entry.path ?? '');
      const w = typeof entry.why === 'string' ? entry.why : '';
      lines.push(`- \`${p}\` — ${w}`);
    }
    lines.push('');
  }

  // Section: Open Threads (lowest priority — first to be dropped)
  if (pack.openThreads.length > 0) {
    lines.push('## Open Threads');
    for (const t of pack.openThreads.slice(0, 3)) lines.push(`- ${t}`);
    lines.push('');
  }

  // Hard-cap at MAX_RENDER_LINES by dropping trailing lines.
  // The truncation boundary always lands at a section break in practice.
  return lines.slice(0, MAX_RENDER_LINES).join('\n');
}

// ─── CI Check Export ────────────────────────────────────────────────────────────

/**
 * CI check for ECON-07: round-trip checkpoint→buildResumePack, render bounds,
 * graceful-missing, and pointer-paths-not-payloads assertions.
 *
 * @param {string} root  project root (for pathsFor; not used for pipeDir in tests)
 * @returns {Array<{ name: string, pass: boolean, detail: string }>}
 */
export function econCheckResumePack(root) {
  const results = [];

  // Create a fresh temp pipe dir for isolation.
  const pipeDir = resolve(tmpdir(), `econ07-ci-${Date.now()}`);
  mkdirSync(pipeDir, { recursive: true });

  const runId = 'ship-econ07-ci';
  const sampleResume = {
    objective: 'CI round-trip test',
    currentStep: 'implement',
    decisions: ['chose node:fs over memfs for portability'],
    touchSet: [{ path: 'templates/contextkit/tools/scripts/economy/resume-pack.mjs', why: 'new module' }],
    openThreads: ['run selfcheck', 'update CHANGELOG'],
    pointers: {
      adr: 'contextkit/memory/decisions/0086-economy-runtime-resume-pack.md',
      spec: 'contextkit/memory/workflows/0020-economy-runtime-lean-loop/spec.md',
    },
  };

  // --- Test 1: round-trip ---
  let roundTripPass = false;
  let roundTripDetail = '';
  try {
    writeState(pipeDir, runId, {
      kind: 'pipeline-run',
      status: 'running',
      step: { current: 'implement', index: 4, total: 9 },
    });
    checkpoint(pipeDir, runId, sampleResume);
    const pack = buildResumePack(pipeDir, runId);
    if (
      pack.ok &&
      pack.objective === sampleResume.objective &&
      pack.currentStep === 'implement' &&
      pack.decisions[0] === sampleResume.decisions[0] &&
      pack.touchSet[0].path === sampleResume.touchSet[0].path &&
      pack.pointers.adr === sampleResume.pointers.adr
    ) {
      roundTripPass = true;
      roundTripDetail = 'all fields round-tripped correctly';
    } else {
      roundTripDetail = `pack=${JSON.stringify(pack).slice(0, 200)}`;
    }
  } catch (err) {
    roundTripDetail = `threw: ${err.message}`;
  }
  results.push({ name: 'econ07:round-trip', pass: roundTripPass, detail: roundTripDetail });

  // --- Test 2: renderResumePack ≤120 lines ---
  let renderPass = false;
  let renderDetail = '';
  try {
    const pack = buildResumePack(pipeDir, runId);
    const rendered = renderResumePack(pack);
    const lineCount = rendered.split('\n').length;
    renderPass = lineCount <= MAX_RENDER_LINES;
    renderDetail = `${lineCount} lines (limit ${MAX_RENDER_LINES})`;
  } catch (err) {
    renderDetail = `threw: ${err.message}`;
  }
  results.push({ name: 'econ07:render-line-cap', pass: renderPass, detail: renderDetail });

  // --- Test 3: graceful-missing (no run) ---
  let missingPass = false;
  let missingDetail = '';
  try {
    const pack = buildResumePack(pipeDir, 'ship-does-not-exist');
    missingPass = pack.ok === false && typeof pack.reason === 'string';
    missingDetail = `ok=${pack.ok} reason=${pack.reason}`;
  } catch (err) {
    missingDetail = `threw (should not): ${err.message}`;
  }
  results.push({ name: 'econ07:graceful-missing', pass: missingPass, detail: missingDetail });

  // --- Test 4: pointers are paths not payloads ---
  let pointersPass = false;
  let pointersDetail = '';
  try {
    const pack = buildResumePack(pipeDir, runId);
    const rendered = renderResumePack(pack);
    // The rendered brief must contain the pointer path strings.
    const hasAdrPath = rendered.includes(sampleResume.pointers.adr);
    const hasSpecPath = rendered.includes(sampleResume.pointers.spec);
    // Must NOT contain any file-body signal (e.g. "## Architecture" or import lines
    // that would only appear if a file's body was inlined rather than its path).
    const noInlinedBody = !rendered.includes('import {') && !rendered.includes('export function');
    pointersPass = hasAdrPath && hasSpecPath && noInlinedBody;
    pointersDetail = `adrPath=${hasAdrPath} specPath=${hasSpecPath} noBody=${noInlinedBody}`;
  } catch (err) {
    pointersDetail = `threw: ${err.message}`;
  }
  results.push({ name: 'econ07:pointers-paths-not-payloads', pass: pointersPass, detail: pointersDetail });

  return results;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const runId = process.argv[2];
  if (!runId) {
    process.stderr.write('Usage: resume-pack.mjs <runId>\n');
    process.exit(1);
  }
  const pipeDir = pathsFor(process.cwd()).pipeline;
  const pack = buildResumePack(pipeDir, runId);
  console.log(renderResumePack(pack));
}

if (process.argv[1]?.endsWith('resume-pack.mjs')) main();
