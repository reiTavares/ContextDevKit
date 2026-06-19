/**
 * Integration test — workflow ownership engine (W2-T3 / WF0035).
 *
 * Standalone harness for the PURE ownership module. Exercises glob matching,
 * cross-task collision detection, agent-result path validation, the
 * ownership-required throw, and the orchestrator-owned shared-set flagger.
 * No install fixture is needed — `ownership.mjs` is pure.
 *
 * RUN: node tools/integration-test-workflow-ownership.mjs  →  exit 0 on pass.
 */
import { reporter } from './it-helpers.mjs';
import {
  matchesGlob,
  pathsOverlap,
  detectCollisions,
  validateResultPaths,
  requireOwnership,
  orchestratorOwned,
  DEFAULT_ORCHESTRATOR_SHARED,
} from '../templates/contextkit/tools/scripts/workflow/ownership.mjs';

const rep = reporter();
const check = (label, cond) => (cond ? rep.ok(label) : rep.bad(label));

/* ── matchesGlob: `*`, `**`, trailing slash ─────────────────────────────── */
check('* matches a single segment', matchesGlob('src/a.mjs', 'src/*.mjs'));
check('* does NOT cross a slash', !matchesGlob('src/sub/a.mjs', 'src/*.mjs'));
check('** matches any depth', matchesGlob('a/b/c/d.json', 'a/**/d.json'));
check('** absorbs zero segments', matchesGlob('a/d.json', 'a/**/d.json'));
check('trailing slash = prefix (under)', matchesGlob('docs/wf/x.md', 'docs/wf/'));
check('trailing slash = prefix (dir itself)', matchesGlob('docs/wf', 'docs/wf/'));
check('trailing slash excludes sibling', !matchesGlob('docs/wfx/x.md', 'docs/wf/'));
check('leading ./ normalized', matchesGlob('./src/a.mjs', 'src/*.mjs'));
check('backslash normalized', matchesGlob('src\\a.mjs', 'src/*.mjs'));
check('exact literal match', matchesGlob('tools/test-suites.mjs', 'tools/test-suites.mjs'));
check('empty pattern never matches', !matchesGlob('a', ''));
check('** envelope of registry json', matchesGlob('x/workflow/registry/r.json', 'x/workflow/registry/*.json'));

/* ── pathsOverlap ───────────────────────────────────────────────────────── */
check('identical globs overlap', pathsOverlap(['a/b.mjs'], ['a/b.mjs']));
check('** envelope overlaps a concrete child', pathsOverlap(['a/**'], ['a/b/c.mjs']));
check('trailing-dir overlaps a file under it', pathsOverlap(['docs/wf/'], ['docs/wf/x.md']));
check('disjoint concrete paths do NOT overlap', !pathsOverlap(['a/b.mjs'], ['c/d.mjs']));
check('disjoint envelopes do NOT overlap', !pathsOverlap(['a/**'], ['b/**']));

/* ── Fixtures: two agent tasks sharing a file (write/write) ─────────────── */
const agent = (id, allowedPaths, extra = {}) => ({
  id,
  execution: { mode: 'agent' },
  ownership: { allowedPaths, forbiddenPaths: [], readOnlyPaths: [], sharedPaths: [], integrationOwner: null, ...extra },
});

const taskAlpha = agent('W1-T1', ['src/shared.mjs', 'tools/a.mjs']);
const taskBeta = agent('W1-T2', ['src/shared.mjs', 'tools/b.mjs']); // collides on src/shared.mjs
const taskGamma = agent('W1-T3', ['src/feature/**'], { sharedPaths: ['src/io.mjs'] }); // shared w/o owner
const taskDelta = agent('W1-T4', ['lib/only.mjs']); // disjoint

const collisions = detectCollisions([taskAlpha, taskBeta, taskGamma, taskDelta]);
const hasWriteWrite = collisions.some(
  (c) => c.taskA === 'W1-T1' && c.taskB === 'W1-T2' && /write\/write/.test(c.reason),
);
const hasSharedNoOwner = collisions.some(
  (c) => c.taskA === 'W1-T3' && c.taskB === 'W1-T3' && /integrationOwner/.test(c.reason),
);
const noFalseDelta = !collisions.some((c) => c.taskA === 'W1-T4' || c.taskB === 'W1-T4');
check('write/write collision on shared file detected', hasWriteWrite);
check('shared path without integrationOwner detected', hasSharedNoOwner);
check('disjoint task produces no collision', noFalseDelta);

