/**
 * Self-check suite for WF-0063 — Domain Engineering deterministic classification
 * (ADR-0128 / ADR-0129). Validates the invariants the kit must never regress:
 * CMIS/DAS verdict bands, the Class-A write-attempt hard trigger, path hard
 * exclusions, profile resolution (no-code short-circuit + raise-only escalation +
 * simple-never-gets-a-domain-model), determinism, fail-open degrade (never a false
 * pass), rule-class ceilings (Class B never strict), ground-truth self-report
 * exclusion, the `rule × host × policyVersion` calibration unit, and the additive
 * shadow envelope block. Wired into `tools/selfcheck.mjs`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RT = 'templates/contextkit/runtime/domain-engineering';

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runDomainEngineeringChecks({ ok, bad }, { KIT }) {
  console.log('Checking WF-0063 domain-engineering classification...');
  const imp = async (rel) => import(pathToFileURL(resolve(KIT, RT, rel)).href);
  const TPL = resolve(KIT, 'templates');

  let de, env;
  try {
    de = await imp('index.mjs');
    env = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/execution/request-envelope.mjs')).href);
    ok('domain-engineering modules import cleanly');
  } catch (err) {
    bad(`domain-engineering import failed: ${err?.message ?? err}`);
    return;
  }

  const bundle = de.loadPolicyBundle(TPL);
  bundle && !bundle.degraded ? ok('policy bundle loads (not degraded)') : bad(`policy bundle degraded: ${bundle?.missing}`);
  const codeIntent = { ...bundle.codeIntent, hardTrigger: bundle.hardTriggers?.codeMutationIntent?.writeAttempt };

  const cmis = (text, paths = [], extra = {}) => de.scoreCodeMutationIntent(
    de.buildSignals({ requestText: text, intakeSignals: { tier: 'feature', paths }, classification: extra.cls || {}, writeAttempt: extra.wa }),
    codeIntent,
  );
  const das = (text) => de.scoreDomainApplicability(de.buildSignals({ requestText: text }), bundle.domainApplicability, bundle.hardTriggers);

  // -- CMIS verdict bands ----------------------------------------------------
  cmis('what is the materiality score and how does it work?').verdict === 'NO_CODE' ? ok('CMIS NO_CODE') : bad('CMIS NO_CODE misfired');
  cmis('plan the roadmap status').verdict === 'NO_CODE' ? ok('CMIS planning → NO_CODE') : bad('CMIS planning band wrong');
  cmis('implement the scorer function', ['x.mjs']).verdict === 'CODE_MODIFICATION' ? ok('CMIS CODE_MODIFICATION') : bad('CMIS CODE_MODIFICATION band wrong');
  const creation = cmis('implement and create a new module endpoint, add a test, needs build', ['src/x.mjs']);
  creation.score >= 70 ? ok('CMIS CODE_CREATION (≥70)') : bad(`CMIS creation band wrong: ${creation.score}`);

  // -- Class-A write-attempt hard trigger ------------------------------------
  const trig = cmis('anything', ['a.mjs'], { wa: true });
  trig.score === 100 && trig.reasonCodes.includes('CMIS_HARD_TRIGGER_WRITE_ATTEMPT')
    ? ok('CMIS write-attempt hard trigger = 100 (Class A)') : bad('write-attempt hard trigger broken');

  // -- Determinism -----------------------------------------------------------
  JSON.stringify(cmis('implement x', ['a.mjs'])) === JSON.stringify(cmis('implement x', ['a.mjs']))
    ? ok('CMIS deterministic (identical input ⇒ identical output)') : bad('CMIS not deterministic');

  // -- DAS bands + floor + reducer -------------------------------------------
  das('add a simple crud getter').profileFloor === 'simple' ? ok('DAS simple (reducer)') : bad('DAS simple band wrong');
  das('implement the invariant in a bounded context with a domain event').profileFloor === 'domain-driven'
    ? ok('DAS domain-driven (weighted band)') : bad('DAS domain-driven band wrong');
  // Pure floor test: "aggregate" is ONLY a hard-trigger token (score stays low) so
  // the floor must RAISE simple → domain-driven and record its reason code.
  const dd = das('refactor the aggregate');
  dd.profileFloor === 'domain-driven' && dd.reasonCodes.includes('DAS_FLOOR_DOMAIN_DRIVEN')
    ? ok('DAS floor raises low score + records reason') : bad(`DAS floor raise wrong: ${dd.profileFloor} ${dd.reasonCodes}`);
  das('build a saga with eventual consistency and an outbox of versioned events').profileFloor === 'distributed-domain'
    ? ok('DAS distributed-domain (floor trigger)') : bad('DAS distributed floor wrong');

  // -- Path classification (hard exclusions + classes) -----------------------
  const pc = (p) => de.classifyPath(p, bundle.pathRules).pathClass;
  const pcx = (p) => de.classifyPath(p, bundle.pathRules);
  pc('templates/x.mjs') === 'source-code' ? ok('path source-code') : bad('path source-code wrong');
  pc('x.test.mjs') === 'test-code' ? ok('path test-code') : bad('path test-code wrong');
  pc('migrations/001.sql') === 'database-migration' ? ok('path migration') : bad('path migration wrong');
  pcx('node_modules/a/b.js').hardExcluded === true ? ok('path hard-exclusion (node_modules)') : bad('hard exclusion missed');
  pc('package-lock.json') === 'generated' ? ok('path lockfile → generated') : bad('lockfile not excluded');
  pc('README.md') === 'documentation' ? ok('path documentation') : bad('path docs wrong');
  pc('weird.bin') === 'unknown' ? ok('path unknown fallback') : bad('path fallback wrong');

  // -- Profile resolution ----------------------------------------------------
  const prof = (cmisR, dasR, ctx = {}) => de.resolveImplementationProfile(cmisR, dasR, ctx, bundle.profiles);
  prof({ verdict: 'NO_CODE' }, { profileFloor: 'simple' }).profile === 'no-code' ? ok('profile NO_CODE short-circuit') : bad('no-code short-circuit broken');
  const simple = prof({ verdict: 'CODE_MODIFICATION' }, { profileFloor: 'simple' }, {});
  simple.profile === 'simple' && !simple.artifacts.includes('domain-map')
    ? ok('profile simple never gets a domain-map (proportionality)') : bad('simple wrongly got domain ceremony');
  prof({ verdict: 'CODE_MODIFICATION' }, { profileFloor: 'domain-driven' }).profile === 'domain-driven' ? ok('profile from DAS floor') : bad('profile from DAS wrong');
  const escalated = prof({ verdict: 'CODE_MODIFICATION' }, { profileFloor: 'simple' }, { risk: 'critical' });
  escalated.profile === 'domain-driven' && escalated.reasonCodes.includes('PROFILE_ESCALATED_BY_RISK')
    ? ok('profile raise-only escalation by risk') : bad('risk escalation broken');

  // -- Fail-open degrade (never a false pass) --------------------------------
  const degraded = de.buildImplementationBlock({ policy: { degraded: true, missing: ['all'] }, requestText: 'implement x' });
  degraded.degraded === true && degraded.shadow === true && degraded.profile === 'no-code' && degraded.reasonCodes.includes('ENVELOPE_DEGRADED')
    ? ok('degraded policy ⇒ recorded degrade, never a false pass') : bad('degrade path is a false pass');

  // -- Rule classes (ADR-0129 §1 ceilings) -----------------------------------
  de.validateRuleClasses(bundle.ruleClasses).length === 0 ? ok('rule-classes valid (no Class-B strict)') : bad(`rule-class violations: ${de.validateRuleClasses(bundle.ruleClasses)}`);
  de.isClassA('CMIS_WRITE_ATTEMPT', bundle.ruleClasses) ? ok('write-attempt is Class A') : bad('write-attempt class wrong');
  de.maximumAutomaticLevel('DAS_DOMAIN_APPLICABILITY', bundle.ruleClasses) === 'guarded' ? ok('Class B ceiling = guarded') : bad('Class B ceiling wrong');
  de.maximumAutomaticLevel('CMIS_WRITE_ATTEMPT', bundle.ruleClasses) === 'guarded' ? ok('Class A not pre-authorized ⇒ capped guarded') : bad('Class A strict cap wrong');

  // -- Ground truth (self-report never promotes) -----------------------------
  const labels = [
    de.buildLabel({ ruleId: 'DAS_DOMAIN_APPLICABILITY', provenance: 'humanAdjudicated', predictedPositive: true, actualPositive: true }),
    de.buildLabel({ ruleId: 'DAS_DOMAIN_APPLICABILITY', provenance: 'selfReported', predictedPositive: true, actualPositive: false }),
  ];
  de.promotionAuthorizedLabels(labels).length === 1 ? ok('self-report excluded from promotion authority') : bad('self-report wrongly promotes');
  de.provenanceCounts(labels).selfReported === 1 ? ok('provenance counts record self-report (telemetry only)') : bad('provenance count wrong');
  de.buildConfusionMatrix('PATH_CLASSIFICATION', labels, bundle.ruleClasses, de.isClassA) === null
    ? ok('confusion matrix refused for Class A rule') : bad('confusion matrix built for Class A');
  de.buildConfusionMatrix('DAS_DOMAIN_APPLICABILITY', labels, bundle.ruleClasses, de.isClassA)?.matrix.truePositive === 1
    ? ok('confusion matrix built for Class B (self-report excluded)') : bad('Class B confusion matrix wrong');
  try { de.buildLabel({ ruleId: 'x', provenance: 'bogus' }); bad('buildLabel accepted unknown provenance'); }
  catch { ok('buildLabel rejects unknown provenance (fail-fast)'); }

  // -- Telemetry calibration unit (rule × host × policyVersion) ---------------
  de.calibrationKey({ ruleId: 'r', host: 'claude', policyVersion: '0.1.0' }) === 'r::claude::0.1.0' ? ok('calibration key = rule×host×policyVersion') : bad('calibration key wrong');
  const sample = de.buildSample({ ruleId: 'r', host: 'claude', policyVersion: '0.1.0', profile: 'simple', project: 'contextdevkit' });
  !sample.key.includes('simple') && !sample.key.includes('contextdevkit') && sample.dimensions.profile === 'simple'
    ? ok('profile/project are telemetry dimensions, not in the key') : bad('calibration unit leaked profile/project into the key');
  sample.shadow === true ? ok('telemetry sample is shadow') : bad('telemetry sample not shadow');

  // -- Config (default-off + level ladder) -----------------------------------
  de.DEFAULT_DOMAIN_ENGINEERING_CONFIG.enabled === false ? ok('config default-off') : bad('config not default-off');
  const cfg = de.resolveConfig({ enabled: true, codeIntent: { codeMin: 55 } });
  cfg.codeIntent.codeMin === 55 && cfg.codeIntent.structuralMin === 70 ? ok('config shallow-merge keeps defaults') : bad('config merge wrong');
  de.modeForLevel(7, cfg) === 'strict' && de.modeForLevel(5, cfg) === 'guarded' && de.modeForLevel(4, cfg) === 'advisory'
    ? ok('config level→mode ladder') : bad('level ladder wrong');

  // -- Envelope additive shadow block + governance non-interference ----------
  const envelope = env.buildEnvelope({
    requestId: 'req-t', requestText: 'implement the aggregate in a bounded context',
    classification: { primaryType: 'implementation', risk: 'high', blastRadius: 'module' },
    intakeSignals: { tier: 'feature', paths: ['src/order.mjs'] }, root: TPL,
  });
  envelope.implementation && envelope.implementation.shadow === true ? ok('envelope carries shadow §15 block') : bad('envelope missing implementation block');
  envelope.classification && envelope.context && envelope.routing ? ok('envelope existing blocks intact (additive)') : bad('envelope wiring broke existing shape');
  !('workNature' in envelope.implementation) && !('ceremony' in envelope.implementation)
    ? ok('implementation block never sets Work Nature / Ceremony (governance owns them)') : bad('block leaks governance authority');

  // -- Reason-code stability (every emitted code is in the catalog) -----------
  const catalog = de.loadPolicyTable(TPL, 'reasonCodes').table?.codes || {};
  const emitted = [...creation.reasonCodes, ...dd.reasonCodes, ...escalated.reasonCodes, ...degraded.reasonCodes, 'CMIS_HARD_TRIGGER_WRITE_ATTEMPT'];
  emitted.every((code) => code in catalog) ? ok('every emitted reason code exists in the catalog') : bad(`unknown reason code emitted: ${emitted.filter((c) => !(c in catalog))}`);
}
