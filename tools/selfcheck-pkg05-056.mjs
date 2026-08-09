#!/usr/bin/env node
/**
 * Focused host-projection and parity checks for WF-0111 W12.
 *
 * Covers manifest validation, non-Git/Windows generation, idempotence, content
 * drift, deterministic orphan cleanup, missing-source refusal, and byte-identical
 * Claude/Codex/Antigravity governance contracts.
 */
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  selectHostProjectionRules,
  validateHostProjectionManifest,
} from '../templates/contextkit/methodology/projections.mjs';
import { runCodexProjectionGeneration } from '../templates/contextkit/runtime/codex/convert-all.mjs';
import { runAntigravityProjectionGeneration } from '../templates/contextkit/runtime/antigravity/convert-all.mjs';
import { checkParity, renderParity } from '../templates/contextkit/tools/scripts/host-parity.mjs';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODEX_CONVERTER = join(KIT, 'templates/contextkit/runtime/codex/convert-all.mjs');
let failures = 0;
const assert = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
};

/** Recursively snapshots file content under a directory. */
async function snapshot(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(entryPath, base));
    else files[relative(base, entryPath).replaceAll('\\', '/')] = await readFile(entryPath, 'utf8');
  }
  return files;
}

/** Creates a minimal manifest-complete source tree without initializing Git. */
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cdk-host-projections-'));
  const copyPairs = [
    ['templates/contextkit/policy/host-projections.json', 'templates/contextkit/policy/host-projections.json'],
    ['templates/CLAUDE.md.tpl', 'templates/CLAUDE.md.tpl'],
    ['templates/AGENTS.md.tpl', 'templates/AGENTS.md.tpl'],
    ['templates/INSTRUCTIONS.md.tpl', 'templates/INSTRUCTIONS.md.tpl'],
  ];
  for (const [sourceRelative, targetRelative] of copyPairs) {
    const targetPath = join(root, targetRelative);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(join(KIT, sourceRelative), targetPath);
  }
  const fixtureFiles = {
    'templates/claude/commands/demo.md': '---\ndescription: Demo command\n---\n\nRun the demo.\n',
    'templates/claude/agents/demo.md': '---\nname: demo\ndescription: Demo agent\nmodel: inherit\n---\n\nKeep the demo bounded.\n',
    'templates/contextkit/workflows/playbooks/demo.md': '# Demo playbook\n',
    'templates/contextkit/workflows/README.md': '# Workflow guide\n',
    'templates/contextkit/policy/routing-policy.json': '{"tiers":{},"hostModels":{"codex":{}}}\n',
  };
  for (const [targetRelative, content] of Object.entries(fixtureFiles)) {
    const targetPath = join(root, targetRelative);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf8');
  }
  return root;
}

console.log('\nSection 1: manifest contract');
const manifest = validateHostProjectionManifest(JSON.parse(await readFile(
  join(KIT, 'templates/contextkit/policy/host-projections.json'),
  'utf8',
)));
assert('declares exactly Claude, Codex, and Antigravity', Object.keys(manifest.hosts).sort().join(',') === 'antigravity,claude,codex');
assert('declares all five cross-host invariants', manifest.requiredContracts.length === 5);
assert('Codex converter receives only manifest-declared rules', selectHostProjectionRules(manifest, 'codex', 'templates', 'codex-converter').length === 2);
assert('Antigravity converter receives only manifest-declared rules', selectHostProjectionRules(manifest, 'antigravity', 'templates', 'antigravity-converter').length === 4);
let traversalRejected = false;
try {
  const unsafe = structuredClone(manifest);
  unsafe.hosts.codex.projections[0].source.templates = '../outside';
  validateHostProjectionManifest(unsafe);
} catch {
  traversalRejected = true;
}
assert('manifest refuses traversal-shaped source paths', traversalRejected);

