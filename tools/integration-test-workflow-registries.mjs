/**
 * Integration test for the universal wave workflow engine registries + resolvers
 * (WF0035, W1-T1, ADR-0100 §5). Standalone runnable: exercises the four versioned
 * registries through their pure resolver modules and asserts deterministic,
 * fail-fast behavior. No install fixture, no I/O beyond reading the shipped JSON.
 *
 * Run: node tools/integration-test-workflow-registries.mjs  (exits 0 on green).
 */
import { strict as assert } from 'node:assert';
import { reporter } from './it-helpers.mjs';
import {
  loadProfileRegistry,
  resolveProfile,
  listProfiles,
  requiredFilesFor,
} from '../templates/contextkit/tools/scripts/workflow/profiles.mjs';
import {
  loadFileCatalog,
  explainFile,
  requiredFiles,
} from '../templates/contextkit/tools/scripts/workflow/files.mjs';
import {
  loadWavePatterns,
  resolvePattern,
  waveSkeleton,
  listPatterns,
} from '../templates/contextkit/tools/scripts/workflow/patterns.mjs';
import {
  loadAddonRegistry,
  resolveAddon,
  addonRequirements,
  listAddons,
} from '../templates/contextkit/tools/scripts/workflow/addons.mjs';

const rep = reporter();

/** Assert that `fn` throws an Error whose message mentions `needle`. */
function throwsWith(fn, needle, label) {
  try {
    fn();
    rep.bad(`${label}: expected a throw, none happened`);
  } catch (error) {
    if (error instanceof Error && error.message.includes(needle)) rep.ok(label);
    else rep.bad(`${label}: wrong error "${error.message}"`);
  }
}

// --- Profiles -------------------------------------------------------------
try {
  const registry = loadProfileRegistry();
  registry.schemaVersion === 1 ? rep.ok('profile registry schemaVersion = 1') : rep.bad('profile schemaVersion');

  const expectedProfiles = ['pipeline-only', 'basic', 'standard', 'advanced', 'program'].sort();
  assert.deepEqual(listProfiles(), expectedProfiles);
  rep.ok('all 5 profiles listed and sorted');

  for (const name of expectedProfiles) {
    const profile = resolveProfile(name);
    assert.ok(Array.isArray(profile.requiredFiles), `${name} requiredFiles[]`);
    assert.ok(typeof profile.continuationRequired === 'boolean', `${name} continuationRequired`);
  }
  rep.ok('every profile resolves with the expected shape');

  const programRequired = requiredFilesFor('program');
  assert.ok(programRequired.includes('risk-register'), 'program requires risk-register');
  assert.ok(programRequired.includes('workflow-plan') && programRequired.includes('workflow-state'));
  rep.ok('requiredFilesFor(program) includes risk-register + machine contracts');

  throwsWith(() => resolveProfile('nope'), 'Unknown workflow profile', 'unknown profile throws clearly');
} catch (error) {
  rep.bad(`profiles block threw: ${error.message}`);
}

// --- File catalog ---------------------------------------------------------
try {
  loadFileCatalog().schemaVersion === 1 ? rep.ok('file catalog schemaVersion = 1') : rep.bad('catalog schemaVersion');

  const risk = explainFile('risk-register');
  assert.equal(risk.filename, 'risk-register.md');
  assert.ok(risk.purpose.length > 0 && risk.whenToRead.length > 0);
  assert.ok(Array.isArray(risk.mustNotDuplicate));
  rep.ok('explainFile(risk-register) returns purpose/whenToRead/mustNotDuplicate');

  // required() folds add-on files in: research-evidence makes evidence-register required.
  const basicFiles = requiredFiles({ profile: 'basic', addons: ['research-evidence'] });
  assert.ok(basicFiles.includes('evidence-register'), 'add-on file folded into required set');
  rep.ok('requiredFiles folds add-on artifacts into the set');

  throwsWith(() => explainFile('ghost-file'), 'Unknown workflow artifact', 'unknown artifact throws clearly');
  throwsWith(() => requiredFiles({}), 'non-empty "profile"', 'requiredFiles refuses a missing profile');
} catch (error) {
  rep.bad(`file-catalog block threw: ${error.message}`);
}