/* overlapping GLOBS (envelope vs envelope) across tasks */
const envA = agent('W2-A', ['templates/x/workflow/**']);
const envB = agent('W2-B', ['templates/x/workflow/sub/y.mjs']);
const globCollisions = detectCollisions([envA, envB]);
check('overlapping globs across tasks detected', globCollisions.some((c) => /write\/write/.test(c.reason)));

/* non-agent tasks never collide (orchestrator/human/deterministic) */
const orchA = { id: 'O1', execution: { mode: 'orchestrator' }, ownership: { allowedPaths: ['z.mjs'] } };
const orchB = { id: 'O2', execution: { mode: 'orchestrator' }, ownership: { allowedPaths: ['z.mjs'] } };
check('two non-agent tasks on same path do NOT collide', detectCollisions([orchA, orchB]).length === 0);

/* deterministic ordering: stable across input permutation */
const order1 = JSON.stringify(detectCollisions([taskAlpha, taskBeta]));
const order2 = JSON.stringify(detectCollisions([taskBeta, taskAlpha]));
check('collision output is deterministic regardless of input order', order1 === order2);

/* ── validateResultPaths ────────────────────────────────────────────────── */
const laneTask = {
  id: 'W2-T3',
  execution: { mode: 'agent' },
  ownership: {
    allowedPaths: ['templates/x/workflow/ownership.mjs', 'tools/it-own.mjs'],
    forbiddenPaths: ['templates/x/workflow.mjs', 'tools/test-suites.mjs'],
    readOnlyPaths: ['templates/x/workflow/io.mjs'],
    sharedPaths: [],
    integrationOwner: 'orchestrator',
  },
};

const okResult = validateResultPaths(laneTask, {
  filesCreated: ['templates/x/workflow/ownership.mjs'],
  filesModified: ['tools/it-own.mjs'],
});
check('result inside lane is valid', okResult.valid && okResult.violations.length === 0);

const outsideResult = validateResultPaths(laneTask, { filesCreated: ['src/rogue.mjs'] });
check('result outside allowedPaths flagged', outsideResult.violations.some((v) => v.rule === 'outsideAllowedPaths'));

const forbiddenResult = validateResultPaths(laneTask, { filesModified: ['tools/test-suites.mjs'] });
check('result writing a forbiddenPath flagged', forbiddenResult.violations.some((v) => v.rule === 'forbiddenPath'));

const readOnlyResult = validateResultPaths(laneTask, { filesModified: ['templates/x/workflow/io.mjs'] });
check('result writing a readOnlyPath flagged', readOnlyResult.violations.some((v) => v.rule === 'readOnlyPath'));

/* ── requireOwnership ───────────────────────────────────────────────────── */
let threw = false;
try {
  requireOwnership(agent('W9-T9', []), { profile: 'program' });
} catch {
  threw = true;
}
check('missing-ownership agent task throws in program profile', threw);

let didNotThrow = true;
try {
  requireOwnership(agent('W9-T8', ['ok.mjs']), { profile: 'program' });
} catch {
  didNotThrow = false;
}
check('agent task with allowedPaths does not throw', didNotThrow);

let exemptSingle = true;
try {
  requireOwnership(agent('W9-T7', []), { profile: 'single' });
} catch {
  exemptSingle = false;
}
check('single profile is exempt from ownership requirement', exemptSingle);

let exemptOrch = true;
try {
  requireOwnership({ id: 'O', execution: { mode: 'orchestrator' }, ownership: { allowedPaths: [] } }, { profile: 'program' });
} catch {
  exemptOrch = false;
}
check('orchestrator-mode task is exempt from ownership requirement', exemptOrch);

/* ── orchestratorOwned ──────────────────────────────────────────────────── */
const flagged = orchestratorOwned(
  ['templates/contextkit/tools/scripts/workflow.mjs', 'tools/test-suites.mjs', 'tools/safe.mjs'],
  DEFAULT_ORCHESTRATOR_SHARED,
);
check('orchestratorOwned flags the CLI entrypoint', flagged.includes('templates/contextkit/tools/scripts/workflow.mjs'));
check('orchestratorOwned flags test registration', flagged.includes('tools/test-suites.mjs'));
check('orchestratorOwned leaves an agent-owned file alone', !flagged.includes('tools/safe.mjs'));
check('orchestratorOwned output is sorted & unique', flagged.length === 2 && flagged[0] < flagged[1]);

const customShared = orchestratorOwned(['ci/release.yml', 'src/a.mjs'], ['ci/**']);
check('orchestratorOwned honours a custom shared registry', customShared.length === 1 && customShared[0] === 'ci/release.yml');

rep.finish('workflow-ownership');
