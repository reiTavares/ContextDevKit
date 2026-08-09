/**
 * In-process self-test for `business-growth-validator.mjs` (BIZ-0001 / WF-0036, A3-T1).
 *
 * Zero-dependency, runs under plain `node`. Proves the Gate G-A3 growth-validator
 * acceptance criteria against the ACTUAL exported API `validateGrowth({ growth, valueIntent })`:
 *   (a) valid Business with full causal chain + complete KPIs + baseline 'unknown'
 *       → ok:true;
 *   (b) missing KPI field (no target / no owner / no cadence) → ok:false with an
 *       errors entry whose code / field identifies the problem;
 *   (c) generic / unquantified claim (no digit in target, not a sentinel) → ok:false;
 *   (d) fabricated numeric baseline WITHOUT a source → ok:false; baseline 'unknown'
 *       is NOT flagged (provenance rule §8).
 *
 * All inputs are deterministic fixed literals (no clock/random). No temp root
 * is written — the validator is a pure function. Exit 0 = all assertions held;
 * exit 1 = at least one failed.
 */
import { validateGrowth, GROWTH_ERROR_CODES } from './business-growth-validator.mjs';

const failures = [];
/**
 * Records a named assertion.
 * @param {string} label - human-readable assertion name for failure output.
 * @param {boolean} cond - the condition that must be true for the assertion to pass.
 */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------------------------
// Fixture helpers — accept the actual API: validateGrowth({ growth, valueIntent }).
// ---------------------------------------------------------------------------

/** A KPI record that satisfies all required fields per REQUIRED_KPI_FIELDS. */
function kpiRecord(overrides = {}) {
  return {
    metric: 'install count',
    target: '500 installs/month by 2026-Q4',
    owner: 'product',
    cadence: 'monthly',
    baseline: 'unknown',
    ...overrides,
  };
}

/** A growth sub-object with a primaryLever and one valid KPI. */
function validGrowth(overrides = {}) {
  return {
    primaryLever: 'STRATEGIC_ENABLEMENT',
    kpis: [kpiRecord()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) HAPPY PATH — valueIntent + primaryLever + complete KPI + baseline unknown.
// ---------------------------------------------------------------------------
process.stdout.write('\n[a] Happy path — valueIntent + lever + complete KPI + baseline unknown\n');
{
  const result = validateGrowth({ growth: validGrowth(), valueIntent: 'ENABLE' });
  assert('ok:true on a fully valid input', result.ok === true);
  assert('errors is empty array on valid input',
    Array.isArray(result.errors) && result.errors.length === 0);
}

// ---------------------------------------------------------------------------
// (b) MISSING KPI FIELDS — each required sub-field omitted independently.
//     Errors carry a `code` and `field` so the test catches regressions in
//     the error shape, not just truthiness.
// ---------------------------------------------------------------------------
process.stdout.write('\n[b] Missing KPI fields — one required field absent each time\n');
{
  const noTarget = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ target: undefined })] }),
    valueIntent: 'ENABLE',
  });
  assert('missing kpi.target → ok:false', noTarget.ok === false);
  assert('missing kpi.target → KPI_MISSING_FIELD code',
    Array.isArray(noTarget.errors)
    && noTarget.errors.some((e) => e.code === GROWTH_ERROR_CODES.KPI_MISSING_FIELD && /target/i.test(e.field)));

  const noOwner = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ owner: undefined })] }),
    valueIntent: 'ENABLE',
  });
  assert('missing kpi.owner → ok:false', noOwner.ok === false);
  assert('missing kpi.owner → KPI_MISSING_FIELD code',
    Array.isArray(noOwner.errors)
    && noOwner.errors.some((e) => e.code === GROWTH_ERROR_CODES.KPI_MISSING_FIELD && /owner/i.test(e.field)));

  const noCadence = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ cadence: undefined })] }),
    valueIntent: 'ENABLE',
  });
  assert('missing kpi.cadence → ok:false', noCadence.ok === false);
  assert('missing kpi.cadence → KPI_MISSING_FIELD code',
    Array.isArray(noCadence.errors)
    && noCadence.errors.some((e) => e.code === GROWTH_ERROR_CODES.KPI_MISSING_FIELD && /cadence/i.test(e.field)));

  // Empty kpis array (no KPIs at all).
  const noKpis = validateGrowth({
    growth: validGrowth({ kpis: [] }),
    valueIntent: 'ENABLE',
  });
  assert('empty kpis[] → ok:false', noKpis.ok === false);
  assert('empty kpis[] → EMPTY_KPI_LIST code',
    Array.isArray(noKpis.errors)
    && noKpis.errors.some((e) => e.code === GROWTH_ERROR_CODES.EMPTY_KPI_LIST));
}

