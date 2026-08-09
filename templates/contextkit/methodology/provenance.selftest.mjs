/**
 * In-process self-test for the WF-0089 SA2 provenance sidecar + idempotent
 * re-derive engine (`provenance.mjs` + `schema-provenance-sidecar.mjs`,
 * BIZ-0006, ADR-0148 §9). Uses a tmp fixture directory (never the real repo
 * graph or a real work context) so the suite stays deterministic and fast.
 *
 * Proves the six SA2 acceptance points named in the wave contract:
 *   [a] every filled field carries a provenance tag (derived entries stamp
 *       source+inputHash+contentHash; nothing is claimed silently)
 *   [b] re-derive on unchanged input is a no-op — no field write, no sidecar
 *       write (the idempotency law the SA3 receipt depends on)
 *   [c] editing a derived field's content flips it to authored; re-derive
 *       then skips it forever (promote-on-edit is one-way)
 *   [d] single-authority invariant — the validator rejects a mixed entry
 *       (authored carrying leftover derived keys, or derived missing one)
 *   [e] an unclaimed field defaults to authored (never silently re-derived)
 *   [f] a graph that legitimately changed (new signature) re-derives WITHOUT
 *       being mistaken for a human edit (content-hash-first disambiguator)
 *   [g] the four input-domain builders not otherwise exercised above
 *       (inputDomainForRisk/Classification/Scaffold/StateProjection) each
 *       produce a correctly-shaped, deterministic domain object AND a stable
 *       inputHash across repeated calls (SA3-T2 QA should-fix, immutable
 *       rule 3 — this is what the whole re-derive no-op contract rests on)
 *
 * Exit 0 = all held; exit 1 = at least one failed. No wall-clock dependency
 * beyond a fixed literal timestamp; every fixture lives under a tmp dir.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveField,
  deriveFieldFromEnvelope,
  fieldAuthority,
  hashInputDomain,
  inputDomainForClassification,
  inputDomainForRisk,
  inputDomainForScaffold,
  inputDomainForScope,
  inputDomainForStateProjection,
  readSidecar,
  setFieldEntry,
  stampDerivedEntry,
  writeSidecar,
} from './provenance.mjs';
import { validateProvenanceSidecar } from './schema-provenance-sidecar.mjs';
import { deriveClassification, deriveRisk, deriveScope } from './projections.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

const workDir = mkdtempSync(join(tmpdir(), 'wf0089-provenance-'));

/** Same fixture shape as `projections.selftest.mjs` (seed called by a/b, imports file:x, calls downstream). */
function fixtureProjection(signature = 'fixture-sig') {
  const nodes = [{ id: 'sym:seed' }, { id: 'sym:downstream' }, { id: 'sym:a' }, { id: 'sym:b' }, { id: 'file:x' }];
  const edges = [
    { source: 'sym:a', target: 'sym:seed', relation: 'calls' },
    { source: 'sym:b', target: 'sym:seed', relation: 'calls' },
    { source: 'file:x', target: 'sym:seed', relation: 'imports' },
    { source: 'sym:seed', target: 'sym:downstream', relation: 'calls' },
  ];
  return { available: true, nodes, edges, layers: [], signature };
}

/** A bigger fixture (one extra caller of `sym:seed`) — simulates a legitimate graph growth. */
function grownProjection(signature = 'fixture-sig-v2') {
  const base = fixtureProjection(signature);
  return {
    ...base,
    nodes: [...base.nodes, { id: 'sym:c' }],
    edges: [...base.edges, { source: 'sym:c', target: 'sym:seed', relation: 'calls' }],
  };
}

/**
 * Performs the CREATION-TIME initial stamp: writes the field content and
 * stamps its FIRST `derived` entry directly, bypassing `deriveField`'s
 * single-authority check. This mirrors `stampWorkflowTasksProvenance` (and the
 * shape-creation wiring in `workflow/create.mjs`): a fresh field has no
 * pre-existing (human) content to protect, so the initial claim is not a
 * `deriveField` decision — it is the scaffold asserting authorship for the
 * first time. Every subsequent run goes through `deriveField`, which then
 * enforces the single-authority / promote-on-edit contract on THIS entry.
 */
function primeInitialDerivedField(sidecar, fieldKey, envelope, inputDomain, content) {
  const inputHash = hashInputDomain(inputDomain);
  const entry = stampDerivedEntry({ source: envelope.source, inputHash, newContent: content });
  return setFieldEntry(sidecar, fieldKey, entry);
}

