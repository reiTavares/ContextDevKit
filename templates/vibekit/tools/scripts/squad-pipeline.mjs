#!/usr/bin/env node
/**
 * squad-pipeline — engine for the declarative squad pipeline DSL
 * ([ADR-0015](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) Part A).
 *
 * Reads `<vibekit>/squads/<squad>/pipeline.yaml`, validates it against the
 * whitelisted grammar (see `docs/SQUAD-PIPELINE-FORMAT.md`), and — with
 * `--dry-run` — walks the graph printing the would-be execution order.
 *
 * Refusal modes (see the spec for the full table):
 *   • `yaml` not installed                   → exit 0 (informative; opt-in feature)
 *   • pipeline.yaml malformed                → exit 1
 *   • vendor model name instead of tier      → exit 1
 *   • condition grammar violation            → exit 1
 *   • on_reject target missing               → exit 1
 *   • on_reject without max_review_cycles    → exit 1
 *   • agent has no briefing                  → exit 1
 *
 * Usage:
 *   node <path>/squad-pipeline.mjs <squad> [--dry-run]
 *
 * Cohesion note: kept as one file (~250 lines) because validation, dry-run
 * printing, and the path-discovery glue all consume the same parsed
 * pipeline + the same context object. Splitting along those seams would
 * scatter one pipeline lifecycle across three files with shared state in
 * each — the constitution rewards keeping a single coherent unit together.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml } from '../../squads/agent-forge/lib/yaml.mjs';
import { parseCondition, evalCondition } from './squad-pipeline-condition.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const VIBEKIT_ROOT = resolve(SCRIPT_DIR, '..', '..');           // .../[templates/]vibekit
const REPO_ROOT = resolve(VIBEKIT_ROOT, '..');                   // .../[repo or project]

const VALID_TIERS = new Set(['fast', 'powerful', 'reasoning']);
const VALID_EXECUTIONS = new Set(['inline', 'subagent']);
const REQUIRED_AGENT_FIELDS = ['id', 'agent', 'execution', 'model_tier'];
const REQUIRED_CHECKPOINT_FIELDS = ['id', 'type', 'outputFile'];

/**
 * Discovers the squad's `pipeline.yaml`. Handles both layouts:
 *   • source-tree:    <repo>/templates/vibekit/squads/<squad>/pipeline.yaml
 *   • installed:      <project>/vibekit/squads/<squad>/pipeline.yaml
 *
 * @param {string} squad
 * @returns {string | null} absolute path, or null when not found
 */
function findPipelineFile(squad) {
  const candidate = resolve(VIBEKIT_ROOT, 'squads', squad, 'pipeline.yaml');
  return existsSync(candidate) ? candidate : null;
}

/**
 * Discovers the agents directory. Same dual-layout handling.
 * @returns {string | null}
 */
function findAgentsDir() {
  const installed = resolve(REPO_ROOT, '.claude/agents');
  if (existsSync(installed)) return installed;
  const source = resolve(REPO_ROOT, 'templates/claude/agents');
  if (existsSync(source)) return source;
  return null;
}

/**
 * Lists agent briefing ids (basename without `.md`). Empty when the
 * directory cannot be read — selfcheck handles the diagnostic.
 *
 * @param {string | null} dir
 * @returns {Set<string>}
 */
function listAgentIds(dir) {
  if (!dir) return new Set();
  try {
    return new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
  } catch {
    return new Set();
  }
}

/**
 * Validates one step's shape and grammar. Returns an array of error strings.
 *
 * @param {Record<string, unknown>} step
 * @param {Set<string>} stepIds — defined ids in the whole pipeline
 * @param {Set<string>} agentIds — agent briefings present on disk
 * @returns {string[]}
 */
