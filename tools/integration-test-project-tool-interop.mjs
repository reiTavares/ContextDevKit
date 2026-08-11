#!/usr/bin/env node
/**
 * WF-0116 T-001 integration checks for passive CompozyOS and Graphify detection.
 * The detector is exercised against real filesystem fixtures and must never run
 * an external process, access the network, or mutate the inspected workspace.
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '..');
const detectorPath = resolve(KIT_ROOT, 'templates/contextkit/runtime/integrations/project-tools.mjs');
const providerPath = resolve(KIT_ROOT, 'templates/contextkit/runtime/graph/provider.mjs');
const graphCliPath = resolve(KIT_ROOT, 'templates/contextkit/tools/scripts/graph.mjs');

let failures = 0;

/** @param {string} name @param {boolean} passed @param {string} [detail] @returns {void} */
function check(name, passed, detail = '') {
  process.stdout.write(`  ${passed ? 'ok' : 'XX'} ${name}${detail ? ` -- ${detail}` : ''}\n`);
  if (!passed) failures += 1;
}

/** @param {string} root @param {string} relativePath @param {string} contents @returns {string} */
function writeFixture(root, relativePath, contents) {
  const targetPath = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents, 'utf-8');
  return targetPath;
}

/** @param {string} root @returns {Array<{path:string,size:number,mtimeMs:number}>} */
function snapshotRegularFiles(root) {
  const snapshot = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) {
        const fileStats = statSync(absolutePath);
        snapshot.push({
          path: relative(root, absolutePath).replaceAll('\\', '/'),
          size: fileStats.size,
          mtimeMs: fileStats.mtimeMs,
        });
      }
    }
  };
  visit(root);
  return snapshot.sort((left, right) => left.path.localeCompare(right.path));
}

let projectTools;
let graphProvider;
let graphCli;
try {
  projectTools = await import(pathToFileURL(detectorPath).href);
  graphProvider = await import(pathToFileURL(providerPath).href);
  graphCli = await import(pathToFileURL(graphCliPath).href);
  check('detector module imports', true);
  check('graph provider modules import', true);
} catch (error) {
  check('interoperability modules import', false, error?.message ?? String(error));
  process.stdout.write(`\nFAIL -- ${failures} failure(s)\n`);
  process.exit(1);
}

const absentRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-absent-'));
try {
  const receipt = projectTools.detectProjectTools(absentRoot);
  check('absent CompozyOS is explicit', receipt.compozy.status === 'not_detected');
  check('absent Graphify is explicit', receipt.graphify.status === 'not_detected');
  check('detection receipt proves no mutation', receipt.mutation === false);
} finally {
  rmSync(absentRoot, { recursive: true, force: true });
}

const readyRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-ready-'));
try {
  writeFixture(readyRoot, '.compozy/config.toml', '[workspace]\nname = "fixture"\n');
  writeFixture(readyRoot, 'graphify-out/graph.json', JSON.stringify({
    directed: true,
    multigraph: false,
    graph: {},
    nodes: [{ id: 'AuthService', label: 'AuthService', source_file: 'src/auth/service.mjs' }],
    links: [],
  }));
  const beforeSnapshot = snapshotRegularFiles(readyRoot);
  const receipt = projectTools.detectProjectTools(readyRoot);
  const afterSnapshot = snapshotRegularFiles(readyRoot);
  check('CompozyOS marker is detected but not trusted', receipt.compozy.status === 'detected_unverified');
  check('Graphify artifact is ready for read-only use', receipt.graphify.status === 'ready_read_only');
  check('Graphify artifact exposes bounded metadata', receipt.graphify.artifact?.nodeCount === 1 && receipt.graphify.artifact?.edgeCount === 0);
  check('passive detection leaves fixture byte-for-byte metadata unchanged', JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot));
} finally {
  rmSync(readyRoot, { recursive: true, force: true });
}

const malformedRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-malformed-'));
try {
  writeFixture(malformedRoot, 'graphify-out/graph.json', '{not-json');
  const malformedReceipt = projectTools.detectProjectTools(malformedRoot);
  check('malformed Graphify JSON is unavailable', malformedReceipt.graphify.status === 'unavailable'
    && malformedReceipt.graphify.reason === 'graphify_graph_invalid_json');

  writeFixture(malformedRoot, 'graphify-out/graph.json', JSON.stringify({ nodes: [], links: [] }));
  const oversizedReceipt = projectTools.detectProjectTools(malformedRoot, { maxGraphBytes: 1 });
  check('oversized Graphify artifact is unavailable', oversizedReceipt.graphify.status === 'unavailable'
    && oversizedReceipt.graphify.reason === 'graphify_graph_oversized');
} finally {
  rmSync(malformedRoot, { recursive: true, force: true });
}

const providerRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-provider-'));
try {
  writeFixture(providerRoot, 'src/auth/service.mjs', 'export class AuthService {}\nexport function FallbackOnly() {}\n');
  writeFixture(providerRoot, 'graphify-out/graph.json', JSON.stringify({
    directed: true,
    multigraph: false,
    graph: {},
    nodes: [
      { id: 'AuthService', label: 'Autenticação', source_file: 'src/auth/service.mjs' },
      { id: 'EscapeAttempt', label: 'EscapeAttempt', source_file: '../outside.mjs' },
    ],
    links: [],
  }));

  const graphifyResult = graphProvider.createGraphifyGraphProvider(providerRoot).query({ query: 'autenticação' });
  check('Graphify matches Unicode labels', graphifyResult.anchors[0] === 'src/auth/service.mjs');
  check('Graphify remains explicitly partial', graphifyResult.status === 'partial'
    && graphifyResult.coverage.status === 'partial');
  const rejectedResult = graphProvider.createGraphifyGraphProvider(providerRoot).query({ query: 'EscapeAttempt' });
  check('Graphify rejects escaping source anchors', rejectedResult.anchors.length === 0
    && rejectedResult.artifact.rejectedAnchorCount === 1);

  const graphifyFirst = graphCli.dispatch(providerRoot, 'query', { flags: {}, positionals: ['AuthService'] });
  check('default discovery order starts with Graphify', graphifyFirst.attempts[0]?.provider === 'graphify');
  check('Graphify anchors keep first-provider provenance', graphifyFirst.provider === 'graphify'
    && graphifyFirst.matches.includes('src/auth/service.mjs'));
  check('partial Graphify evidence releases native and Project Map providers',
    graphifyFirst.provenance.providerOrder.join(',') === 'graphify,native,project-map-find');

  const projectMapFallback = graphCli.dispatch(providerRoot, 'query', { flags: {}, positionals: ['FallbackOnly'] });
  check('Project Map find is the terminal fallback', projectMapFallback.provider === 'project-map-find'
    && projectMapFallback.matches.includes('src/auth/service.mjs'));
  check('provider-chain receipt is read-only and non-denying', projectMapFallback.mutation === false
    && projectMapFallback.denied === false && projectMapFallback.searchAllowed === true);
} finally {
  rmSync(providerRoot, { recursive: true, force: true });
}

const nativeFallbackRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-native-'));
try {
  writeFixture(nativeFallbackRoot, 'contextkit/memory/project-map/manifest.json', JSON.stringify({ signature: 'native-fixture' }));
  writeFixture(nativeFallbackRoot, 'contextkit/memory/project-map/graph/graph.json', JSON.stringify({
    projectMapSignature: 'native-fixture',
    nodes: [{ id: 'native:NativeOnly', label: 'NativeOnly', sourceFile: 'src/native.mjs' }],
    edges: [],
    coverage: { status: 'complete', pendingPaths: [] },
  }));
  const nativeFallback = graphCli.dispatch(nativeFallbackRoot, 'query', { flags: {}, positionals: ['NativeOnly'] });
  check('missing Graphify falls back to the native ContextDevKit graph', nativeFallback.provider === 'native'
    && nativeFallback.provenance.providerOrder.join(',') === 'graphify,native');
} finally {
  rmSync(nativeFallbackRoot, { recursive: true, force: true });
}

const conflictRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-conflict-'));
try {
  writeFixture(conflictRoot, 'graphify-out/graph.json', JSON.stringify({ nodes: [], edges: [] }));
  writeFixture(conflictRoot, '.agents/skills/graphify/SKILL.md', '# Graphify\n');
  writeFixture(conflictRoot, 'AGENTS.md', 'Graphify must run before reading files.\n');
  writeFixture(conflictRoot, '.codex/hooks.json', JSON.stringify({ hooks: [{ command: 'graphify hook-check' }] }));
  const receipt = projectTools.detectProjectTools(conflictRoot);
  const conflictCodes = receipt.graphify.conflicts.map((conflict) => conflict.code);
  check('Graphify project skill is reported as a marker', receipt.graphify.markers.some((marker) => marker.kind === 'skill'));
  check('foreign instruction overlap is reported', conflictCodes.includes('graphify_instruction_overlap'));
  check('foreign hook overlap is reported', conflictCodes.includes('graphify_hook_overlap'));
  check('conflicts do not erase artifact readiness', receipt.graphify.artifact?.status === 'ready_read_only');
} finally {
  rmSync(conflictRoot, { recursive: true, force: true });
}

const junctionRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-junction-'));
const outsideRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-outside-'));
try {
  writeFixture(outsideRoot, 'graph.json', JSON.stringify({ nodes: [], links: [] }));
  try {
    symlinkSync(outsideRoot, join(junctionRoot, 'graphify-out'), process.platform === 'win32' ? 'junction' : 'dir');
    const receipt = projectTools.detectProjectTools(junctionRoot);
    check('junction escape is rejected', receipt.graphify.status === 'unavailable'
      && receipt.graphify.reason === 'graphify_graph_path_escape');
  } catch (error) {
    check('junction escape fixture is supported or explicitly skipped', ['EPERM', 'EACCES'].includes(error?.code), error?.code ?? String(error));
  }
} finally {
  rmSync(junctionRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
}

const detectorSource = readFileSync(detectorPath, 'utf-8');
check('detector has no process execution dependency', !detectorSource.includes('node:child_process'));
check('detector has no network dependency', !/node:(?:http|https|net|tls)/.test(detectorSource));
check('detector imports no filesystem mutator', !/\b(?:writeFile|mkdir|rename|rm|unlink|copyFile)(?:Sync)?\b/.test(
  detectorSource.split('\n').filter((line) => line.trimStart().startsWith('import ')).join('\n'),
));
const regularRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-regular-'));
try {
  check('fixture marker is a regular file', lstatSync(writeFixture(regularRoot, 'marker', 'ok')).isFile());
} finally {
  rmSync(regularRoot, { recursive: true, force: true });
}

const installRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-interop-install-'));
try {
  const compozyContents = '[workspace]\nname = "install-fixture"\n';
  const graphifyContents = JSON.stringify({
    directed: true,
    multigraph: false,
    graph: {},
    nodes: [{ id: 'InstallFixture', label: 'InstallFixture', source_file: 'src/install.mjs' }],
    links: [],
  });
  writeFixture(installRoot, '.compozy/config.toml', compozyContents);
  writeFixture(installRoot, 'graphify-out/graph.json', graphifyContents);
  writeFixture(installRoot, 'AGENTS.md', '# Owner instructions\nGraphify may provide structural context.\n');
  const installation = spawnSync(process.execPath, [
    resolve(KIT_ROOT, 'install.mjs'),
    '--target', installRoot,
    '--level', '1',
    '--name', 'Interop Fixture',
    '--yes',
  ], { encoding: 'utf-8' });
  const installOutput = `${installation.stdout ?? ''}${installation.stderr ?? ''}`;
  check('installer succeeds with CompozyOS and Graphify present', installation.status === 0, installOutput.slice(-500));
  check('installer reports passive CompozyOS coexistence', installOutput.includes('CompozyOS detected: passive coexistence enabled'));
  check('installer reports Graphify-first discovery', installOutput.includes('graphify -> native -> project-map-find'));
  check('installer preserves CompozyOS config bytes', readFileSync(join(installRoot, '.compozy/config.toml'), 'utf-8') === compozyContents);
  check('installer preserves Graphify artifact bytes', readFileSync(join(installRoot, 'graphify-out/graph.json'), 'utf-8') === graphifyContents);
  check('installer preserves owner Graphify instructions', readFileSync(join(installRoot, 'AGENTS.md'), 'utf-8').includes('Graphify may provide structural context.'));

  const doctor = spawnSync(process.execPath, [
    join(installRoot, 'contextkit/tools/scripts/doctor.mjs'),
  ], { cwd: installRoot, encoding: 'utf-8' });
  const doctorOutput = `${doctor.stdout ?? ''}${doctor.stderr ?? ''}`;
  check('doctor reports CompozyOS coexistence authority', doctorOutput.includes('CompozyOS detected in passive coexistence mode')
    && doctorOutput.includes('ContextDevKit remains the sole governance authority'));
  check('doctor reports Graphify readiness and overlap', doctorOutput.includes('Graphify artifact ready for read-only file discovery')
    && doctorOutput.includes('Graphify overlaps'));
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}

process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} -- ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