try {
  // [a] a fresh sidecar has no entries; the creation-time initial stamp
  // records a full derived entry (source + inputHash + contentHash all present).
  {
    const envelope = deriveScope(['sym:seed'], fixtureProjection(), 40);
    const inputDomain = inputDomainForScope(envelope, fixtureProjection().signature);
    const content = envelope.value;
    let sidecar = primeInitialDerivedField(readSidecar(workDir, 'WF-0089'), 'spec.scope', envelope, inputDomain, content);
    const { entry, claimed } = fieldAuthority(sidecar, 'spec.scope');
    assert('[a] the initial stamp claims the field (not left unclaimed)', claimed === true);
    assert('[a] the initial stamp records state:derived', entry.state === 'derived', JSON.stringify(entry));
    assert('[a] the initial stamp records a non-empty source/inputHash/contentHash', [entry.source, entry.inputHash, entry.contentHash].every((v) => typeof v === 'string' && v.length > 0), JSON.stringify(entry));
    writeSidecar(workDir, sidecar);
    const roundTripped = readSidecar(workDir, 'WF-0089');
    assert('[a] the sidecar round-trips from disk', roundTripped.fields['spec.scope']?.state === 'derived');
  }

  // [b] re-derive on UNCHANGED input is a no-op: no field write, no sidecar write.
  {
    const envelope = deriveScope(['sym:seed'], fixtureProjection(), 40);
    const inputDomain = inputDomainForScope(envelope, fixtureProjection().signature);
    const content = envelope.value;
    const sidecar = primeInitialDerivedField(readSidecar(workDir, 'WF-0089'), 'spec.scope-b', envelope, inputDomain, content);
    let writeCount = 0;
    const before = JSON.stringify(sidecar);
    // Exercises the envelope-based convenience wrapper (the shape callers holding
    // an already-computed SA1 envelope actually use, e.g. `stampWorkflowTasksProvenance`).
    const result = deriveFieldFromEnvelope({
      sidecar,
      fieldKey: 'spec.scope-b',
      envelope,
      inputDomain,
      readContent: () => content,
      writeContent: () => { writeCount += 1; },
    });
    assert('[b] re-derive on unchanged input is a no-op', result.action === 'noop', result.reason);
    assert('[b] no field write occurred', writeCount === 0);
    assert('[b] the sidecar object is unchanged (same reference or byte-identical)', JSON.stringify(result.sidecar) === before);
  }

  // [c] editing a derived field's content flips it to authored; re-derive then skips forever.
  {
    const envelope = deriveScope(['sym:seed'], fixtureProjection(), 40);
    const inputDomain = inputDomainForScope(envelope, fixtureProjection().signature);
    let content = envelope.value;
    let sidecar = primeInitialDerivedField(readSidecar(workDir, 'WF-0089'), 'spec.scope2', envelope, inputDomain, content);
    // Simulate an out-of-band human edit: mutate content WITHOUT going through the engine.
    content = { ...content, humanEdited: true };
    const editResult = deriveField({
      sidecar,
      fieldKey: 'spec.scope2',
      readContent: () => content,
      compute: () => ({ inputDomain, source: envelope.source, value: envelope.value }),
      writeContent: () => { throw new Error('must not write on a promote'); },
    });
    assert('[c] a content-hash mismatch promotes to authored', editResult.action === 'promote', editResult.reason);
    sidecar = editResult.sidecar;
    assert('[c] the promoted entry is a bare {state:authored}', JSON.stringify(sidecar.fields['spec.scope2']) === JSON.stringify({ state: 'authored' }));
    // Re-derive again (even with a DIFFERENT input) — must skip forever, one-way.
    const laterEnvelope = deriveScope(['sym:seed', 'sym:downstream'], fixtureProjection(), 40);
    const laterResult = deriveField({
      sidecar,
      fieldKey: 'spec.scope2',
      readContent: () => content,
      compute: () => ({ inputDomain: inputDomainForScope(laterEnvelope, fixtureProjection().signature), source: laterEnvelope.source, value: laterEnvelope.value }),
      writeContent: () => { throw new Error('must not write after promotion'); },
    });
    assert('[c] once authored, re-derive skips unconditionally (promote-on-edit is one-way)', laterResult.action === 'skip', laterResult.reason);
  }

  // [d] single-authority invariant — validator rejects a mixed entry.
  {
    const mixedAuthoredWithSource = { schemaVersion: 1, contextRef: 'WF-0089', fields: { 'spec.scope': { state: 'authored', source: 'biz0004:fwd-reach' } } };
    const mixedVerdict1 = validateProvenanceSidecar(mixedAuthoredWithSource);
    assert('[d] authored entry carrying a leftover source is rejected', mixedVerdict1.ok === false && mixedVerdict1.errors.length > 0);

    const incompleteDerived = { schemaVersion: 1, contextRef: 'WF-0089', fields: { 'spec.scope': { state: 'derived', source: 'biz0004:fwd-reach', inputHash: 'abc123' } } };
    const mixedVerdict2 = validateProvenanceSidecar(incompleteDerived);
    assert('[d] derived entry missing contentHash is rejected', mixedVerdict2.ok === false && mixedVerdict2.errors.some((e) => e.includes('contentHash')));

    const validAuthored = { schemaVersion: 1, contextRef: 'WF-0089', fields: { 'spec.scope': { state: 'authored' } } };
    assert('[d] a bare authored entry validates clean', validateProvenanceSidecar(validAuthored).ok === true);
    const validDerived = { schemaVersion: 1, contextRef: 'WF-0089', fields: { 'spec.scope': stampDerivedEntry({ source: 'biz0004:fwd-reach', inputHash: 'abc123', newContent: { x: 1 } }) } };
    assert('[d] a complete derived entry validates clean', validateProvenanceSidecar(validDerived).ok === true);

    // A refused sidecar never reaches disk — writeSidecar throws before writing.
    let threw = false;
    try { writeSidecar(workDir, mixedAuthoredWithSource); } catch { threw = true; }
    assert('[d] writeSidecar refuses to persist an invalid (mixed) sidecar', threw === true);
  }

  // [e] an unclaimed field defaults to authored — never silently re-derived.
  {
    const sidecar = readSidecar(workDir, 'WF-0089');
    const { entry, claimed } = fieldAuthority(sidecar, 'risk.table');
    assert('[e] an unclaimed field key is NOT claimed in the sidecar', claimed === false);
    assert('[e] an unclaimed field defaults to state:authored', entry.state === 'authored');
    let computeCalled = false;
    const result = deriveField({
      sidecar,
      fieldKey: 'risk.table',
      readContent: () => { throw new Error('must not read content for an unclaimed/authored field'); },
      compute: () => { computeCalled = true; return { inputDomain: {}, source: 'x', value: null }; },
      writeContent: () => { throw new Error('must not write an unclaimed/authored field'); },
    });
    assert('[e] deriveField skips an unclaimed field without ever calling compute()', result.action === 'skip' && computeCalled === false, result.reason);
  }

  // [f] a legitimately-changed graph (new signature) re-derives WITHOUT being
  // mistaken for a human edit — content-hash-first disambiguator.
  {
    const envelope1 = deriveScope(['sym:seed'], fixtureProjection('sig-v1'), 40);
    const inputDomain1 = inputDomainForScope(envelope1, 'sig-v1');
    let content = envelope1.value;
    let sidecar = primeInitialDerivedField(readSidecar(workDir, 'WF-0089'), 'spec.scope3', envelope1, inputDomain1, content);
    assert('[f] setup: the initial stamp on sig-v1 records a derived entry', sidecar.fields['spec.scope3']?.state === 'derived');

    // The graph legitimately grows: new signature, new consumer sym:c.
    const envelope2 = deriveScope(['sym:seed'], grownProjection('sig-v2'), 40);
    const inputDomain2 = inputDomainForScope(envelope2, 'sig-v2');
    assert('[f] a grown graph produces a DIFFERENT input hash', hashInputDomain(inputDomain2) !== hashInputDomain(inputDomain1));
    let rederiveWriteCount = 0;
    const second = deriveField({
      sidecar,
      fieldKey: 'spec.scope3',
      readContent: () => content, // content on disk is EXACTLY what was written last (no human edit)
      compute: () => ({ inputDomain: inputDomain2, source: envelope2.source, value: envelope2.value }),
      writeContent: (value) => { content = value; rederiveWriteCount += 1; },
    });
    assert('[f] a legitimate graph change re-derives (not a false promote)', second.action === 'rederive', second.reason);
    assert('[f] the re-derive actually wrote the new value', rederiveWriteCount === 1 && content.nodes.includes('sym:c'));
    sidecar = second.sidecar;

    // And immediately after, re-running with the SAME (grown) input is a no-op.
    const third = deriveField({
      sidecar,
      fieldKey: 'spec.scope3',
      readContent: () => content,
      compute: () => ({ inputDomain: inputDomain2, source: envelope2.source, value: envelope2.value }),
      writeContent: () => { throw new Error('must not write again — idempotent'); },
    });
    assert('[f] re-running the grown-graph derive again is idempotent (no-op)', third.action === 'noop', third.reason);
  }

  // [g] the four otherwise-unexercised input-domain builders: each produces a
  // correctly-shaped, deterministic domain object AND a stable inputHash
  // across repeated calls (SA3-T2 should-fix).
  {
    // inputDomainForRisk — folds a deriveRisk envelope + a graph signature.
    const riskEnvelope = deriveRisk(['sym:seed'], fixtureProjection('sig-risk'));
    const riskDomainOnce = inputDomainForRisk(riskEnvelope, 'sig-risk');
    const riskDomainTwice = inputDomainForRisk(riskEnvelope, 'sig-risk');
    assert('[g] inputDomainForRisk is shaped {source, graphSignature, targetSymbols}',
      riskDomainOnce.source === 'biz0004:rev-consumers' && riskDomainOnce.graphSignature === 'sig-risk' && Array.isArray(riskDomainOnce.targetSymbols),
      JSON.stringify(riskDomainOnce));
    assert('[g] inputDomainForRisk is deterministic (deep-equal on repeated calls)',
      JSON.stringify(riskDomainOnce) === JSON.stringify(riskDomainTwice));
    assert('[g] inputDomainForRisk inputHash is stable across runs',
      hashInputDomain(riskDomainOnce) === hashInputDomain(riskDomainTwice));

    // inputDomainForClassification — folds a deriveClassification envelope + a policy hash.
    const classificationEnvelope = deriveClassification('fix the broken updater rollback');
    const classificationDomainOnce = inputDomainForClassification(classificationEnvelope, 'policy-hash-v1');
    const classificationDomainTwice = inputDomainForClassification(classificationEnvelope, 'policy-hash-v1');
    assert('[g] inputDomainForClassification is shaped {source, objectiveHash, policyHash}',
      classificationDomainOnce.source === 'work-classifier' && typeof classificationDomainOnce.objectiveHash === 'string' && classificationDomainOnce.objectiveHash.length === 64 && classificationDomainOnce.policyHash === 'policy-hash-v1',
      JSON.stringify(classificationDomainOnce));
    assert('[g] inputDomainForClassification is deterministic (deep-equal on repeated calls)',
      JSON.stringify(classificationDomainOnce) === JSON.stringify(classificationDomainTwice));
    assert('[g] inputDomainForClassification inputHash is stable across runs',
      hashInputDomain(classificationDomainOnce) === hashInputDomain(classificationDomainTwice));
    // A different objective text must produce a different objectiveHash (the
    // domain actually depends on its input, not a constant).
    const differentObjective = inputDomainForClassification(deriveClassification('add a new dashboard widget'), 'policy-hash-v1');
    assert('[g] inputDomainForClassification varies with the objective text',
      differentObjective.objectiveHash !== classificationDomainOnce.objectiveHash);

    // inputDomainForScaffold — derive-once shape (immutable ⇒ permanent no-op after first write).
    const scaffoldArgs = { contextRef: 'WF-0089', resolvedAxes: { shape: 'multi-workflow-program' }, ceremonyShape: 'multi-workflow-program', manifestSchemaVersion: 1 };
    const scaffoldDomainOnce = inputDomainForScaffold(scaffoldArgs);
    const scaffoldDomainTwice = inputDomainForScaffold(scaffoldArgs);
    assert('[g] inputDomainForScaffold is shaped {source:"scaffold", contextRef, resolvedAxes, ceremonyShape, manifestSchemaVersion}',
      scaffoldDomainOnce.source === 'scaffold' && scaffoldDomainOnce.contextRef === 'WF-0089' && scaffoldDomainOnce.ceremonyShape === 'multi-workflow-program' && scaffoldDomainOnce.manifestSchemaVersion === 1,
      JSON.stringify(scaffoldDomainOnce));
    assert('[g] inputDomainForScaffold is deterministic (deep-equal on repeated calls)',
      JSON.stringify(scaffoldDomainOnce) === JSON.stringify(scaffoldDomainTwice));
    assert('[g] inputDomainForScaffold inputHash is stable across runs',
      hashInputDomain(scaffoldDomainOnce) === hashInputDomain(scaffoldDomainTwice));

    // inputDomainForStateProjection — derive-and-refresh live journal value.
    const stateArgs = { overallStatus: 'in-progress', journeyPhase: 'spec' };
    const stateDomainOnce = inputDomainForStateProjection(stateArgs);
    const stateDomainTwice = inputDomainForStateProjection(stateArgs);
    assert('[g] inputDomainForStateProjection is shaped {source:"scaffold:state-projection", overallStatus, journeyPhase}',
      stateDomainOnce.source === 'scaffold:state-projection' && stateDomainOnce.overallStatus === 'in-progress' && stateDomainOnce.journeyPhase === 'spec',
      JSON.stringify(stateDomainOnce));
    assert('[g] inputDomainForStateProjection is deterministic (deep-equal on repeated calls)',
      JSON.stringify(stateDomainOnce) === JSON.stringify(stateDomainTwice));
    assert('[g] inputDomainForStateProjection inputHash is stable across runs',
      hashInputDomain(stateDomainOnce) === hashInputDomain(stateDomainTwice));
    // A changed journeyPhase must produce a different inputHash — this is what
    // the derive-and-refresh contract (re-derive when the journal moves) rests on.
    const advancedState = inputDomainForStateProjection({ overallStatus: 'in-progress', journeyPhase: 'adr' });
    assert('[g] inputDomainForStateProjection inputHash changes when journeyPhase advances',
      hashInputDomain(advancedState) !== hashInputDomain(stateDomainOnce));
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
