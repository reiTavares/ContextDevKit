/**
 * Pure validation for the universal wave workflow engine (WF0035, ADR-0101).
 * Holds `validatePlan` (structure + direct-reference existence over a normalized
 * `workflow-plan.json`) and the full-pack entry `validatePack`, which later waves
 * extend with state + files-vs-catalog checks.
 *
 * Validators NEVER throw on bad CONTENT — they return typed `{code,message,path}`
 * errors so a caller can report every problem at once (fail-fast at the I/O
 * boundary is `plan.writePlan`'s job, which calls these first).
 *
 * cycle detection: WAVE 2 dag.mjs owns it. This file only checks that each
 * `dependsOn` / gate reference names an EXISTING id — never acyclicity. Keep that
 * seam clean; do not import the registry resolvers (built in parallel).
 *
 * Zero runtime dependencies — node:* only (ADR-0001). Lives in W1-T2's lane.
 */

/** Execution modes a task may declare (mirrors plan.mjs; kept local to stay pure). */
const VALID_MODES = ['agent', 'deterministic', 'orchestrator', 'human'];

/** Profiles that require ownership on an agent-mode task. */
const OWNERSHIP_PROFILES = ['standard', 'advanced', 'program'];

/** Build a typed validation error. */
function fail(code, message, path) {
  return { code, message, path };
}

/** True when `value` is a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Validate the required top-level identity fields; push errors as found. */
function checkIdentity(plan, errors) {
  if (plan.schemaVersion !== 1) {
    errors.push(fail('invalid-schema-version', 'schemaVersion must be 1', 'schemaVersion'));
  }
  for (const field of ['workflowId', 'slug', 'profile']) {
    if (!isNonEmptyString(plan[field])) {
      errors.push(fail('missing-field', `${field} is required and must be a non-empty string`, field));
    }
  }
}

/** Validate wave ids (present + unique) and return the set of seen wave ids. */
function checkWaveIds(waves, errors) {
  const seen = new Set();
  waves.forEach((wave, index) => {
    if (!isNonEmptyString(wave.id)) {
      errors.push(fail('invalid-wave-id', 'wave id is required', `waves[${index}].id`));
      return;
    }
    if (seen.has(wave.id)) {
      errors.push(fail('duplicate-wave-id', `duplicate wave id "${wave.id}"`, `waves[${index}].id`));
    }
    seen.add(wave.id);
  });
  return seen;
}

/** Collect task ids globally; flag missing/duplicate and waveId mismatches. */
function collectTaskIds(waves, errors) {
  const seen = new Set();
  waves.forEach((wave, waveIndex) => {
    const tasks = Array.isArray(wave.tasks) ? wave.tasks : [];
    tasks.forEach((task, taskIndex) => {
      const at = `waves[${waveIndex}].tasks[${taskIndex}]`;
      if (!isNonEmptyString(task.id)) {
        errors.push(fail('invalid-task-id', 'task id is required', `${at}.id`));
        return;
      }
      if (seen.has(task.id)) {
        errors.push(fail('duplicate-task-id', `duplicate task id "${task.id}"`, `${at}.id`));
      }
      seen.add(task.id);
      if (task.waveId !== wave.id) {
        errors.push(fail('task-wave-mismatch', `task "${task.id}" waveId "${task.waveId}" != "${wave.id}"`, `${at}.waveId`));
      }
    });
  });
  return seen;
}

/** Validate wave-level dependsOn + gate references against known ids. */
function checkWaveRefs(waves, waveIds, gateIds, errors) {
  waves.forEach((wave, index) => {
    const deps = Array.isArray(wave.dependsOn) ? wave.dependsOn : [];
    deps.forEach((dep) => {
      if (!waveIds.has(dep)) {
        errors.push(fail('unknown-dependency', `wave "${wave.id}" depends on unknown wave "${dep}"`, `waves[${index}].dependsOn`));
      }
    });
    if (wave.gate !== null && wave.gate !== undefined && !gateIds.has(wave.gate)) {
      errors.push(fail('unknown-gate', `wave "${wave.id}" references unknown gate "${wave.gate}"`, `waves[${index}].gate`));
    }
  });
}

/** Validate one task's mode, dependsOn references, and ownership requirement. */
function checkTask(task, position, taskIds, ownershipRequired, errors) {
  const execution = task.execution && typeof task.execution === 'object' ? task.execution : {};
  if (!VALID_MODES.includes(execution.mode)) {
    errors.push(fail('invalid-mode', `task "${task.id}" has invalid execution mode "${execution.mode}"`, `${position}.execution.mode`));
  }
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  deps.forEach((dep) => {
    if (!taskIds.has(dep)) {
      errors.push(fail('unknown-dependency', `task "${task.id}" depends on unknown task "${dep}"`, `${position}.dependsOn`));
    }
  });
  if (ownershipRequired && execution.mode === 'agent') {
    const ownership = task.ownership && typeof task.ownership === 'object' ? task.ownership : {};
    const allowed = Array.isArray(ownership.allowedPaths) ? ownership.allowedPaths : [];
    if (allowed.length === 0) {
      errors.push(fail('missing-ownership', `agent task "${task.id}" needs ownership.allowedPaths in this profile`, `${position}.ownership`));
    }
  }
}

/** Validate gate ids (present + unique) and return the set of seen gate ids. */
function checkGateIds(gates, errors) {
  const seen = new Set();
  gates.forEach((gate, index) => {
    if (!isNonEmptyString(gate.id)) {
      errors.push(fail('invalid-gate-id', 'gate id is required', `gates[${index}].id`));
      return;
    }
    if (seen.has(gate.id)) {
      errors.push(fail('duplicate-gate-id', `duplicate gate id "${gate.id}"`, `gates[${index}].id`));
    }
    seen.add(gate.id);
  });
  return seen;
}

/**
 * Validate a normalized plan's structure and direct reference existence. Does NOT
 * detect cycles (WAVE 2 dag.mjs) and does NOT check registry membership.
 * @param {object} plan a plan object (normalize first for stable paths)
 * @returns {{ valid: boolean, errors: Array<{code:string,message:string,path:string}> }}
 */
export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, errors: [fail('invalid-plan', 'plan must be an object', '')] };
  }
  checkIdentity(plan, errors);
  const waves = Array.isArray(plan.waves) ? plan.waves : [];
  const gates = Array.isArray(plan.gates) ? plan.gates : [];
  const waveIds = checkWaveIds(waves, errors);
  const taskIds = collectTaskIds(waves, errors);
  const gateIds = checkGateIds(gates, errors);
  checkWaveRefs(waves, waveIds, gateIds, errors);
  const ownershipRequired = OWNERSHIP_PROFILES.includes(plan.profile);
  waves.forEach((wave, waveIndex) => {
    const tasks = Array.isArray(wave.tasks) ? wave.tasks : [];
    tasks.forEach((task, taskIndex) => {
      checkTask(task, `waves[${waveIndex}].tasks[${taskIndex}]`, taskIds, ownershipRequired, errors);
    });
  });
  return { valid: errors.length === 0, errors };
}

/**
 * Full-pack validation entry. For now composes only plan validation; later waves
 * extend it with state + files-vs-catalog checks (keep the shape additive).
 * @param {{ plan: object }} pack the pack pieces to validate
 * @returns {{ valid: boolean, plan: { valid: boolean, errors: Array<object> } }}
 */
export function validatePack({ plan }) {
  const planResult = validatePlan(plan);
  return { valid: planResult.valid, plan: planResult };
}
