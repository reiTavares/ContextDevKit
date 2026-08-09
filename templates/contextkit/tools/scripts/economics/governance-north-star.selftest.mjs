/** Focused v4 canary telemetry tests for governance-token and workflow throughput. */
import {
  countConcludedContexts,
  evaluateGovernanceTokenGuardrail,
  northStarReading,
  presentGovernanceNorthStar,
  readGovernanceTokenSeries,
} from './governance-north-star.mjs';

let failures = 0;
function check(label, condition) {
  process.stdout.write(`  ${condition ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!condition) failures += 1;
}

const rows = [
  { sessionId: 'prior', lever: 'dev-start', observed: { tokens: 100 } },
  { sessionId: 'current', lever: 'dev-start', observed: { tokens: 120 } },
  { sessionId: 'current', lever: 'run-compact', observed: { tokens: 999 } },
];
const series = readGovernanceTokenSeries('/fixture', {
  sessionId: 'current',
  readEvents: () => rows,
});
check('series compares measured governance categories only', series.available && series.sessionTokens === 120 && series.priorSessionTokens === 100);

const finding = evaluateGovernanceTokenGuardrail(series);
check('rising spend is a canary finding', finding.status === 'finding' && finding.risen === true && finding.delta === 20);
check('economy telemetry never blocks promotion', finding.blocksPromotion === false);
check('missing measurement stays skipped', evaluateGovernanceTokenGuardrail(null).status === 'skipped');

const contexts = countConcludedContexts('/fixture', {
  snapshot: {
    authority: 'v4-json',
    workflows: [
      { id: 'WF-0001', status: 'done' },
      { id: 'WF-0002', status: 'working' },
      { id: 'WF-0003', status: 'done' },
    ],
  },
});
check('conclusions come from v4 workflow state projection', contexts.available && contexts.concluded === 2 && contexts.scanned === 3);
check('empty authority is unavailable, not a flattering zero', !countConcludedContexts('/fixture', { snapshot: { workflows: [] } }).available);

const northStar = northStarReading(series, contexts);
check('north-star uses measured numerator and denominator', northStar.available && northStar.concludedPerThousandTokens === 9.0909);
check('baseline and target remain unasserted', northStar.baseline === null && northStar.target === null);
const rendered = presentGovernanceNorthStar(northStar, finding);
check('presentation discloses the canary finding', rendered.includes('finding') && !rendered.includes('blocks promotion'));

process.stdout.write(failures === 0 ? '\ngovernance north-star v4: PASS\n' : `\ngovernance north-star v4: FAIL (${failures})\n`);
if (failures > 0) process.exitCode = 1;