function validateStep(step, stepIds, agentIds) {
  const errors = [];
  const isCheckpoint = step.type === 'checkpoint';
  const required = isCheckpoint ? REQUIRED_CHECKPOINT_FIELDS : REQUIRED_AGENT_FIELDS;
  for (const key of required) {
    if (step[key] == null) errors.push(`step ${step.id ?? '?'}: missing required field "${key}"`);
  }

  if (!isCheckpoint) {
    if (step.type && step.type !== 'checkpoint') {
      errors.push(`step ${step.id}: unknown type "${step.type}"`);
    }
    if (step.execution && !VALID_EXECUTIONS.has(step.execution)) {
      errors.push(`step ${step.id}: execution must be inline | subagent`);
    }
    if (step.model_tier && !VALID_TIERS.has(step.model_tier)) {
      errors.push(`step ${step.id}: model_tier must be fast | powerful | reasoning`);
    }
    if (typeof step.model === 'string') {
      errors.push(`step ${step.id}: vendor model names are forbidden; use model_tier`);
    }
    if (step.agent && agentIds.size > 0 && !agentIds.has(String(step.agent))) {
      errors.push(`step ${step.id}: agent "${step.agent}" has no briefing under .claude/agents/`);
    }
  }

  if (typeof step.condition === 'string') {
    const parsed = parseCondition(step.condition);
    if (!parsed.ok) errors.push(`step ${step.id}: condition refused — ${parsed.reason}`);
  }

  if (step.on_reject != null) {
    if (!stepIds.has(String(step.on_reject))) {
      errors.push(`step ${step.id}: on_reject target "${step.on_reject}" not found`);
    }
    if (!Number.isInteger(step.max_review_cycles) || step.max_review_cycles < 1) {
      errors.push(`step ${step.id}: on_reject requires max_review_cycles (integer >= 1)`);
    }
  }

  return errors;
}

/**
 * Validates the whole pipeline object. Throws on the first failure with a
 * collected error report so callers see every problem in one shot.
 *
 * @param {{ squad?: string, version?: string, steps?: unknown[] }} pipeline
 * @param {Set<string>} agentIds
 */
export function validatePipeline(pipeline, agentIds) {
  const errors = [];
  if (!pipeline || typeof pipeline !== 'object') errors.push('pipeline: missing root object');
  if (typeof pipeline.squad !== 'string') errors.push('pipeline.squad: missing or not a string');
  if (typeof pipeline.version !== 'string') errors.push('pipeline.version: missing or not a string');
  if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) errors.push('pipeline.steps: must be a non-empty array');

  if (errors.length > 0) throw new Error(errors.join('\n'));

  const stepIds = new Set();
  for (const step of pipeline.steps) {
    if (!step || typeof step !== 'object' || typeof step.id !== 'string') {
      errors.push('step: missing id');
      continue;
    }
    if (stepIds.has(step.id)) errors.push(`step ${step.id}: duplicate id`);
    stepIds.add(step.id);
  }

  for (const step of pipeline.steps) {
    if (!step || typeof step.id !== 'string') continue;
    errors.push(...validateStep(step, stepIds, agentIds));
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
}

/**
 * Walks the pipeline once, emitting one display row per step. Honours
 * `condition` by skipping when it resolves to false against `ctx`. Honours
 * `max_review_cycles` only as a marker — dry-run does not actually loop;
 * the cap belongs to the executor.
 *
 * Marker legend (from the spec):
 *   ✓ runs  ·  ⊘ skipped by condition  ·  ↺ has retry loop
 *
 * @param {{ steps: Record<string, unknown>[] }} pipeline
 * @param {Record<string, unknown>} ctx
 * @returns {Array<{ id: string, marker: '✓' | '⊘' | '↺', kind: string, agent: string, execution: string, tier: string, note: string }>}
 */
