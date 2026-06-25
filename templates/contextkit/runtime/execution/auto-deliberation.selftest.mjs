/**
 * In-process self-test for auto-deliberation.mjs (WF0038 A7-T2, ADR-0112).
 *
 * Runs under plain `node auto-deliberation.selftest.mjs`, zero dependencies.
 * Sections:
 *   [a] Fires on material+grade4+active — numeric threshold met.
 *   [b] Does NOT fire on trivial request (grade 3, active, low materiality, no structural).
 *   [c] Does NOT fire when grade < 3 (grade 2, even if materiality > threshold).
 *   [d] Does NOT fire when deliberations inactive (grade 4, high materiality).
 *   [e] Structural trigger (auth) fires even at sub-threshold materiality.
 *   [f] Structural trigger (migration) fires even at materiality 0.
 *   [g] Structural trigger (new-dependency) fires even at materiality 0.
 *   [h] Structural trigger (public-contract-change) fires.
 *   [i] Structural trigger (irreversible-action) fires.
 *   [j] Synthesizer is distinct from every voice in recommendedCouncil.
 *   [k] Determinism: same input → byte-identical JSON output twice.
 *   [l] Threshold override is recorded in the result.
 *   [m] Fail-open: never throws on null/hostile input.
 *   [n] recommendedCouncil is null when shouldConvene is false.
 *   [o] Result is frozen (immutable).
 *
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 */
import { recommendDeliberation } from './auto-deliberation.mjs';

const failures = [];
let total = 0;

/**
 * @param {string} label
 * @param {boolean} cond
 * @param {string} [detail]
 */
function assert(label, cond, detail = '') {
  total++;
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const ACTIVE_GRADE4 = Object.freeze({ grade: 4, deliberationsActive: true });
const ACTIVE_GRADE3 = Object.freeze({ grade: 3, deliberationsActive: true });

// ---------------------------------------------------------------------------
// [a] Fires on material + grade 4 + active
// ---------------------------------------------------------------------------
process.stdout.write('\n[a] Fires on material + grade4 + active (numeric threshold)\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE4, materiality: 0.8, decisionSignal: 'adopt new architecture pattern' },
  );
  assert('[a] shouldConvene true', result.shouldConvene === true, `got ${result.shouldConvene}`);
  assert('[a] reasonCodes includes materiality-threshold', result.reasonCodes.includes('materiality-threshold'));
  assert('[a] recommendedCouncil present', result.recommendedCouncil !== null);
  assert('[a] materiality recorded', result.materiality === 0.8, `got ${result.materiality}`);
  assert('[a] threshold recorded as 0.6', result.threshold === 0.6, `got ${result.threshold}`);
}

// ---------------------------------------------------------------------------
// [b] Does NOT fire on trivial (grade 3, active, low materiality, no structural)
// ---------------------------------------------------------------------------
process.stdout.write('\n[b] Does NOT fire on trivial request\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0.1, request: 'update a comment in the readme' },
  );
  assert('[b] shouldConvene false', result.shouldConvene === false, `got ${result.shouldConvene}`);
  assert('[b] recommendedCouncil null', result.recommendedCouncil === null);
  assert('[b] reasonCodes does not include materiality-threshold', !result.reasonCodes.includes('materiality-threshold'));
}

// ---------------------------------------------------------------------------
// [c] Does NOT fire when grade < 3
// ---------------------------------------------------------------------------
process.stdout.write('\n[c] Does NOT fire when grade < 3\n');
{
  const result = recommendDeliberation(
    { grade: 2, deliberationsActive: true, materiality: 0.99, decisionSignal: 'major architecture change' },
  );
  assert('[c] shouldConvene false at grade 2', result.shouldConvene === false, `got ${result.shouldConvene}`);
  assert('[c] reasonCodes includes grade-below-3', result.reasonCodes.includes('grade-below-3'));
  assert('[c] recommendedCouncil null', result.recommendedCouncil === null);

  const resultGrade1 = recommendDeliberation(
    { grade: 1, deliberationsActive: true, materiality: 1, request: 'migrate the entire database schema' },
  );
  assert('[c] shouldConvene false at grade 1', resultGrade1.shouldConvene === false, `got ${resultGrade1.shouldConvene}`);
}

