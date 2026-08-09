/** Focused v4 status-line projection checks. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Verifies governance and task authority segments without filesystem state.
 *
 * @param {{ ok: (message:string)=>void, bad:(message:string)=>void }} reporter
 * @param {{ KIT: string }} context
 * @returns {Promise<void>}
 */
export async function runStatuslineChecks(reporter, { KIT }) {
  const { ok, bad } = reporter;
  console.log('Checking v4 statusline authority projections...');
  let statusline;
  try {
    statusline = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/statusline.mjs')).href);
  } catch (error) {
    bad(`statusline.mjs failed to import: ${error?.message ?? error}`);
    return;
  }

  const governance = statusline.computeGovernanceSegment({
    counts: { guarded: 3, canary: 11, shadow: 1, off: 2 },
  });
  governance === 'g:3 c:11 s:1'
    ? ok('governance segment renders resolved matrix counts')
    : bad(`unexpected governance segment: ${governance}`);

  statusline.computeGovernanceSegment(null) === '⚠ governance unavailable'
    ? ok('missing matrix remains explicitly unavailable')
    : bad('missing matrix was not surfaced honestly');

  const activeTasks = statusline.computeTaskSegment({
    status: 'available',
    counts: { working: 2, blocked: 1, testing: 3 },
  });
  activeTasks === '2 working/1 blocked/3 testing'
    ? ok('task segment renders canonical active statuses')
    : bad(`unexpected task segment: ${activeTasks}`);

  statusline.computeTaskSegment({ status: 'corrupt' }) === '⚠ tasks corrupt'
    ? ok('corrupt authority is not rendered as an empty task set')
    : bad('corrupt authority was hidden');

  statusline.computeTaskSegment({ status: 'partial', counts: {} }) === '⚠ partial'
    ? ok('partial authority remains visible')
    : bad('partial authority was hidden');
}
