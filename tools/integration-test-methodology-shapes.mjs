/**
 * Integration test for the canonical ceremony-shape resolver.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';
import {
  CEREMONY_SHAPES,
  resolveCeremonyShape,
} from '../templates/contextkit/methodology/resolve-ceremony-shape.mjs';
import { classifyWork } from '../templates/contextkit/runtime/execution/work-classifier.mjs';
import { classify } from '../templates/contextkit/tools/scripts/complexity-rubric.mjs';
import { loadCeremonyManifest, resolveCeremonyManifest, readCanonicalContinuationTemplate } from '../templates/contextkit/tools/scripts/workflow/ceremony-manifest.mjs';
import { requiredFilesForShape } from '../templates/contextkit/tools/scripts/workflow/files.mjs';
import { validateStructure } from '../templates/contextkit/methodology/validate-structure.mjs';
import { leakScrub } from '../templates/contextkit/methodology/leak-scrub.mjs';

const rep = reporter();

const cases = [
  ['operation', 'direct', 'trivial', 'maintenance', 'quick-fix'],
  ['operation', 'batch', 'feature', 'maintenance', 'batch-operation'],
  ['operation', 'workflow', 'feature', 'change', 'single-workflow-operation'],
  ['operation', 'direct', 'architectural', 'change', 'single-workflow-operation'],
  ['business', 'direct', 'feature', 'capability', 'decision-only'],
  ['business', 'workflow', 'architectural', 'capability', 'multi-workflow-program'],
];

for (const [nature, mode, tier, kind, expected] of cases) {
  const actual = resolveCeremonyShape(nature, mode, tier, kind);
  actual === expected
    ? rep.ok(nature + '/' + mode + '/' + tier + ' resolves to ' + expected)
    : rep.bad(nature + '/' + mode + '/' + tier + ' resolved to ' + actual + ', expected ' + expected);
  CEREMONY_SHAPES.includes(actual)
    ? rep.ok('resolved shape is in the canonical five-shape set')
    : rep.bad('resolver returned a shape outside the canonical set');
  resolveCeremonyShape(nature, mode, tier, kind) === actual
    ? rep.ok('resolver is idempotent for ' + actual)
    : rep.bad('resolver is not idempotent for ' + actual);
}

const classifierOutput = classifyWork('implement a multi-step workflow command');
const classifiedTier = classify('implement a multi-step workflow command').tier;
resolveCeremonyShape(classifierOutput.nature, classifierOutput.executionMode, classifiedTier, classifierOutput.kind)
  === 'single-workflow-operation'
  ? rep.ok('resolver consumes the classifier axes without a parallel taxonomy')
  : rep.bad('resolver/classifier axis contract did not resolve the expected operation shape');

const resolverSource = readFileSync(new URL('../templates/contextkit/methodology/resolve-ceremony-shape.mjs', import.meta.url), 'utf-8');
!resolverSource.includes('node:fs') && !resolverSource.includes('readFileSync')
  ? rep.ok('resolver is I/O-free')
  : rep.bad('resolver introduced filesystem I/O');

let rejectedNature = false;
try { resolveCeremonyShape('unknown', 'direct', 'trivial', 'fix'); } catch { rejectedNature = true; }
rejectedNature ? rep.ok('unsupported nature is refused') : rep.bad('unsupported nature was accepted');

const manifest = loadCeremonyManifest();
Object.keys(manifest.shapes).length === 5
  ? rep.ok('manifest indexes exactly five canonical shapes')
  : rep.bad('manifest shape count is not five');
Object.keys(manifest.shapes).every((shape) => existsSync(new URL('../templates/contextkit/methodology/templates/' + shape, import.meta.url)))
  ? rep.ok('all five manifest skeleton directories are present in the source package')
  : rep.bad('one or more manifest skeleton directories are missing');
existsSync(new URL('../templates/contextkit/methodology/exemplars/synthetic-single-case/README.md', import.meta.url))
  ? rep.ok('source package carries one synthetic single-case exemplar')
  : rep.bad('synthetic single-case exemplar is missing');
requiredFilesForShape('quick-fix').length === 1 && !resolveCeremonyManifest('quick-fix').workflowBearing
  ? rep.ok('quick-fix remains proportional and non-workflow-bearing')
  : rep.bad('quick-fix carries unexpected workflow files');
requiredFilesForShape('multi-workflow-program').length === 14
  ? rep.ok('multi-workflow-program carries the canonical 14-file wave pack')
  : rep.bad('multi-workflow-program does not carry exactly 14 required artifacts');
resolveCeremonyManifest('single-workflow-operation').requiredFiles.includes('continuation')
  && resolveCeremonyManifest('multi-workflow-program').requiredFiles.includes('continuation')
  ? rep.ok('every workflow-bearing shape requires continuation')
  : rep.bad('a workflow-bearing shape is missing continuation');

const sharedContinuation = readCanonicalContinuationTemplate();
const singleContinuation = readFileSync(new URL('../templates/contextkit/methodology/templates/single-workflow-operation/CONTINUATION-PROMPT.md', import.meta.url), 'utf-8');
const multiContinuation = readFileSync(new URL('../templates/contextkit/methodology/templates/multi-workflow-program/CONTINUATION-PROMPT.md', import.meta.url), 'utf-8');
sharedContinuation === singleContinuation && sharedContinuation === multiContinuation
  ? rep.ok('workflow-bearing shapes use byte-identical canonical continuation templates')
  : rep.bad('continuation templates drifted between workflow-bearing shapes');
const continuationHeaders = sharedContinuation.match(/^## .+$/gm) || [];
continuationHeaders.length === 6 && sharedContinuation.includes('Always begin with /dev-start')
  ? rep.ok('canonical continuation has six sections and opens with /dev-start')
  : rep.bad('canonical continuation section contract is incomplete');
existsSync(new URL('../templates/contextkit/memory/workflows/_TEMPLATE/workflow-plan.json', import.meta.url))
  && existsSync(new URL('../templates/contextkit/memory/workflows/_TEMPLATE/CONTINUATION-PROMPT.md', import.meta.url))
  ? rep.ok('legacy _TEMPLATE carries the wave shape and continuation prompt')
  : rep.bad('legacy _TEMPLATE was not replaced with the wave shape');
const exemplar = resolveCeremonyManifest('multi-workflow-program').exemplarRef;
exemplar && exemplar.copy === false && exemplar.priority === 'canonical' && !JSON.stringify(exemplar).match(/BIZ-\d{4}/)
  ? rep.ok('multi-workflow exemplar is a canonical read-only pointer without dogfood bytes')
  : rep.bad('multi-workflow exemplar pointer is unsafe or copied');

for (const shape of Object.keys(manifest.shapes)) {
  const skeletonDir = fileURLToPath(new URL('../templates/contextkit/methodology/' + manifest.shapes[shape].skeleton, import.meta.url));
  validateStructure(skeletonDir, shape).ok
    ? rep.ok('structure validator accepts the ' + shape + ' skeleton')
    : rep.bad('structure validator rejected the ' + shape + ' skeleton');
}

const structureFixture = mkdtempSync(join(tmpdir(), 'methodology-shape-it-'));
try {
  for (const artifactId of requiredFilesForShape('single-workflow-operation')) {
    const filename = artifactId === 'reports' ? 'reports/' : ({
      index: 'index.md', prd: 'prd.md', spec: 'spec.md', decisions: 'decisions.md',
      tasks: 'tasks.md', 'tasks-json': 'tasks.json', continuation: 'CONTINUATION-PROMPT.md',
      'workflow-plan': 'workflow-plan.json', 'workflow-state': 'workflow-state.json',
    }[artifactId]);
    const fullPath = join(structureFixture, filename);
    if (filename.endsWith('/')) mkdirSync(fullPath, { recursive: true });
    else { mkdirSync(join(fullPath, '..'), { recursive: true }); writeFileSync(fullPath, 'ready\n'); }
  }
  rmSync(join(structureFixture, 'CONTINUATION-PROMPT.md'), { force: true });
  !validateStructure(structureFixture, 'single-workflow-operation').ok
    ? rep.ok('structure validator rejects a divergent workflow tree')
    : rep.bad('structure validator accepted a tree missing continuation');

  const tokenPath = join(structureFixture, 'token.md');
  const dogfoodPath = join(structureFixture, 'dogfood.md');
  writeFileSync(tokenPath, 'unrendered {{TOKEN}}\n');
  writeFileSync(dogfoodPath, 'private BIZ-0006 and ADR-0148\n');
  !leakScrub(tokenPath).ok ? rep.ok('leak scrub rejects an unresolved token') : rep.bad('leak scrub accepted an unresolved token');
  !leakScrub(dogfoodPath).ok ? rep.ok('leak scrub rejects dogfood identifiers') : rep.bad('leak scrub accepted dogfood identifiers');
} finally {
  rmSync(structureFixture, { recursive: true, force: true });
}

rep.finish('methodology-shapes');