// ---------------------------------------------------------------------------
// (c) GENERIC / UNQUANTIFIED TARGETS — targets with no digit and not a sentinel.
// ---------------------------------------------------------------------------
process.stdout.write('\n[c] Generic / unquantified KPI targets\n');
{
  const genericTarget = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ target: 'improve things significantly' })] }),
    valueIntent: 'ENABLE',
  });
  assert('prose target without a digit → ok:false', genericTarget.ok === false);
  assert('prose target → KPI_UNQUANTIFIED_TARGET code',
    Array.isArray(genericTarget.errors)
    && genericTarget.errors.some((e) => e.code === GROWTH_ERROR_CODES.KPI_UNQUANTIFIED_TARGET));

  // Sentinel targets that ARE allowed (no digit needed).
  for (const sentinel of ['unknown', 'to-be-defined', 'n/a', 'tbd']) {
    const sentinelResult = validateGrowth({
      growth: validGrowth({ kpis: [kpiRecord({ target: sentinel })] }),
      valueIntent: 'ENABLE',
    });
    assert(`sentinel target "${sentinel}" is accepted (ok:true)`, sentinelResult.ok === true);
  }

  // Missing valueIntent → MISSING_VALUE_INTENT code.
  const noIntent = validateGrowth({ growth: validGrowth() });
  assert('absent valueIntent → ok:false', noIntent.ok === false);
  assert('absent valueIntent → MISSING_VALUE_INTENT code',
    Array.isArray(noIntent.errors)
    && noIntent.errors.some((e) => e.code === GROWTH_ERROR_CODES.MISSING_VALUE_INTENT));

  // Missing primaryLever → MISSING_GROWTH_LEVER code.
  const noLever = validateGrowth({
    growth: validGrowth({ primaryLever: undefined }),
    valueIntent: 'ENABLE',
  });
  assert('absent primaryLever → ok:false', noLever.ok === false);
  assert('absent primaryLever → MISSING_GROWTH_LEVER code',
    Array.isArray(noLever.errors)
    && noLever.errors.some((e) => e.code === GROWTH_ERROR_CODES.MISSING_GROWTH_LEVER));
}

// ---------------------------------------------------------------------------
// (d) BASELINE PROVENANCE — fabricated concrete value vs 'unknown'.
// ---------------------------------------------------------------------------
process.stdout.write('\n[d] Baseline provenance — fabricated number vs unknown / sourced\n');
{
  // Baseline 'unknown' must pass.
  const unknownBaseline = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ baseline: 'unknown' })] }),
    valueIntent: 'ENABLE',
  });
  assert("baseline 'unknown' is NOT flagged (provenance rule)", unknownBaseline.ok === true);

  // null baseline is also allowed (treated as unknown per spec §10.4(d)).
  const nullBaseline = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ baseline: null })] }),
    valueIntent: 'ENABLE',
  });
  assert('null baseline is NOT flagged (treated as unknown)', nullBaseline.ok === true);

  // undefined baseline is also allowed.
  const undefBaseline = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ baseline: undefined })] }),
    valueIntent: 'ENABLE',
  });
  assert('undefined baseline is NOT flagged (treated as unknown)', undefBaseline.ok === true);

  // Concrete baseline string WITHOUT a source → refused.
  const fabricated = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ baseline: '120 installs/month' })] }),
    valueIntent: 'ENABLE',
  });
  assert('fabricated numeric baseline without source → ok:false', fabricated.ok === false);
  assert('fabricated baseline → KPI_BASELINE_WITHOUT_SOURCE code',
    Array.isArray(fabricated.errors)
    && fabricated.errors.some((e) => e.code === GROWTH_ERROR_CODES.KPI_BASELINE_WITHOUT_SOURCE));

  // Concrete baseline WITH a source field → accepted.
  const sourced = validateGrowth({
    growth: validGrowth({ kpis: [kpiRecord({ baseline: '120 installs/month', source: 'npm download stats 2026-06-19' })] }),
    valueIntent: 'ENABLE',
  });
  assert('numeric baseline WITH explicit source → ok:true', sourced.ok === true);
}

// ---------------------------------------------------------------------------
// Defensive — never throws on null / malformed input.
// ---------------------------------------------------------------------------
process.stdout.write('\n[e] Defensive — never throws on hostile input\n');
{
  let threw = false;
  try {
    for (const probe of [null, undefined, 42, '', [], {}]) validateGrowth(probe);
    validateGrowth({ growth: null, valueIntent: null });
    validateGrowth({ growth: 'string', valueIntent: 123 });
  } catch {
    threw = true;
  }
  assert('validateGrowth never throws on hostile input', threw === false);

  const nullResult = validateGrowth({ growth: null, valueIntent: null });
  assert('null growth → ok:false with at least one error',
    nullResult.ok === false && Array.isArray(nullResult.errors) && nullResult.errors.length > 0);
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