export function plan(pipeline, ctx) {
  const rows = [];
  for (const step of pipeline.steps) {
    const isCheckpoint = step.type === 'checkpoint';
    let marker = '✓';
    let note = '';
    if (typeof step.condition === 'string') {
      const parsed = parseCondition(step.condition);
      if (parsed.ok && !evalCondition(parsed.ast, ctx)) {
        marker = '⊘';
        note = `condition: ${step.condition} → false`;
      }
    }
    if (step.on_reject) {
      marker = marker === '⊘' ? '⊘' : '↺';
      note = `on_reject → ${step.on_reject}, max_cycles: ${step.max_review_cycles}`;
    }
    rows.push({
      id: String(step.id),
      marker,
      kind: isCheckpoint ? 'checkpoint' : 'agent',
      agent: isCheckpoint ? '' : String(step.agent ?? ''),
      execution: isCheckpoint ? '' : String(step.execution ?? ''),
      tier: isCheckpoint ? '' : String(step.model_tier ?? ''),
      note,
    });
  }
  return rows;
}

/**
 * Formats the dry-run plan as a single text block ready for stdout.
 * Kept here (not in a sibling) because the marker semantics are intimate
 * with `plan` above — separating them would require re-exporting the row
 * shape across two files for no gain.
 */
function formatPlan(pipeline, rows) {
  const lines = [`Pipeline: ${pipeline.squad} v${pipeline.version}`];
  for (const r of rows) {
    const fields = r.kind === 'checkpoint'
      ? [r.marker, r.id.padEnd(28), 'checkpoint']
      : [r.marker, r.id.padEnd(28), r.kind.padEnd(10), r.agent.padEnd(22), r.execution.padEnd(8), r.tier];
    let line = `  ${fields.join(' ')}`;
    if (r.note) line += `   (${r.note})`;
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Loads and validates a pipeline, returning the parsed object on success.
 * Exposed so the selfcheck and the integration test can call it without
 * spawning a process.
 *
 * @param {string} squad
 * @returns {Promise<{ pipeline: object, file: string, agentsDir: string | null } | { yamlAbsent: true }>}
 */
export async function loadAndValidate(squad) {
  const file = findPipelineFile(squad);
  if (!file) throw new Error(`pipeline.yaml not found for squad "${squad}"`);

  let pipeline;
  try {
    const text = readFileSync(file, 'utf-8');
    pipeline = await (await loadYaml()).parse(text.replace(/^﻿/, ''));
  } catch (err) {
    if (/needs the `yaml` package/.test(String(err?.message))) return { yamlAbsent: true };
    throw new Error(`pipeline.yaml malformed: ${err?.message ?? err}`);
  }

  // Normalise: top-level may be { pipeline: {...} } or the bare pipeline body.
  const body = pipeline?.pipeline ?? pipeline;
  const agentsDir = findAgentsDir();
  validatePipeline(body, listAgentIds(agentsDir));
  return { pipeline: body, file, agentsDir };
}

async function main() {
  const squad = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!squad) {
    console.error('Usage: squad-pipeline.mjs <squad> [--dry-run]');
    process.exit(1);
  }

  let result;
  try {
    result = await loadAndValidate(squad);
  } catch (err) {
    console.error(`❌ ${err?.message ?? err}`);
    process.exit(1);
  }

  if (result.yamlAbsent) {
    console.log(`ℹ️  pipelines are opt-in — install the optional 'yaml' dep to use them:`);
    console.log(`   npm i yaml`);
    console.log(`   (squad "${squad}" continues to work without the DSL.)`);
    process.exit(0);
  }

  if (dryRun) {
    console.log(formatPlan(result.pipeline, plan(result.pipeline, {})));
    return;
  }

  console.log(`✅ ${squad} pipeline validated (${result.pipeline.steps.length} steps).`);
  console.log(`   Run with --dry-run to print the would-be execution order.`);
}

// Only run when invoked as a CLI; library imports stay side-effect-free.
// `process.argv[1]` is undefined when the module is imported via `node -e`,
// so we guard explicitly before doing any string work.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`❌ ${err?.message ?? err}`);
    process.exit(1);
  });
}
