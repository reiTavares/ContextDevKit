/**
 * Workflow journey gate (ADR-0070). Enforces, in the engine (not in prompts),
 * that a phase's required deliverables exist before `advance` may leave it, so
 * EVERY CLI model (Claude/Codex/Gemini) is held to the same bar and cannot
 * silently skip PRD/SPEC/decisions/tasks/report steps.
 *
 * Pure, dependency-light: takes the resolved pack directory + the parsed
 * workflow object and returns the list of gaps for the CURRENT phase. The caller
 * (`advanceWorkflow`) refuses unless `--force` (constitution section 8: default-refuse).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** A section header with no content beneath it (still the empty scaffold). */
function sectionEmpty(text, heading) {
  return new RegExp(`## ${heading}\\s*(?=\\n##|\\n#|\\s*$)`, 'i').test(text);
}

function read(dir, file) {
  const path = resolve(dir, file);
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

/** True when a markdown table under `dir/file` has at least one data row. */
function tableHasRow(dir, file, firstCellRe) {
  const text = read(dir, file);
  if (!text) return false;
  return text.split(/\r?\n/).some((line) => {
    const cells = line.split('|');
    return cells.length >= 3 && firstCellRe.test(cells[1].trim());
  });
}

/** Newest report file (by name, which is date-stamped), or null. */
function newestReport(dir) {
  const reportsDir = resolve(dir, 'reports');
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir).filter((f) => f.endsWith('.md')).sort();
  return files.length ? read(reportsDir, files[files.length - 1]) : null;
}

/**
 * Returns the list of missing deliverables that block LEAVING `phase`.
 * Empty array means the phase gate is satisfied.
 *
 * @param {string} dir resolved pack directory
 * @param {string} phase current phase
 * @param {{ phases?: Record<string, {ref?: string}> }} workflow parsed workflow
 * @returns {string[]}
 */
export function checkPhaseGaps(dir, phase, workflow = {}) {
  const ref = (name) => Boolean(workflow.phases?.[name]?.ref);
  const missing = [];
  switch (phase) {
    case 'prd': {
      const prd = read(dir, 'prd.md');
      if (!prd) missing.push('prd.md is missing');
      else if (sectionEmpty(prd, 'Problem') || sectionEmpty(prd, 'Goals')) missing.push('prd.md: fill "## Problem" and "## Goals"');
      break;
    }
    case 'spec': {
      const spec = read(dir, 'spec.md');
      if (!spec) missing.push('spec.md is missing');
      else if (sectionEmpty(spec, 'Proposed design') || sectionEmpty(spec, 'Test plan')) missing.push('spec.md: fill "## Proposed design" and "## Test plan"');
      break;
    }
    case 'adr':
      if (!ref('adr') && !tableHasRow(dir, 'decisions.md', /\d/)) missing.push('decisions.md: link at least one ADR (or set an adr ref)');
      break;
    case 'roadmap':
      if (!ref('roadmap')) missing.push('roadmap: set a ref (a P-id, or "not-applicable")');
      break;
    case 'pipeline':
      if (!tableHasRow(dir, 'tasks.md', /\d/)) missing.push('tasks.md: link at least one DevPipeline card');
      break;
    case 'ship':
      if (!newestReport(dir)) missing.push('reports/: write a dated report (workflow.mjs report <id>)');
      break;
    case 'testing': {
      const report = newestReport(dir);
      if (!ref('testing') && !(report && /npm|exit|\[x\]|verif/i.test(report))) missing.push('reports/: record the suite command + exit code in the latest report (or set a testing ref)');
      break;
    }
    default:
      break; // intake / conclusion have no leave-gate
  }
  return missing;
}
