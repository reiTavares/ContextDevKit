/**
 * Checks optional Domain Engineering artifacts and Task Compiler recipes.
 *
 * @param {{ ok: Function, bad: Function }} report Test reporter.
 * @param {{ KIT: string }} context Repository context.
 * @returns {Promise<void>}
 */
export async function runDomainArtifactsChecks({ ok, bad }, { KIT }) {
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const artifacts = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/domain-artifacts/index.mjs')).href);
  const templatesRoot = resolve(KIT, 'templates');
  const bundle = artifacts.loadDomainArtifactsPolicyBundle(templatesRoot);

  console.log('Checking optional domain artifacts and Task Compiler recipes...');
  bundle?.degraded === false ? ok('domain artifact policy bundle loads') : bad(`artifact bundle degraded: ${bundle?.missing}`);
  const ids = Object.keys(bundle.artifactSchemas?.artifacts ?? {});
  JSON.stringify(ids.sort()) === JSON.stringify(['aggregate', 'domain-map', 'use-case'])
    ? ok('receipt and implementation-packet schemas are physically absent') : bad(`unexpected artifact schemas: ${ids}`);

  const domainMap = { owner: 'WF-TEST', contexts: [], crossContextRelations: [] };
  artifacts.validateArtifact('domain-map', domainMap, bundle.artifactSchemas).valid === true
    ? ok('explicit domain-map validates') : bad('valid domain-map rejected');
  artifacts.checkProportionality('domain-map', 'simple', bundle.artifactSchemas).status === 'forbidden'
    ? ok('simple work avoids disproportionate domain maps') : bad('simple domain-map proportionality drifted');
  artifacts.checkProportionality('domain-map', 'domain-driven', bundle.artifactSchemas).status === 'recommended'
    ? ok('domain-driven map is recommended, never required') : bad('domain-driven map did not stay advisory');

  const recipe = artifacts.resolveRecipeForProfile('domain-driven', bundle.recipeContracts);
  recipe.applicable === true && recipe.playbookSteps.includes('model') && !recipe.playbookSteps.includes('receipt') && !recipe.playbookSteps.includes('compile')
    ? ok('Task Compiler recipe has no packet or receipt theatre') : bad(`recipe retained a legacy prerequisite: ${JSON.stringify(recipe)}`);
  const linear = artifacts.buildLinearRecipe('simple', bundle.recipeContracts);
  linear?.steps?.length === 3 && linear.steps.every((step) => step.kind === 'noop')
    ? ok('optional recipe assembles a deterministic runner-compatible skeleton') : bad('optional recipe assembly failed');

  const refused = artifacts.scaffold('aggregate-root', { artifactKind: 'aggregate', exists: false, valid: false }, bundle.scaffoldContracts);
  refused.released === false ? ok('explicit scaffold refuses without its own contract') : bad('scaffold invented an aggregate');
}
