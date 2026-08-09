/**
 * In-process self-test for the WF-0090 GA1 grounded content engine
 * (`content-fill.mjs` + `content-grounding.mjs` + `content-eligibility.mjs`;
 * BIZ-0006, ADR-0148 rails (a) and (b)).
 *
 * Every case runs with a FAKE generator — zero model calls, zero tokens, no
 * network — and against a tiny in-memory fixture projection rather than the real
 * repo graph, so the suite is deterministic and fast. What it proves:
 *   [a] grounded-only-or-token       — a validated citation fills; the text is returned
 *   [b] ungrounded-left-as-token     — an empty retrieved set refuses AND never calls
 *                                      the generator (a refusal costs nothing)
 *   [c] hallucinated-citation-rejected — a nonexistent id refuses; a real-but-
 *                                      unretrieved id refuses too
 *   [d] no-invented-numbers          — a numeric literal absent from every exemplar
 *                                      body refuses (constitution §8 on prose)
 *   [e] generated-is-draft           — the sidecar entry is `draft` /
 *                                      `llm:grounded-content` with sorted citations,
 *                                      and `validateProvenanceSidecar` accepts it
 *   [f] targets-null-until-measured  — no KPI/target/status field is ever written
 *   [g] disjoint-field-sets          — REASONED ∩ DERIVED === ∅
 *   [h] edge-field contract          — cites are read through `relation`, NOT
 *                                      `kind`/`type` (a mistyped filter would make
 *                                      the engine silently ground nothing)
 *   [i] draft-skipped-by-rederive    — WF-0089's `deriveField` skips a draft forever
 *   [j] authored/derived refused     — an existing claim, or human prose, declines
 *   [k] default-off + fallback       — shipped defaults, a missing generator, an
 *                                      unavailable ledger, and an absent graph each
 *                                      leave the skeleton untouched and never throw
 *
 * Exit 0 = all held; exit 1 = at least one failed. No wall-clock, no disk I/O.
 */
import {
  CONTENT_FILL_DEFAULTS,
  ENGINE_VERDICT_KEY,
  GROUNDED_CONTENT_SOURCE,
  fillGroundedContent,
} from './content-fill.mjs';
import {
  REASONED_FIELD_KEYS,
  evaluateEligibility,
  reasonedSentinels,
} from './content-eligibility.mjs';
import {
  citingSources,
  evaluateGrounding,
  numericLiteralsIn,
  retrieveExemplars,
  validateCitation,
} from './content-grounding.mjs';
import { DERIVED_FIELD_KEYS, deriveKpiSkeleton } from './projections.mjs';
import { deriveField, getFieldEntry } from './provenance.mjs';
import { validateProvenanceSidecar } from './schema-provenance-sidecar.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/**
 * Fixture graph: one ADR rationale node cited by one tooling file (the real
 * shape — in the live graph every cites-edge into an ADR originates from a
 * source file), plus an unrelated symbol used as the "exists but was not
 * retrieved" adversarial citation.
 */
function fixtureProjection() {
  return {
    available: true,
    nodes: [{ id: 'adr:0148' }, { id: 'file:tools/cites-it.mjs' }, { id: 'sym:unrelated#thing' }],
    edges: [{ source: 'file:tools/cites-it.mjs', target: 'adr:0148', relation: 'cites' }],
    layers: ['rationale'],
    signature: 'fixture-sig',
  };
}

const READY_LEDGER = Object.freeze({ available: true, sessionTokens: 10, priorSessionTokens: 100 });
const EXEMPLAR_BODIES = Object.freeze({
  'adr:0148': 'The methodology plane must govern itself; auto-fill is projection, not generation.',
});

/** A skeleton holding only unresolved placeholders — every field is eligible. */
function placeholderSkeleton() {
  return {
    fields: {
      'prd.problem': { contentKind: 'markdown', current: '{{PROBLEM}}' },
      'spec.summary': { contentKind: 'markdown', current: '{{SUMMARY}}' },
    },
  };
}

