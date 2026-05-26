/**
 * agent-architect — the interview script + Agent Blueprint schema. The architect AGENT
 * (a Claude briefing in `.claude/agents/agent-architect.md`) drives the conversation
 * with the developer; this module is the pure data + validation half. It holds the
 * canonical question list, default values, a structural validator, and a stable
 * blueprint hash used for provenance.
 *
 * Pure + zero-dep (rule 1). No I/O, no YAML — the orchestrator parses YAML upstream
 * via `lib/yaml.mjs` (ADR-0013) and hands a parsed object here.
 */
import { createHash } from 'node:crypto';

/**
 * Canonical interview questions. Field ids use dot notation matching the Agent
 * Blueprint shape (e.g. `intent.category`). The order is the order the architect
 * agent asks; defaults are SAFE — never inferred from a quality claim.
 */
export const INTERVIEW_QUESTIONS = [
  { id: 'agent_name', prompt: 'Kebab-case name for the agent (e.g. `intake-classifier`)', type: 'string', required: true },
  { id: 'role_one_line', prompt: 'One-line role description (start with "You are…")', type: 'string', required: true },
  { id: 'intent.category', prompt: 'Intent category', type: 'enum',
    enum: ['classification', 'extraction', 'generation', 'reasoning', 'coding', 'summarization', 'rag-answer', 'vision', 'agentic-multi-step', 'function-calling-heavy'],
    required: true },
  { id: 'intent.complexity', prompt: 'Complexity', type: 'enum', enum: ['low', 'medium', 'high'], default: 'medium' },
  { id: 'intent.multimodal', prompt: 'Does it need vision (images)?', type: 'boolean', default: false },
  { id: 'sla.latency_p95_ms', prompt: 'p95 latency target (ms)', type: 'number', default: 8000 },
  { id: 'cost.target_usd_per_call', prompt: 'Target cost per call (USD)', type: 'number', default: 0.015 },
  { id: 'cost.max_usd_per_call', prompt: 'Hard cost ceiling per call (USD)', type: 'number', default: 0.05 },
  { id: 'cost.monthly_budget_usd', prompt: 'Monthly budget (USD)', type: 'number', default: 500 },
  { id: 'volume.expected_qpd', prompt: 'Expected queries per day', type: 'number', default: 2000 },
  { id: 'privacy.pii_present', prompt: 'Does input contain PII?', type: 'boolean', default: false },
  { id: 'privacy.data_residency', prompt: 'Data residency', type: 'enum', enum: ['us', 'br-or-eu', 'on-prem', 'any'], default: 'any' },
  { id: 'privacy.allow_cloud_providers', prompt: 'Allow cloud providers?', type: 'boolean', default: true },
  { id: 'privacy.require_zero_retention', prompt: 'Require zero-retention APIs?', type: 'boolean', default: false },
  { id: 'capabilities.tools', prompt: 'Does the agent call tools?', type: 'boolean', default: false },
  { id: 'capabilities.rag', prompt: 'Does the agent use RAG?', type: 'boolean', default: false },
  { id: 'capabilities.structured_output', prompt: 'Does it return structured JSON?', type: 'boolean', default: false },
];

const REQUIRED_PATHS = INTERVIEW_QUESTIONS.filter((q) => q.required).map((q) => q.id);
const CATEGORY_ENUM = INTERVIEW_QUESTIONS.find((q) => q.id === 'intent.category').enum;
const COMPLEXITY_ENUM = ['low', 'medium', 'high'];
const RESIDENCY_ENUM = ['us', 'br-or-eu', 'on-prem', 'any'];

function readPath(obj, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

function writePath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] == null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts.at(-1)] = value;
}

/** Recursively sort object keys so JSON.stringify produces a stable hash. */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value).sort().reduce((acc, k) => { acc[k] = canonicalize(value[k]); return acc; }, {});
}

/**
 * Structural validation: required fields present + enum values valid + kebab-case
 * agent name. Returns `{ ok, errors[] }` — never throws.
 */
export function validateBlueprint(blueprint) {
  const errors = [];
  if (!blueprint || typeof blueprint !== 'object') return { ok: false, errors: ['blueprint is not an object'] };
  for (const path of REQUIRED_PATHS) {
    if (readPath(blueprint, path) == null) errors.push(`missing required field: ${path}`);
  }
  const name = blueprint.agent_name;
  if (name && !/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`agent_name must be kebab-case (got: ${name})`);
  const category = readPath(blueprint, 'intent.category');
  if (category && !CATEGORY_ENUM.includes(category)) errors.push(`intent.category invalid: ${category} (allowed: ${CATEGORY_ENUM.join('|')})`);
  const complexity = readPath(blueprint, 'intent.complexity');
  if (complexity && !COMPLEXITY_ENUM.includes(complexity)) errors.push(`intent.complexity invalid: ${complexity}`);
  const residency = readPath(blueprint, 'privacy.data_residency');
  if (residency && !RESIDENCY_ENUM.includes(residency)) errors.push(`privacy.data_residency invalid: ${residency}`);
  return { ok: errors.length === 0, errors };
}

/** Fill missing fields with the question defaults; never overwrites a present value. */
export function fillDefaults(blueprint) {
  const out = structuredClone(blueprint);
  for (const q of INTERVIEW_QUESTIONS) {
    if (q.default === undefined) continue;
    if (readPath(out, q.id) === undefined) writePath(out, q.id, q.default);
  }
  return out;
}

/** Stable SHA-256 of the (canonicalized) blueprint — the provenance.blueprint_hash. */
export function blueprintHash(blueprint) {
  return createHash('sha256').update(JSON.stringify(canonicalize(blueprint))).digest('hex');
}