// ---------------------------------------------------------------------------
// [d] Does NOT fire when deliberations inactive
// ---------------------------------------------------------------------------
process.stdout.write('\n[d] Does NOT fire when deliberations inactive\n');
{
  const result = recommendDeliberation(
    { grade: 4, deliberationsActive: false, materiality: 1, decisionSignal: 'add auth module' },
  );
  assert('[d] shouldConvene false when inactive', result.shouldConvene === false, `got ${result.shouldConvene}`);
  assert('[d] reasonCodes includes deliberations-inactive', result.reasonCodes.includes('deliberations-inactive'));

  const resultMissing = recommendDeliberation(
    { grade: 4, materiality: 1, decisionSignal: 'add auth module' },
  );
  assert('[d] shouldConvene false when deliberationsActive missing', resultMissing.shouldConvene === false);
}

// ---------------------------------------------------------------------------
// [e] Structural: auth/security fires even at sub-threshold materiality
// ---------------------------------------------------------------------------
process.stdout.write('\n[e] Structural trigger: auth/security fires at sub-threshold materiality\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0.1, decisionSignal: 'update oauth token flow' },
  );
  assert('[e] shouldConvene true (auth structural)', result.shouldConvene === true, `got ${result.shouldConvene}`);
  assert('[e] reasonCodes includes auth-security', result.reasonCodes.includes('auth-security'));
  assert('[e] materiality below threshold but still convenes', result.materiality < result.threshold);
  assert('[e] recommendedCouncil present', result.recommendedCouncil !== null);
}

// ---------------------------------------------------------------------------
// [f] Structural: migration fires at materiality 0
// ---------------------------------------------------------------------------
process.stdout.write('\n[f] Structural trigger: migration fires at materiality 0\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0, decisionSignal: 'migrate the database schema' },
  );
  assert('[f] shouldConvene true (migration structural)', result.shouldConvene === true, `got ${result.shouldConvene}`);
  assert('[f] reasonCodes includes migration', result.reasonCodes.includes('migration'));
}

// ---------------------------------------------------------------------------
// [g] Structural: new-dependency fires at materiality 0
// ---------------------------------------------------------------------------
process.stdout.write('\n[g] Structural trigger: new-dependency fires at materiality 0\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE4, materiality: 0, request: 'add new dependency zod to the project' },
  );
  assert('[g] shouldConvene true (new-dependency structural)', result.shouldConvene === true, `got ${result.shouldConvene}`);
  assert('[g] reasonCodes includes new-dependency', result.reasonCodes.includes('new-dependency'));
}

// ---------------------------------------------------------------------------
// [h] Structural: public-contract-change fires
// ---------------------------------------------------------------------------
process.stdout.write('\n[h] Structural trigger: public-contract-change fires\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0, decisionSignal: 'remove endpoint from public api' },
  );
  assert('[h] shouldConvene true (public-contract-change)', result.shouldConvene === true, `got ${result.shouldConvene}`);
  assert('[h] reasonCodes includes public-contract-change', result.reasonCodes.includes('public-contract-change'));
}

// ---------------------------------------------------------------------------
// [i] Structural: irreversible-action fires
// ---------------------------------------------------------------------------
process.stdout.write('\n[i] Structural trigger: irreversible-action fires\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0, decisionSignal: 'delete data from production users table' },
  );
  assert('[i] shouldConvene true (irreversible-action)', result.shouldConvene === true, `got ${result.shouldConvene}`);
  assert('[i] reasonCodes includes irreversible-action', result.reasonCodes.includes('irreversible-action'));
}

// ---------------------------------------------------------------------------
// [j] Synthesizer is distinct from every voice
// ---------------------------------------------------------------------------
process.stdout.write('\n[j] Synthesizer is distinct from every voice\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE4, materiality: 1 },
  );
  assert('[j] shouldConvene true for this test', result.shouldConvene === true);
  const { voices, synthesizer } = result.recommendedCouncil;
  assert('[j] synthesizer not in voices', !voices.includes(synthesizer), `synthesizer=${synthesizer}, voices=${voices.join(',')}`);
  assert('[j] at least 2 voices', voices.length >= 2, `got ${voices.length}`);
  assert('[j] synthesizer is a non-empty string', typeof synthesizer === 'string' && synthesizer.length > 0);
}

