/**
 * Self-check suite for WF-0066 — Domain Artifacts & Task Compiler
 * (ADR-0128 §13/§21/§22). Validates the invariants the kit must never
 * regress: the five artifact schemas validate/reject correctly, proportionality
 * holds (simple never gets a domain-map or aggregate; domain-driven+ requires
 * one), the Implementation Packet compiler and Implementation Receipt
 * comparator round-trip deterministically and detect planned-vs-actual
 * deviations, the Task Compiler recipe resolution is deterministic and
 * profile-scoped, and governed scaffolds refuse without a satisfied contract
 * and never invent a business rule. Wired into `tools/selfcheck.mjs`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RT = 'templates/contextkit/runtime/domain-artifacts';

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runDomainArtifactsChecks({ ok, bad }, { KIT }) {
  console.log('Checking WF-0066 domain artifacts & task compiler...');
  const imp = async (rel) => import(pathToFileURL(resolve(KIT, RT, rel)).href);
  const TPL = resolve(KIT, 'templates');

  let da;
  try {
    da = await imp('index.mjs');
    ok('domain-artifacts modules import cleanly');
  } catch (err) {
    bad(`domain-artifacts import failed: ${err?.message ?? err}`);
    return;
  }

  // -- Policy bundle well-formedness -----------------------------------------
  const bundle = da.loadDomainArtifactsPolicyBundle(TPL);
  bundle && !bundle.degraded ? ok('domain-artifacts policy bundle loads (not degraded)') : bad(`bundle degraded: ${bundle?.missing}`);

  const EXPECTED_ARTIFACTS = ['domain-map', 'aggregate', 'use-case', 'implementation-packet', 'implementation-receipt'];
  const artifactIds = Object.keys(bundle.artifactSchemas?.artifacts ?? {});
  EXPECTED_ARTIFACTS.every((a) => artifactIds.includes(a)) && artifactIds.length === EXPECTED_ARTIFACTS.length
    ? ok('artifact-schemas carries exactly the five §13 artifacts') : bad(`artifact-schemas mismatch: ${artifactIds}`);

  const EXPECTED_RECIPES = ['domain-implementation', 'implementation-simple', 'implementation-modular', 'implementation-domain-driven', 'implementation-distributed-domain'];
  const recipeIds = Object.keys(bundle.recipeContracts?.recipes ?? {});
  EXPECTED_RECIPES.every((r) => recipeIds.includes(r)) && recipeIds.length === EXPECTED_RECIPES.length
    ? ok('recipe-contracts carries the entry recipe + four profile recipes (§21)') : bad(`recipe-contracts mismatch: ${recipeIds}`);

  const EXPECTED_SCAFFOLDS = ['aggregate-root', 'value-object', 'domain-event', 'command', 'query', 'handler', 'repository-port', 'infrastructure-adapter', 'contract-test', 'domain-test', 'application-test'];
  const scaffoldIds = Object.keys(bundle.scaffoldContracts?.scaffolds ?? {});
  EXPECTED_SCAFFOLDS.every((s) => scaffoldIds.includes(s)) && scaffoldIds.length === EXPECTED_SCAFFOLDS.length
    ? ok('scaffold-contracts carries the eleven §22 governed scaffolds') : bad(`scaffold-contracts mismatch: ${scaffoldIds}`);

  // -- Degraded policy table ⇒ recorded receipt, never a false pass ----------
  const noTable = da.validateArtifact('implementation-packet', {}, null);
  noTable.valid === false && noTable.reasonCode === 'ARTIFACTS_POLICY_DEGRADED'
    ? ok('missing artifact-schemas table ⇒ degraded validation (never a false pass)') : bad('degraded validate path is a false pass');
  const unknownKind = da.validateArtifact('bogus-kind', {}, bundle.artifactSchemas);
  unknownKind.valid === false && unknownKind.reasonCode === 'ARTIFACT_UNKNOWN_KIND'
    ? ok('unknown artifact kind ⇒ refused, not fabricated') : bad('unknown kind wrongly validated');

  // -- Schema validators: each artifact accepts a complete doc, rejects a partial one --
  const FIXTURES = {
    'domain-map': { owner: 'WF-0066', contexts: [{ name: 'billing', responsibilities: [], ownedStates: [], publicContracts: [], allowedDependencies: [], forbiddenDependencies: [] }], crossContextRelations: [] },
    aggregate: { owner: 'WF-0066', root: 'Invoice', entities: [], valueObjects: [], invariants: [], commands: [], events: [], consistency: 'strong' },
    'use-case': { owner: 'WF-0066', actor: 'user', input: {}, preconditions: [], invariants: [], output: {}, errors: [], transaction: 'single', effects: [], acceptance: [] },
    'implementation-packet': { owner: 'WF-0066', classification: { cmis: 80, das: 10, profile: 'simple' }, sources: {}, requiredAgents: [], requiredSkills: [], allowedPaths: [], forbiddenPaths: [], contractsToPreserve: [], invariants: [], steps: [], requiredTests: [], requiredEvidence: [] },
    'implementation-receipt': { packetId: 'p1', owner: 'WF-0066', agentsPlanned: [], agentsActual: [], skillsPlanned: [], skillsActual: [], filesPlanned: [], filesTouched: [], filesNew: [], contractsChanged: [], deviations: [], testsRun: [], gatesRun: [], result: 'success' },
  };
  for (const [kind, doc] of Object.entries(FIXTURES)) {
    const result = da.validateArtifact(kind, doc, bundle.artifactSchemas);
    result.valid === true && result.reasonCode === 'ARTIFACT_SCHEMA_VALID'
      ? ok(`${kind} schema accepts a complete document`) : bad(`${kind} schema wrongly rejected: ${result.errors}`);
    const partial = { ...doc };
    delete partial[Object.keys(doc)[0]];
    const rejected = da.validateArtifact(kind, partial, bundle.artifactSchemas);
    rejected.valid === false && rejected.reasonCode === 'ARTIFACT_SCHEMA_INVALID'
      ? ok(`${kind} schema rejects a document missing a required field`) : bad(`${kind} schema wrongly accepted a partial document`);
  }

  // -- Proportionality guarantee (§31) ---------------------------------------
  const propSimple = da.checkProportionality('domain-map', 'simple', bundle.artifactSchemas);
  propSimple.status === 'forbidden' && propSimple.reasonCode === 'ARTIFACT_NEVER_FOR_PROFILE'
    ? ok('simple profile is FORBIDDEN from generating a domain-map') : bad(`simple domain-map guard wrong: ${JSON.stringify(propSimple)}`);
  const propSimpleAgg = da.checkProportionality('aggregate', 'simple', bundle.artifactSchemas);
  propSimpleAgg.status === 'forbidden' ? ok('simple profile is FORBIDDEN from generating an aggregate') : bad('simple aggregate guard wrong');
  const propDD = da.checkProportionality('domain-map', 'domain-driven', bundle.artifactSchemas);
  propDD.status === 'required' && propDD.reasonCode === 'ARTIFACT_REQUIRED_FOR_PROFILE'
    ? ok('domain-driven profile REQUIRES a domain-map') : bad('domain-driven domain-map guard wrong');
  const propPacketNoCode = da.checkProportionality('implementation-packet', 'no-code', bundle.artifactSchemas);
  propPacketNoCode.status === 'forbidden' ? ok('no-code profile never gets an implementation-packet') : bad('no-code packet guard wrong');
  const propPacketSimple = da.checkProportionality('implementation-packet', 'simple', bundle.artifactSchemas);
  propPacketSimple.status === 'required' ? ok('simple profile REQUIRES an implementation-packet (every code mutation)') : bad('simple packet guard wrong');

  // -- Packet compiler --------------------------------------------------------
  const classification = {
    codeMutationIntentScore: 80, domainApplicabilityScore: 10, profile: 'simple',
    requiredAgents: ['implementation-engineer'], requiredSkills: ['senior-implementation'], reasonCodes: [],
  };
  const packet = da.compileImplementationPacket('WF-0066', classification, { workflow: 'WF-0066' }, {
    allowedPaths: ['templates/contextkit/runtime/domain-artifacts/**'],
    forbiddenPaths: ['contextkit/memory/**'],
    contractsToPreserve: ['domain-artifacts/index.mjs'],
    packetId: 'packet-selfcheck', at: '2026-07-02T00:00:00.000Z',
  });
  packet.owner === 'WF-0066' && packet.classification.profile === 'simple' && packet.requiredAgents.includes('implementation-engineer')
    ? ok('packet compiles owner/classification/requiredAgents from the injected classification') : bad('packet compile wrong');
  packet.reasonCodes.includes('PACKET_COMPILED') && packet.degraded === false
    ? ok('healthy packet compile is not degraded and records PACKET_COMPILED') : bad('packet compile reason codes wrong');
  const missingSource = da.compileImplementationPacket('WF-0066', classification, {}, { packetId: 'p2', at: '2026-07-02T00:00:00.000Z' });
  missingSource.degraded === true && missingSource.reasonCodes.includes('PACKET_MISSING_SOURCE')
    ? ok('packet with no declared governing source is flagged degraded (PACKET_MISSING_SOURCE)') : bad('missing-source packet not flagged');
  JSON.stringify(da.compileImplementationPacket('WF-0066', classification, { workflow: 'WF-0066' }, { packetId: 'x', at: '2026-07-02T00:00:00.000Z' }))
    === JSON.stringify(da.compileImplementationPacket('WF-0066', classification, { workflow: 'WF-0066' }, { packetId: 'x', at: '2026-07-02T00:00:00.000Z' }))
    ? ok('packet compilation deterministic (identical input ⇒ identical output)') : bad('packet compilation not deterministic');

  // -- Packet validates against its own schema (round-trip #1) --------------
  const packetValid = da.validateArtifact('implementation-packet', packet, bundle.artifactSchemas);
  packetValid.valid === true ? ok('compiled packet validates against its own schema') : bad(`compiled packet schema-invalid: ${packetValid.errors}`);

  // -- Receipt comparator: clean run + deviations -----------------------------
  const cleanActual = {
    agentsActual: ['implementation-engineer'], skillsActual: ['senior-implementation'],
    filesTouched: ['templates/contextkit/runtime/domain-artifacts/packet-compile.mjs'], filesNew: [],
    contractsChanged: [], testsRun: ['selfcheck-domain-artifacts'], gatesRun: ['arch-debt'], result: 'success',
  };
  const cleanReceipt = da.buildImplementationReceipt(packet, cleanActual, { at: '2026-07-02T01:00:00.000Z' });
  cleanReceipt.packetId === 'packet-selfcheck' && cleanReceipt.deviations.length === 0 && cleanReceipt.reasonCodes.includes('RECEIPT_BUILT')
    && !cleanReceipt.reasonCodes.includes('RECEIPT_DEVIATION_DETECTED')
    ? ok('clean receipt: no deviations, packetId round-trips') : bad(`clean receipt wrong: ${JSON.stringify(cleanReceipt)}`);
  const receiptValid = da.validateArtifact('implementation-receipt', cleanReceipt, bundle.artifactSchemas);
  receiptValid.valid === true ? ok('built receipt validates against its own schema (round-trip #2)') : bad(`receipt schema-invalid: ${receiptValid.errors}`);

  const deviantActual = {
    agentsActual: [], skillsActual: [],
    filesTouched: ['contextkit/memory/business/BIZ-0003-domain-engineering-and-deterministic-implementation/secret.md'],
    filesNew: [], contractsChanged: ['domain-artifacts/index.mjs'], testsRun: [], gatesRun: [], result: 'deviated',
  };
  const deviantReceipt = da.buildImplementationReceipt(packet, deviantActual, { at: '2026-07-02T02:00:00.000Z' });
  const kinds = deviantReceipt.deviations.map((d) => d.kind);
  kinds.includes('agent-missing') && kinds.includes('skill-missing') && kinds.includes('forbidden-path-touched') && kinds.includes('preserved-contract-changed')
    ? ok('receipt detects agent/skill/forbidden-path/contract planned-vs-actual deviations') : bad(`deviation detection incomplete: ${JSON.stringify(kinds)}`);
  deviantReceipt.reasonCodes.includes('RECEIPT_DEVIATION_DETECTED') && deviantReceipt.reasonCodes.includes('RECEIPT_CONTRACT_CHANGED')
    ? ok('receipt records deviation + contract-changed reason codes') : bad('receipt reason codes missing on deviation');

  // -- Recipe resolution: deterministic + profile-scoped ----------------------
  const recipeSimple = da.resolveRecipeForProfile('simple', bundle.recipeContracts);
  recipeSimple.applicable === true && recipeSimple.recipeId === 'implementation-simple'
    && JSON.stringify(recipeSimple.playbookSteps) === JSON.stringify(['classify', 'compile', 'implement', 'verify', 'receipt'])
    ? ok('simple profile resolves the implementation-simple recipe (no model/decide/review)') : bad(`simple recipe wrong: ${JSON.stringify(recipeSimple)}`);
  const recipeDD = da.resolveRecipeForProfile('domain-driven', bundle.recipeContracts);
  recipeDD.applicable === true && recipeDD.playbookSteps.includes('model') && recipeDD.playbookSteps.includes('decide')
    ? ok('domain-driven profile resolves the full 8-step recipe (model + decide)') : bad('domain-driven recipe missing model/decide');
  const recipeNoCode = da.resolveRecipeForProfile('no-code', bundle.recipeContracts);
  recipeNoCode.applicable === false && recipeNoCode.reasonCode === 'RECIPE_UNKNOWN_PROFILE'
    ? ok('no-code profile has no applicable recipe (zero ceremony)') : bad('no-code wrongly resolved a recipe');
  JSON.stringify(da.resolveRecipeForProfile('modular', bundle.recipeContracts)) === JSON.stringify(da.resolveRecipeForProfile('modular', bundle.recipeContracts))
    ? ok('recipe resolution deterministic (identical profile ⇒ identical recipe)') : bad('recipe resolution not deterministic');
  const degradedRecipe = da.resolveRecipeForProfile('simple', null);
  degradedRecipe.degraded === true && degradedRecipe.reasonCode === 'ARTIFACTS_POLICY_DEGRADED'
    ? ok('missing recipe-contracts table ⇒ degraded resolution (never a false pass)') : bad('degraded recipe path is a false pass');

  // -- Linear recipe assembly reuses tc-recipe-runner's shape (no fork) -------
  const linear = da.buildLinearRecipe('simple', bundle.recipeContracts);
  linear && linear.entry === 'classify' && linear.steps.length === 5 && linear.steps.every((s) => s.kind === 'noop')
    ? ok('buildLinearRecipe assembles a tc-recipe-runner-shaped linear chain') : bad(`linear recipe assembly wrong: ${JSON.stringify(linear)}`);
  try {
    const { validateRecipe } = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-recipe-runner.mjs')).href);
    validateRecipe(linear);
    ok('assembled linear recipe passes tc-recipe-runner.validateRecipe (reuses existing infra, no second compiler)');
  } catch (err) {
    bad(`assembled recipe rejected by tc-recipe-runner: ${err?.message ?? err}`);
  }
  da.buildLinearRecipe('no-code', bundle.recipeContracts) === null
    ? ok('buildLinearRecipe returns null for a non-applicable profile') : bad('buildLinearRecipe fabricated a recipe for no-code');

  // -- Governed scaffolds: contract-gated release, typed placeholders only ----
  const refused = da.scaffold('aggregate-root', { artifactKind: 'aggregate', exists: false, valid: false }, bundle.scaffoldContracts);
  refused.released === false && refused.reasonCode === 'SCAFFOLD_REFUSED_NO_CONTRACT' && Object.keys(refused.typedPlaceholders).length === 0
    ? ok('scaffold refuses release with no satisfied contract (default-to-refuse, §8)') : bad('scaffold wrongly released without a contract');
  const invalidContract = da.scaffold('aggregate-root', { artifactKind: 'aggregate', exists: true, valid: false }, bundle.scaffoldContracts);
  invalidContract.released === false && invalidContract.reasonCode === 'SCAFFOLD_REFUSED_INVALID_CONTRACT'
    ? ok('scaffold refuses release when the contract exists but fails validation') : bad('scaffold wrongly released on an invalid contract');
  const wrongKind = da.scaffold('aggregate-root', { artifactKind: 'use-case', exists: true, valid: true }, bundle.scaffoldContracts);
  wrongKind.released === false && wrongKind.reasonCode === 'SCAFFOLD_REFUSED_NO_CONTRACT'
    ? ok('scaffold refuses release when the satisfied contract is the wrong kind') : bad('scaffold accepted a mismatched contract kind');
  const released = da.scaffold('aggregate-root', { artifactKind: 'aggregate', exists: true, valid: true }, bundle.scaffoldContracts);
  released.released === true && released.reasonCode === 'SCAFFOLD_PLACEHOLDER_EMITTED'
    && Object.values(released.typedPlaceholders).every((v) => v.startsWith('TODO:'))
    ? ok('scaffold releases typed placeholders only, never an invented value (constitution §9)') : bad(`scaffold released invented content: ${JSON.stringify(released)}`);
  JSON.stringify(released.placeholderFields) === JSON.stringify(['id', 'invariantsToImplement', 'commandHandlers'])
    ? ok('scaffold placeholder fields come from the scaffold-contracts table, not hardcoded here') : bad('scaffold placeholder fields drifted from the table');
  da.scaffold('bogus-scaffold', { artifactKind: 'aggregate', exists: true, valid: true }, bundle.scaffoldContracts).reasonCode === 'SCAFFOLD_UNKNOWN_KIND'
    ? ok('unknown scaffold kind refused, not fabricated') : bad('unknown scaffold kind wrongly handled');

  // -- Reason-code stability (every emitted code is in the catalog) ----------
  const catalog = da.loadDomainArtifactsPolicyTable(TPL, 'reasonCodes').table?.codes ?? {};
  const emitted = [
    ...packet.reasonCodes, ...missingSource.reasonCodes, ...cleanReceipt.reasonCodes, ...deviantReceipt.reasonCodes,
    propSimple.reasonCode, propDD.reasonCode, recipeSimple.reasonCode, recipeNoCode.reasonCode,
    refused.reasonCode, invalidContract.reasonCode, released.reasonCode,
    'ARTIFACT_SCHEMA_VALID', 'ARTIFACT_SCHEMA_INVALID', 'ARTIFACT_UNKNOWN_KIND', 'ARTIFACTS_POLICY_DEGRADED', 'SCAFFOLD_UNKNOWN_KIND',
  ];
  emitted.every((code) => code in catalog) ? ok('every emitted domain-artifacts reason code exists in the catalog') : bad(`unknown reason code emitted: ${emitted.filter((c) => !(c in catalog))}`);
}
