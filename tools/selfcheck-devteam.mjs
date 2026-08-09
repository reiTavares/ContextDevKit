/**
 * Checks that devteam routing remains an optional recommendation in 4.0.
 *
 * @param {{ ok: Function, bad: Function }} report Test reporter.
 * @param {{ KIT: string }} context Repository context.
 * @returns {Promise<void>}
 */
export async function runDevteamChecks({ ok, bad }, { KIT }) {
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const devteam = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/devteam/index.mjs')).href);
  const templatesRoot = resolve(KIT, 'templates');
  const bundle = devteam.loadDevteamPolicyBundle(templatesRoot);

  console.log('Checking advisory devteam recommendations...');
  bundle?.degraded === false ? ok('devteam policy bundle loads') : bad(`devteam bundle degraded: ${bundle?.missing}`);
  devteam.validatePlaybookOrder(bundle.playbook).valid === true
    ? ok('optional six-step playbook is ordered') : bad('optional playbook order drifted');

  const agents = devteam.resolveRecommendedAgents({ profile: 'modular', recommendedAgents: ['implementation-engineer', 'test-engineer'] });
  agents.degraded === false && agents.agents.length === 2
    ? ok('agent suggestions resolve without dispatch') : bad('agent recommendation resolution failed');
  devteam.resolveRecommendedAgents('missing', { profiles: {} }).degraded === true
    ? ok('unknown profile degrades to no recommendation') : bad('unknown profile fabricated agents');

  const skills = devteam.resolveRecommendedSkills(
    { score: 80 }, { score: 50 }, { profile: 'domain-driven' },
    { flags: { writeAttempt: true }, risk: 'high', complexity: 'high' }, bundle.skillTriggers,
  );
  Array.isArray(skills.skills) && skills.degraded === false
    ? ok('skill suggestions resolve as data') : bad('skill recommendation resolution failed');
  const fallback = devteam.resolveRecommendedSkills({ score: 60 }, { score: 10 }, { profile: 'simple' }, {}, null);
  fallback.degraded === true && fallback.skills.length > 0
    ? ok('missing policy yields a non-blocking baseline suggestion') : bad('missing skill policy did not degrade honestly');
}