// ---------------------------------------------------------------------------
// [k] Determinism: same input → byte-identical JSON output twice
// ---------------------------------------------------------------------------
process.stdout.write('\n[k] Determinism: same input → identical JSON output\n');
{
  const input1 = { ...ACTIVE_GRADE4, materiality: 0.75, decisionSignal: 'adopt a new auth pattern kit-wide' };
  const r1 = JSON.stringify(recommendDeliberation(input1));
  const r2 = JSON.stringify(recommendDeliberation(input1));
  assert('[k] deterministic on high-materiality+structural', r1 === r2, `outputs differ`);

  const input2 = { ...ACTIVE_GRADE3, materiality: 0.2, request: 'fix a typo in docs' };
  const r3 = JSON.stringify(recommendDeliberation(input2));
  const r4 = JSON.stringify(recommendDeliberation(input2));
  assert('[k] deterministic on trivial', r3 === r4, `outputs differ`);
}

// ---------------------------------------------------------------------------
// [l] Threshold override is recorded in the result
// ---------------------------------------------------------------------------
process.stdout.write('\n[l] Threshold override recorded in result\n');
{
  const result = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0.5 },
    { threshold: 0.4 },
  );
  assert('[l] custom threshold recorded', result.threshold === 0.4, `got ${result.threshold}`);
  assert('[l] shouldConvene true (0.5 >= 0.4)', result.shouldConvene === true, `got ${result.shouldConvene}`);

  const resultBelow = recommendDeliberation(
    { ...ACTIVE_GRADE3, materiality: 0.3, request: 'update changelog entry' },
    { threshold: 0.4 },
  );
  assert('[l] shouldConvene false when materiality below custom threshold (no structural)', resultBelow.shouldConvene === false, `got ${resultBelow.shouldConvene}`);
}

// ---------------------------------------------------------------------------
// [m] Fail-open: never throws on null/hostile input
// ---------------------------------------------------------------------------
process.stdout.write('\n[m] Fail-open: never throws on hostile input\n');
{
  let threw = false;
  try {
    recommendDeliberation(null);
    recommendDeliberation(undefined);
    recommendDeliberation([]);
    recommendDeliberation('string');
    recommendDeliberation(42);
    recommendDeliberation({});
    recommendDeliberation({ grade: 'bad', deliberationsActive: null, materiality: 'x' });
  } catch {
    threw = true;
  }
  assert('[m] never throws on hostile input', threw === false);

  const safe = recommendDeliberation(null);
  assert('[m] null input → shouldConvene false', safe.shouldConvene === false);
  assert('[m] null input → reasonCodes array', Array.isArray(safe.reasonCodes));
}

// ---------------------------------------------------------------------------
// [n] recommendedCouncil is null when shouldConvene is false
// ---------------------------------------------------------------------------
process.stdout.write('\n[n] recommendedCouncil null when shouldConvene false\n');
{
  const result = recommendDeliberation({ grade: 1, deliberationsActive: true, materiality: 1 });
  assert('[n] shouldConvene false', result.shouldConvene === false);
  assert('[n] recommendedCouncil null when not convening', result.recommendedCouncil === null);
}

// ---------------------------------------------------------------------------
// [o] Result is frozen (immutable)
// ---------------------------------------------------------------------------
process.stdout.write('\n[o] Result is frozen (immutable)\n');
{
  const result = recommendDeliberation({ ...ACTIVE_GRADE4, materiality: 0.9 });
  let mutationThrew = false;
  try {
    // In strict mode (ESM) assignment to a frozen property throws TypeError.
    'use strict';
    // @ts-ignore
    result.shouldConvene = false;
  } catch {
    mutationThrew = true;
  }
  assert('[o] result is frozen (mutation throws or is silently ignored)', Object.isFrozen(result));
  assert('[o] recommendedCouncil is frozen when present', result.recommendedCouncil === null || Object.isFrozen(result.recommendedCouncil));
}

// ─── Summary ─────────────────────────────────────────────────────────────────
process.stdout.write(
  failures.length
    ? `\nFAIL ${failures.length}/${total} — failed: ${failures.join(', ')}\n`
    : `\nok ${total}/${total}\n`,
);
process.exit(failures.length ? 1 : 0);
