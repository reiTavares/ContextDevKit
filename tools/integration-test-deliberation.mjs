#!/usr/bin/env node
/** ContextDevKit 4 explicit, advisory deliberation integration test. */
import { installFixture, reporter } from './it-helpers.mjs';
import { DEFAULT_CONFIG } from '../templates/contextkit/runtime/config/defaults.mjs';
import { buildPlan, classifyLanes } from '../templates/contextkit/tools/scripts/deliberation-council.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - explicit advisory deliberation\n');

const config = {
  ...DEFAULT_CONFIG,
  deliberations: { ...DEFAULT_CONFIG.deliberations, active: false },
};

const lanes = classifyLanes('Compare an authentication migration and its user experience tradeoffs.');
lanes.includes('architecture') && lanes.includes('security') && lanes.includes('ux')
  ? ok('explicit planning derives relevant perspectives')
  : bad(`perspective classification drifted: ${JSON.stringify(lanes)}`);

const first = buildPlan('Should we replace the authentication protocol?', { config });
const second = buildPlan('Should we replace the authentication protocol?', { config });
JSON.stringify(first) === JSON.stringify(second)
  ? ok('an explicitly requested deliberation plan is deterministic')
  : bad('explicit deliberation plan is non-deterministic');

Array.isArray(first.council) && first.council.length > 0
  ? ok('explicit deliberation remains available when automatic nudges are disabled')
  : bad('explicit deliberation incorrectly depends on automatic activation');

const fixture = installFixture(rep);
try {
  const cli = fixture.script(
    'deliberation-council.mjs',
    'plan',
    '--question',
    'Compare an authentication migration and its user experience tradeoffs.',
    '--json',
  );
  let parsed = null;
  try { parsed = JSON.parse(cli.stdout); } catch { /* asserted below */ }
  cli.status === 0 && Array.isArray(parsed?.council)
    ? ok('installed explicit deliberation command returns an advisory plan')
    : bad(`installed deliberation command failed: ${cli.stdout || cli.stderr}`);
} finally {
  fixture.cleanup();
}

rep.finish('Explicit advisory deliberation');
