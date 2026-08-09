/**
 * Checks the ContextDevKit 4.0 Domain Engineering observation contract.
 *
 * @param {{ ok: Function, bad: Function }} report Test reporter.
 * @param {{ KIT: string }} context Repository context.
 * @returns {Promise<void>}
 */
export async function runDomainEngineeringChecks({ ok, bad }, { KIT }) {
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const runtime = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/domain-engineering/index.mjs')).href);
  const templatesRoot = resolve(KIT, 'templates');

  console.log('Checking Domain Engineering advisory classification...');
  const bundle = runtime.loadPolicyBundle(templatesRoot);
  bundle?.degraded === false ? ok('domain policy bundle loads') : bad(`domain policy bundle degraded: ${bundle?.missing}`);

  const disabled = runtime.resolveConfig();
  runtime.resolveObservationMode(disabled) === 'shadow'
    ? ok('disabled Domain Engineering is shadow-only') : bad('disabled Domain Engineering gained authority');
  const enabled = runtime.resolveConfig({ enabled: true, mode: 'guarded' });
  runtime.resolveObservationMode(enabled) === 'advisory'
    ? ok('legacy enforcement input is capped at advisory') : bad('Domain Engineering exceeded advisory mode');

  const noCode = runtime.buildImplementationBlock({ root: templatesRoot, requestText: 'Explain the architecture without changing anything.' });
  noCode.recommendationsOnly === true && noCode.profile === 'no-code' && noCode.recommendedAgents.length === 0
    ? ok('read-only exploration yields no implementation recommendation') : bad(`read-only classification wrong: ${JSON.stringify(noCode)}`);

  const mutation = runtime.buildImplementationBlock({ root: templatesRoot, requestText: 'Implement a distributed billing aggregate.', writeAttempt: true, tool: 'Edit' });
  const forbiddenKeys = ['requiredAgents', 'requiredSkills', 'requiredArtifacts', 'squadRequired', 'simulateImpactRequired'];
  mutation.recommendationsOnly === true && Array.isArray(mutation.recommendedAgents)
    ? ok('mutation classification emits recommendations only') : bad('mutation recommendation shape missing');
  forbiddenKeys.every((key) => !(key in mutation))
    ? ok('classification exposes no required-agent or required-artifact contract') : bad(`legacy obligation key survived: ${forbiddenKeys.filter((key) => key in mutation)}`);

  const degraded = runtime.buildImplementationBlock({ policy: { degraded: true, missing: ['policy'] }, requestText: 'Implement x' });
  degraded.degraded === true && degraded.recommendationAvailable === false
    ? ok('degraded classification is honest and non-blocking') : bad('degraded classification fabricated authority');
}