/** A live context with the engine explicitly switched ON (the shipped default is off). */
function activeContext(overrides = {}) {
  return {
    contextRef: 'BIZ-0006',
    title: 'Methodology plane integrity',
    sidecar: { schemaVersion: 1, contextRef: 'BIZ-0006', fields: {} },
    governingAdrIds: ['ADR-0148'],
    entrySymbols: [],
    graphSignature: 'fixture-sig',
    config: { enabled: true, tokenBudgetPerContext: 5000, promptVersion: 1 },
    ...overrides,
  };
}

/** A counting fake generator — the call count is what proves a refusal was free. */
function fakeGenerator(text, citations) {
  const calls = [];
  const generate = (request) => {
    calls.push(request);
    return { text, citations };
  };
  return { generate, calls };
}

// [a] grounded-only-or-token — a validated citation fills the field.
{
  const { generate, calls } = fakeGenerator('The governance plane cannot verify its own ceremony.', ['adr:0148']);
  const result = fillGroundedContent(activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, {
    generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  const verdict = result.fields['prd.problem'];
  assert('[a] a grounded field is filled', verdict?.action === 'fill', JSON.stringify(verdict));
  assert('[a] the filled text is returned', verdict?.text === 'The governance plane cannot verify its own ceremony.');
  assert('[a] the fill records its validated citation', verdict?.citations.join(',') === 'adr:0148', JSON.stringify(verdict?.citations));
  assert('[a] the generator was actually consulted', calls.length === 2, `calls=${calls.length}`);
}

// [b] ungrounded-left-as-token — nothing retrieved ⇒ refuse, and the generator is
// never called, so the refusal path costs zero tokens.
{
  const { generate, calls } = fakeGenerator('invented prose', ['adr:0148']);
  const context = activeContext({ governingAdrIds: [], entrySymbols: [] });
  const skeleton = placeholderSkeleton();
  const result = fillGroundedContent(context, skeleton, fixtureProjection(), READY_LEDGER, { generate });
  const verdict = result.fields['prd.problem'];
  assert('[b] an ungrounded field refuses', verdict?.action === 'refuse', JSON.stringify(verdict));
  assert('[b] the refusal names the empty retrieved set', verdict?.reason === 'empty-retrieved-set', verdict?.reason);
  assert('[b] no text is produced for a refused field', verdict?.text === null);
  assert('[b] the generator was NEVER called (zero tokens on the refusal path)', calls.length === 0, `calls=${calls.length}`);
  assert('[b] the sidecar is unchanged', Object.keys(result.provenance.fields).length === 0);
  assert('[b] the skeleton placeholder is untouched', skeleton.fields['prd.problem'].current === '{{PROBLEM}}');
}

// [c] hallucinated-citation-rejected — two flavors, both refuse.
{
  const nonexistent = fakeGenerator('prose', ['adr:9999']);
  const hallucinated = fillGroundedContent(activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, {
    generate: nonexistent.generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  assert('[c] a citation resolving to no node refuses',
    hallucinated.fields['prd.problem']?.action === 'refuse', JSON.stringify(hallucinated.fields['prd.problem']));

  const borrowed = fakeGenerator('prose', ['sym:unrelated#thing']);
  const outsideSet = fillGroundedContent(activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, {
    generate: borrowed.generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  assert('[c] a REAL node outside this field\'s retrieved set also refuses',
    outsideSet.fields['prd.problem']?.action === 'refuse', JSON.stringify(outsideSet.fields['prd.problem']));

  const projection = fixtureProjection();
  assert('[c] validateCitation names the hallucination',
    validateCitation({ citation: 'adr:9999', projection, retrievedSet: ['adr:0148'] }).reason.includes('hallucinated'));
  assert('[c] validateCitation rejects a malformed shape',
    validateCitation({ citation: 'not-an-id', projection, retrievedSet: ['adr:0148'] }).reason === 'citation-shape-rejected');
  assert('[c] validateCitation accepts a retrieved, existing node',
    validateCitation({ citation: 'adr:0148', projection, retrievedSet: ['adr:0148'] }).valid === true);
}

// [d] no-invented-numbers — a numeric literal absent from every exemplar body refuses.
{
  const { generate } = fakeGenerator('This reduces governance cost by 40% within 3 sprints.', ['adr:0148']);
  const result = fillGroundedContent(activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, {
    generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  const verdict = result.fields['prd.problem'];
  assert('[d] invented numbers refuse the field', verdict?.action === 'refuse', JSON.stringify(verdict));
  assert('[d] the refusal names the offending literals',
    verdict?.reason.startsWith('numeric-literal-not-in-exemplar'), verdict?.reason);
  assert('[d] numericLiteralsIn finds integers, decimals and percentages',
    numericLiteralsIn('40% over 1.5 years, 3 sprints').join(',') === '1.5,3,40',
    numericLiteralsIn('40% over 1.5 years, 3 sprints').join(','));
}

// [e] generated-is-draft — the sidecar entry shape, validated by the real validator.
{
  const { generate } = fakeGenerator('A grounded problem statement.', ['adr:0148', 'adr:0148']);
  const result = fillGroundedContent(activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, {
    generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  const entry = getFieldEntry(result.provenance, 'prd.problem');
  assert('[e] the entry state is draft (never authored, never derived)', entry.state === 'draft', JSON.stringify(entry));
  assert('[e] the source is llm:grounded-content', entry.source === GROUNDED_CONTENT_SOURCE, entry.source);
  assert('[e] citations are deduped', entry.citations.length === 1, JSON.stringify(entry.citations));
  assert('[e] the entry carries both hashes', Boolean(entry.inputHash) && Boolean(entry.contentHash));
  const verdict = validateProvenanceSidecar(result.provenance);
  assert('[e] the resulting sidecar passes the real validator', verdict.ok === true, JSON.stringify(verdict.errors));
  assert('[e] a draft with no citation is refused by the validator',
    validateProvenanceSidecar({
      schemaVersion: 1,
      contextRef: null,
      fields: { 'prd.problem': { state: 'draft', source: 'x', inputHash: 'y', contentHash: 'z', citations: [] } },
    }).ok === false);

  // Idempotence: identical exemplars + prompt version ⇒ identical inputHash ⇒ no reburn.
  const second = fillGroundedContent(activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, {
    generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  assert('[e] the inputHash is stable across runs (a re-run is a no-op, not a reburn)',
    getFieldEntry(second.provenance, 'prd.problem').inputHash === entry.inputHash);
}

// [f] targets-null-until-measured — no KPI/target/status write path exists at all.
{
  const { generate } = fakeGenerator('Grounded prose.', ['adr:0148']);
  const skeleton = placeholderSkeleton();
  // Offer the engine forbidden fields explicitly: it must ignore every one.
  skeleton.fields['kpi'] = { contentKind: 'json', current: '{{KPI}}' };
  skeleton.fields['risk.table'] = { contentKind: 'markdown', current: '{{MITIGATION}}' };
  skeleton.fields['acceptance.status'] = { contentKind: 'markdown', current: '{{STATUS}}' };
  const result = fillGroundedContent(activeContext(), skeleton, fixtureProjection(), READY_LEDGER, {
    generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  for (const forbidden of ['kpi', 'risk.table', 'acceptance.status']) {
    assert(`[f] "${forbidden}" is never written`, result.fields[forbidden] === undefined && result.provenance.fields[forbidden] === undefined);
  }
  assert('[f] deriveKpiSkeleton still reports baseline:null',
    deriveKpiSkeleton({ growthLever: 'QUALITY' }).value.kpis.every((kpi) => kpi.baseline === null));
}

// [g] disjoint-field-sets — the mechanical proof of GA0 §2, not a claim in a report.
{
  const overlap = REASONED_FIELD_KEYS.filter((key) => DERIVED_FIELD_KEYS.includes(key));
  assert('[g] REASONED ∩ DERIVED === ∅', overlap.length === 0, overlap.join(','));
  assert('[g] the reasoned set is closed at eight fields', REASONED_FIELD_KEYS.length === 8, String(REASONED_FIELD_KEYS.length));
  assert('[g] both sets are frozen', Object.isFrozen(REASONED_FIELD_KEYS) && Object.isFrozen(DERIVED_FIELD_KEYS));
}

// [h] edge-field contract — cites live on `relation`. A fixture using `kind`
// instead must yield NOTHING, which is what makes a mistyped filter a loud
// failure here rather than a silent empty candidate set in production.
{
  const projection = fixtureProjection();
  assert('[h] citingSources reads the `relation` field',
    citingSources(projection, 'adr:0148').join(',') === 'file:tools/cites-it.mjs',
    citingSources(projection, 'adr:0148').join(','));
  const mistyped = {
    available: true,
    nodes: [{ id: 'adr:0148' }, { id: 'file:tools/cites-it.mjs' }],
    edges: [{ source: 'file:tools/cites-it.mjs', target: 'adr:0148', kind: 'cites', type: 'cites' }],
  };
  assert('[h] an edge carrying only `kind`/`type` is NOT treated as a cite',
    citingSources(mistyped, 'adr:0148').length === 0);
  const retrieval = retrieveExemplars('prd.problem', { governingAdrIds: ['adr:0148'] }, projection);
  assert('[h] retrieval returns the ADR plus its citing source',
    retrieval.value.exemplars.join(',') === 'adr:0148,file:tools/cites-it.mjs', retrieval.value.exemplars.join(','));
  // GA0 risk R-B: an ADR node present in the graph but with no indexed body.
  const noBody = fillGroundedContent(activeContext(), placeholderSkeleton(), projection, READY_LEDGER, {
    generate: fakeGenerator('Cost fell 12 points.', ['adr:0148']).generate,
    exemplarBodies: {},
  });
  assert('[h] a retrieved ADR with no indexed body cannot ground a numeric claim',
    noBody.fields['prd.problem']?.action === 'refuse', JSON.stringify(noBody.fields['prd.problem']));
}

// [i] draft-skipped-by-rederive — WF-0089's engine must never touch a draft.
{
  const sidecar = {
    schemaVersion: 1,
    contextRef: null,
    fields: { 'prd.problem': { state: 'draft', source: GROUNDED_CONTENT_SOURCE, inputHash: 'a1', contentHash: 'b2', citations: ['adr:0148'] } },
  };
  let computed = false;
  const outcome = deriveField({
    sidecar,
    fieldKey: 'prd.problem',
    readContent: () => 'anything',
    compute: () => { computed = true; return { inputDomain: {}, source: 'x', value: 'y' }; },
    writeContent: () => {},
  });
  assert('[i] deriveField SKIPS a draft', outcome.action === 'skip', outcome.action);
  assert('[i] the skip reason names the draft lock', outcome.reason === 'draft-lock', outcome.reason);
  assert('[i] no projection is computed for a draft field', computed === false);
}

// [j] authored / derived / human prose all refuse.
{
  const sentinels = reasonedSentinels({ title: 'T' });
  assert('[j] an explicit authored claim refuses',
    evaluateEligibility({ fieldKey: 'prd.problem', current: '{{PROBLEM}}', entry: { state: 'authored' }, claimed: true, sentinels }).eligible === false);
  assert('[j] a derived claim refuses',
    evaluateEligibility({ fieldKey: 'prd.problem', current: '{{PROBLEM}}', entry: { state: 'derived' }, claimed: true, sentinels }).eligible === false);
  assert('[j] human prose in the field refuses even when unclaimed',
    evaluateEligibility({ fieldKey: 'prd.problem', current: 'A human wrote this by hand.', entry: { state: 'authored' }, claimed: false, sentinels }).eligible === false);
  assert('[j] the rendered scaffold sentinel IS eligible',
    evaluateEligibility({ fieldKey: 'prd.problem', current: sentinels.PROBLEM, entry: { state: 'authored' }, claimed: false, sentinels }).eligible === true);
  assert('[j] an unresolved placeholder is eligible',
    evaluateEligibility({ fieldKey: 'spec.tradeoffs', current: '{{TRADEOFFS}}', entry: { state: 'authored' }, claimed: false, sentinels }).eligible === true);
  assert('[j] a field outside the reasoned set is refused by construction',
    evaluateEligibility({ fieldKey: 'spec.scope', current: '{{SCOPE}}', entry: { state: 'authored' }, claimed: false, sentinels }).reason === 'field-not-in-reasoned-set');
}

// [k] default-off and rail (d) fallback — four independent off-switches, one
// observable outcome: nothing written, nothing thrown, skeleton intact.
{
  assert('[k] the shipped defaults are off twice over',
    CONTENT_FILL_DEFAULTS.enabled === false && CONTENT_FILL_DEFAULTS.tokenBudgetPerContext === 0);

  const cases = [
    ['shipped default config', activeContext({ config: { ...CONTENT_FILL_DEFAULTS } }), fixtureProjection(), READY_LEDGER, {}],
    ['zero token budget', activeContext({ config: { enabled: true, tokenBudgetPerContext: 0 } }), fixtureProjection(), READY_LEDGER, { generate: () => ({ text: 't', citations: ['adr:0148'] }) }],
    ['no generator injected', activeContext(), fixtureProjection(), READY_LEDGER, {}],
    ['unavailable ledger', activeContext(), fixtureProjection(), { available: false, reason: 'no economy events' }, { generate: () => ({ text: 't', citations: ['adr:0148'] }) }],
    ['absent graph', activeContext(), { available: false, reason: 'no committed graph projection' }, READY_LEDGER, { generate: () => ({ text: 't', citations: ['adr:0148'] }) }],
    ['tripped kill-switch', activeContext(), fixtureProjection(), READY_LEDGER, { generate: () => ({ text: 't', citations: ['adr:0148'] }), killSwitch: () => ({ enabled: false, reason: 'governance-tokens/session rising' }) }],
  ];
  for (const [label, context, graph, ledger, deps] of cases) {
    const skeleton = placeholderSkeleton();
    let result;
    let threw = null;
    try {
      result = fillGroundedContent(context, skeleton, graph, ledger, deps);
    } catch (err) {
      threw = err;
    }
    assert(`[k] ${label}: never throws`, threw === null, String(threw));
    assert(`[k] ${label}: writes no field`, Object.keys(result?.fields ?? {}).join(',') === ENGINE_VERDICT_KEY);
    assert(`[k] ${label}: records a named reason`, typeof result?.fields[ENGINE_VERDICT_KEY]?.reason === 'string' && result.fields[ENGINE_VERDICT_KEY].reason.length > 0);
    assert(`[k] ${label}: leaves the sidecar untouched`, Object.keys(result?.provenance?.fields ?? {}).length === 0);
    assert(`[k] ${label}: leaves the placeholder intact`, skeleton.fields['prd.problem'].current === '{{PROBLEM}}');
  }

  // An engine-level verdict key can never be mistaken for a field.
  assert('[k] the engine verdict key is outside the reasoned set', !REASONED_FIELD_KEYS.includes(ENGINE_VERDICT_KEY));

  // Hostile/degenerate input: still no throw (the engine never blocks a caller).
  for (const [label, args] of [
    ['null everything', [null, null, null, null]],
    ['empty objects', [{}, {}, {}, {}]],
    ['throwing generator', [activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, { generate: () => { throw new Error('model down'); } }]],
    ['malformed generator output', [activeContext(), placeholderSkeleton(), fixtureProjection(), READY_LEDGER, { generate: () => 42 }]],
  ]) {
    let threw = null;
    try {
      fillGroundedContent(...args);
    } catch (err) {
      threw = err;
    }
    assert(`[k] ${label}: degrades instead of throwing`, threw === null, String(threw));
  }
}

// [qa] GA3-T2 adversarial regressions — each of these was a REAL hole an
// independent QA pass found and this suite did not catch. They are kept as
// named cases so a future refactor cannot quietly reopen them.
{
  const graph = fixtureProjection();
  const bodies = { 'adr:0148': 'improved by 40 percent across 12 contexts. Budget 1,000 tokens.' };
  const groundedOnce = (text) => evaluateGrounding({
    text, citations: ['adr:0148'], projection: graph, retrievedSet: ['adr:0148'], exemplarBodies: bodies,
  }).grounded;

  // F1 — a target written in WORDS is a target. A model asked for prose writes
  // "ninety-nine percent" as readily as "99%", so this is the likely form.
  assert('[qa] F1 a spelled-out number absent from the exemplar refuses', groundedOnce('Reduces cost by ninety-nine percent.') === false);
  assert('[qa] F1 a spelled-out number PRESENT in the exemplar is allowed', groundedOnce('Reduces cost by forty percent.') === true);
  assert('[qa] F1 a non-ASCII digit is folded, not smuggled past',
    groundedOnce('４０ percent better.') === true && groundedOnce('９９ percent better.') === false);

  // F2 — substring containment licensed `4` because the exemplar said `40`.
  assert('[qa] F2 a digit-substring of an exemplar number refuses', groundedOnce('Reduces cost by 4 percent.') === false);
  assert('[qa] F2 a zero borrowed from "1,000" refuses', groundedOnce('Cut by 0 percent.') === false);
  assert('[qa] F2 a thousands-separated number matches its unseparated form', groundedOnce('Budget 1000 tokens.') === true);
  assert('[qa] F2 a real exemplar number still passes', groundedOnce('Improved by 40 percent across 12 contexts.') === true);

  // F9 — exported validators on the anti-hallucination path must REFUSE junk,
  // never throw: a crash is a worse failure mode than a refusal.
  for (const [label, retrievedSet] of [['an object', { a: 1 }], ['a number', 42], ['null', null]]) {
    let threw = null;
    let verdict = null;
    try {
      verdict = validateCitation({ citation: 'adr:0148', projection: graph, retrievedSet });
    } catch (err) {
      threw = err;
    }
    assert(`[qa] F9 a non-iterable retrievedSet (${label}) refuses instead of throwing`, threw === null && verdict?.valid === false, String(threw));
  }

  // F6 — the §13 guardrail floor must be STRUCTURAL. Before the fix, a rising
  // ledger filled the field whenever `deps.killSwitch` was simply not injected,
  // so a wiring step that forgot one line shipped an ungoverned engine.
  const rising = fillGroundedContent(activeContext(), placeholderSkeleton(), graph, { available: true, sessionTokens: 200, priorSessionTokens: 100 }, {
    generate: fakeGenerator('grounded prose', ['adr:0148']).generate,
    exemplarBodies: EXEMPLAR_BODIES,
  });
  assert('[qa] F6 a rising ledger refuses even with NO kill-switch injected (guardrail floor)',
    rising.fields['prd.problem'] === undefined && Object.keys(rising.fields).join(',') === ENGINE_VERDICT_KEY,
    JSON.stringify(rising.fields));
  assert('[qa] F6 the floor names the regression', rising.fields[ENGINE_VERDICT_KEY].reason.includes('rising'), rising.fields[ENGINE_VERDICT_KEY].reason);

  // F4 — `available:true` is not the same as trustworthy. Coercing would read a
  // MISSING measurement (`Number(null) === 0`) as "measured zero spend".
  for (const unusable of [null, undefined, NaN, -5, '100', {}]) {
    const outcome = fillGroundedContent(activeContext(), placeholderSkeleton(), graph, { available: true, sessionTokens: unusable, priorSessionTokens: 1 }, {
      generate: fakeGenerator('grounded prose', ['adr:0148']).generate,
      exemplarBodies: EXEMPLAR_BODIES,
    });
    assert(`[qa] F4 an unusable measurement (${JSON.stringify(unusable)}) never authorizes spend`,
      outcome.fields['prd.problem'] === undefined, JSON.stringify(outcome.fields));
  }

  // F5 — the kill-switch interprets an externally-read ledger, so it is the most
  // plausible thing here to fail at runtime. The generator was wrapped; it was not.
  let killSwitchThrew = null;
  let guarded = null;
  try {
    guarded = fillGroundedContent(activeContext(), placeholderSkeleton(), graph, READY_LEDGER, {
      generate: fakeGenerator('grounded prose', ['adr:0148']).generate,
      exemplarBodies: EXEMPLAR_BODIES,
      killSwitch: () => { throw new Error('guardrail exploded'); },
    });
  } catch (err) {
    killSwitchThrew = err;
  }
  assert('[qa] F5 a throwing kill-switch lands in rail (d) instead of escaping', killSwitchThrew === null, String(killSwitchThrew));
  assert('[qa] F5 a throwing kill-switch writes nothing', Object.keys(guarded?.fields ?? {}).join(',') === ENGINE_VERDICT_KEY);
}

process.stdout.write(failures.length === 0 ? '\nPASSED\n' : `\nFAILED (${failures.length})\n`);
process.exit(failures.length === 0 ? 0 : 1);