// --- Wave patterns --------------------------------------------------------
try {
  const registry = loadWavePatterns();
  registry.schemaVersion === 1 ? rep.ok('wave-patterns schemaVersion = 1') : rep.bad('patterns schemaVersion');

  const expectedPatterns = [
    'single-delivery', 'discovery-build-validate', 'architecture-foundation-integration',
    'incident-hotfix', 'database-migration', 'research-benchmark', 'release-upgrade',
    'multi-host-integration', 'large-program',
  ].sort();
  assert.deepEqual(listPatterns(), expectedPatterns);
  rep.ok('all 9 wave patterns listed and sorted');

  for (const id of expectedPatterns) {
    const pattern = resolvePattern(id);
    assert.equal(pattern.id, id, `${id} carries its id`);
    assert.ok(Array.isArray(pattern.waveTemplates), `${id} waveTemplates[]`);
  }
  rep.ok('every pattern resolves with id + waveTemplates');

  assert.equal(waveSkeleton('single-delivery').length, 1, 'single-delivery = 1 wave');
  assert.equal(waveSkeleton('architecture-foundation-integration').length, 6, 'arch pattern = 6 waves');
  assert.equal(waveSkeleton('large-program').length, 0, 'large-program is an empty skeleton');
  rep.ok('waveSkeleton returns the expected wave counts');

  throwsWith(() => resolvePattern('mystery'), 'Unknown wave pattern', 'unknown pattern throws clearly');
} catch (error) {
  rep.bad(`wave-patterns block threw: ${error.message}`);
}

// --- Add-ons --------------------------------------------------------------
try {
  loadAddonRegistry().schemaVersion === 1 ? rep.ok('addon-registry schemaVersion = 1') : rep.bad('addon schemaVersion');

  const expectedAddons = [
    'research-evidence', 'benchmark', 'release', 'migration', 'compliance',
    'security', 'host-integration', 'database-migration', 'async-runtime',
  ].sort();
  assert.deepEqual(listAddons(), expectedAddons);
  rep.ok('all 9 add-ons listed and sorted');

  for (const id of expectedAddons) {
    const addon = resolveAddon(id);
    assert.equal(addon.id, id, `${id} carries its id`);
    assert.ok(Array.isArray(addon.additionalFiles), `${id} additionalFiles[]`);
  }
  rep.ok('every add-on resolves with id + additionalFiles');

  const bundle = addonRequirements(['security', 'release']);
  assert.ok(bundle.additionalFiles.includes('threat-model') && bundle.additionalFiles.includes('release-plan'));
  assert.deepEqual(bundle.additionalFiles, [...bundle.additionalFiles].sort(), 'bundle files sorted');
  rep.ok('addonRequirements aggregates + sorts across multiple add-ons');

  throwsWith(() => resolveAddon('imaginary'), 'Unknown workflow add-on', 'unknown add-on throws clearly');
} catch (error) {
  rep.bad(`addon block threw: ${error.message}`);
}

// --- Determinism: resolve twice => deep-equal -----------------------------
try {
  assert.deepEqual(resolveProfile('program'), resolveProfile('program'));
  assert.deepEqual(requiredFilesFor('program'), requiredFilesFor('program'));
  assert.deepEqual(resolvePattern('incident-hotfix'), resolvePattern('incident-hotfix'));
  assert.deepEqual(addonRequirements(['security', 'release']), addonRequirements(['security', 'release']));
  assert.deepEqual(explainFile('risk-register'), explainFile('risk-register'));
  rep.ok('resolver output is stable across repeated calls (deep-equal)');
} catch (error) {
  rep.bad(`determinism block threw: ${error.message}`);
}

rep.finish('workflow-registries');