const fixture = await createFixture();
try {
  console.log('\nSection 2: non-Git generation and idempotence');
  const initialCodex = await runCodexProjectionGeneration({ root: fixture, mode: 'templates', check: true });
  const initialAntigravity = await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates', check: true });
  assert('fresh non-Git fixture reports missing Codex projections', !initialCodex.ok && initialCodex.drift.some((item) => item.reason === 'missing'));
  assert('fresh non-Git fixture reports missing Antigravity projections', !initialAntigravity.ok && initialAntigravity.drift.some((item) => item.reason === 'missing'));

  await runCodexProjectionGeneration({ root: fixture, mode: 'templates' });
  await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates' });
  const firstSnapshot = await snapshot(join(fixture, 'templates'));
  await runCodexProjectionGeneration({ root: fixture, mode: 'templates' });
  await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates' });
  const secondSnapshot = await snapshot(join(fixture, 'templates'));
  assert('second regeneration is byte-idempotent', JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot));
  assert('Codex check is green after regeneration', (await runCodexProjectionGeneration({ root: fixture, mode: 'templates', check: true })).ok);
  assert('Antigravity check is green after regeneration', (await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates', check: true })).ok);

  console.log('\nSection 3: drift and orphan repair');
  const codexSkill = join(fixture, 'templates/codex/skills/source-command-demo/SKILL.md');
  await writeFile(codexSkill, 'drifted\n', 'utf8');
  const codexDrift = await runCodexProjectionGeneration({ root: fixture, mode: 'templates', check: true });
  assert('content drift fails Codex check', !codexDrift.ok && codexDrift.drift.some((item) => item.reason === 'content'));
  const driftCli = spawnSync(process.execPath, [CODEX_CONVERTER, '--templates', '--check'], { cwd: fixture, encoding: 'utf8' });
  assert('content drift makes the converter CLI exit nonzero', driftCli.status === 1);
  await runCodexProjectionGeneration({ root: fixture, mode: 'templates' });
  const cleanCli = spawnSync(process.execPath, [CODEX_CONVERTER, '--templates', '--check'], { cwd: fixture, encoding: 'utf8' });
  assert('clean converter CLI exits zero', cleanCli.status === 0);

  const codexOrphan = join(fixture, 'templates/codex/skills/source-command-orphan/SKILL.md');
  const antigravityOrphan = join(fixture, 'templates/antigravity/skills/orphan.md');
  await mkdir(dirname(codexOrphan), { recursive: true });
  await mkdir(dirname(antigravityOrphan), { recursive: true });
  await writeFile(codexOrphan, 'orphan\n', 'utf8');
  await writeFile(antigravityOrphan, 'orphan\n', 'utf8');
  assert('Codex orphan fails check', !(await runCodexProjectionGeneration({ root: fixture, mode: 'templates', check: true })).ok);
  assert('Antigravity orphan fails check', !(await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates', check: true })).ok);
  await runCodexProjectionGeneration({ root: fixture, mode: 'templates' });
  await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates' });
  assert('normal regeneration removes Codex orphan deterministically', !(await snapshot(join(fixture, 'templates/codex/skills')))['source-command-orphan/SKILL.md']);
  assert('normal regeneration removes Antigravity orphan deterministically', !(await snapshot(join(fixture, 'templates/antigravity/skills')))['orphan.md']);

  console.log('\nSection 4: missing-source refusal');
  const beforeMissingSource = await snapshot(join(fixture, 'templates/codex'));
  await rm(join(fixture, 'templates/claude/commands'), { recursive: true, force: true });
  let missingSourceRejected = false;
  try {
    await runCodexProjectionGeneration({ root: fixture, mode: 'templates' });
  } catch (error) {
    missingSourceRejected = /projection source is unavailable/.test(error.message);
  }
  assert('missing declared source fails generation', missingSourceRejected);
  const missingSourceCli = spawnSync(process.execPath, [CODEX_CONVERTER, '--templates'], { cwd: fixture, encoding: 'utf8' });
  assert('missing declared source makes the converter CLI exit nonzero', missingSourceCli.status === 1);
  assert('missing-source failure performs no output mutation', JSON.stringify(beforeMissingSource) === JSON.stringify(await snapshot(join(fixture, 'templates/codex'))));

  console.log('\nSection 5: same host contract and strict parity receipt');
  await mkdir(join(fixture, 'templates/claude/commands'), { recursive: true });
  await writeFile(join(fixture, 'templates/claude/commands/demo.md'), '---\ndescription: Demo command\n---\n\nRun the demo.\n', 'utf8');
  await runCodexProjectionGeneration({ root: fixture, mode: 'templates' });
  await runAntigravityProjectionGeneration({ root: fixture, mode: 'templates' });
  const parity = await checkParity(fixture);
  assert('same gate/intake/context/state/routing contract passes', parity.ok && parity.loads.every((row) => row.verdict === 'parity'));
  assert('parity report covers only the three declared hosts', parity.contracts.map((entry) => entry.host).join(',') === 'claude,codex,antigravity');
  assert('rendered receipt includes projection drift counts', /\| Projection host \| Declared outputs \| Drift \| Orphans \|/.test(renderParity(parity)));

  const agentsTemplate = join(fixture, 'templates/AGENTS.md.tpl');
  await writeFile(agentsTemplate, (await readFile(agentsTemplate, 'utf8')).replace('mutation-only-intake', 'drifted-intake'), 'utf8');
  const contractDrift = await checkParity(fixture);
  assert('host contract drift fails parity', !contractDrift.ok && contractDrift.gaps.some((gap) => gap.includes('host contract drift')));

  assert('fixture remained non-Git throughout', (await readdir(fixture)).includes('.git') === false);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log(failures === 0
  ? '\nPASS - host projection manifest/parity checks green.\n'
  : `\nFAIL - ${failures} host projection check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
