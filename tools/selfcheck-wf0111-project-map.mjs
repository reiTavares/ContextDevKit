#!/usr/bin/env node
/** Focused W10 checks: typed roots, governed memory, providers and fallback. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, '..');
const moduleUrl = (path) => pathToFileURL(resolve(KIT, path)).href;

const roots = await import(moduleUrl('templates/contextkit/tools/scripts/project-map-roots.mjs'));
const core = await import(moduleUrl('templates/contextkit/tools/scripts/project-map-core.mjs'));
const dense = await import(moduleUrl('templates/contextkit/tools/scripts/project-map-dense.mjs'));
const governance = await import(moduleUrl('templates/contextkit/runtime/graph/governance-index.mjs'));
const provider = await import(moduleUrl('templates/contextkit/runtime/graph/provider.mjs'));
const graphProjection = await import(moduleUrl('templates/contextkit/tools/scripts/project-map-graph.mjs'));
const graphCli = await import(moduleUrl('templates/contextkit/tools/scripts/graph.mjs'));

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`${pass ? '  ok' : '  XX'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!pass) failures += 1;
};
const write = (root, path, content) => {
  const target = join(root, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf-8');
};

const fixture = mkdtempSync(join(tmpdir(), 'wf0111-project-map-'));
try {
  write(fixture, 'src/nested/service.mjs', 'export function governedService() { return true; }\n');
  write(fixture, 'outside/ignored.mjs', 'export function outsideConfiguredRoot() {}\n');
  write(fixture, 'contextkit/memory/business/BIZ-0001-product/business.json', JSON.stringify({ id: 'BIZ-0001' }));
  write(fixture, 'contextkit/memory/operations/OP-0004-ownership/done/WF-0059-store/spec.md', '# WF-0059\n');
  write(fixture, 'contextkit/memory/operations/OP-0004-ownership/reports/cutover.md', '# Cutover report\n');
  write(fixture, 'contextkit/memory/decisions/operations/ADR-0158-governance.md', 'primaryContext: OP-0004\nrelated: WF-0059\n');
  write(fixture, 'contextkit/memory/preferences/owner-preferences.json', JSON.stringify({ concise: true }));
  write(fixture, 'contextkit/pipeline/tasks.json', JSON.stringify({ tasks: [{ id: 419, workflow: 'WF-0059', status: 'working' }] }));
  write(fixture, 'contextkit/config.json', JSON.stringify({ projectMap: { roots: ['src\\nested'] } }));
  write(fixture, 'contextkit/memory/project-map/manifest.json', JSON.stringify({ signature: 'fixture-signature', modules: [] }));

  const config = { projectMap: { roots: ['src\\nested'] } };
  const resolved = roots.resolveRoots(config, fixture);
  check('typed source root normalizes Windows separators', resolved.sourceRoots[0]?.kind === 'source' && resolved.sourceRoots[0]?.path === 'src/nested');
  check('governance root is explicit despite source exclusion', resolved.governanceRoots.some((entry) => entry.kind === 'governance' && entry.path === 'contextkit/memory'));
  check('each root carries portable per-root excludes', resolved.roots.every((entry) => !entry.path.includes('\\') && Array.isArray(entry.excludes.deep) && Array.isArray(entry.excludes.rootRelative)));
  check('path escape is refused to safe default', roots.resolveRoots({ projectMap: { roots: ['..\\escape'] } }, fixture).sourceRoots[0]?.path === '.');
  check('non-Git fixture is supported', !existsSync(join(fixture, '.git')));

  const model = core.scanProject(fixture, 0, config);
  check('scanProject consumes configured source roots', model.modules.some((entry) => entry.path === 'src/nested') && !model.modules.some((entry) => entry.path.startsWith('outside')));
  check('scanProject reports explicit complete coverage', model.coverage.status === 'complete' && model.coverage.roots[0]?.path === 'src/nested');

  const index = dense.buildDenseIndex(fixture, config);
  check('buildDenseIndex consumes configured source roots', index.bySymbol.governedService?.includes('src/nested/service.mjs') && !index.bySymbol.outsideConfiguredRoot);
  check('dense coverage is explicit', index.coverage.status === 'complete' && index.coverage.roots[0]?.kind === 'source');

  const governed = governance.buildGovernanceLayer(fixture);
  const kindSet = new Set(governed.nodes.map((node) => node.kind));
  check('all required governance node kinds are emitted', ['business', 'operation', 'workflow', 'task', 'decision', 'report', 'preference'].every((kind) => kindSet.has(kind)), [...kindSet].sort().join(','));
  check('nested OP/WF/ADR are discoverable', ['operation:OP-0004', 'workflow:WF-0059', 'adr:0158'].every((id) => governed.nodes.some((node) => node.id === id)));
  check('governance hierarchy edge kinds are emitted', ['owns', 'tracks', 'governed_by', 'has_report', 'documented_by'].every((relation) => governed.edges.some((edge) => edge.relation === relation)));
  check('gitignored memory coverage is complete', governed.coverage.status === 'complete' && governed.coverage.indexedPaths.some((path) => path.includes('OP-0004')));

  const partialLayer = governance.buildGovernanceLayer(fixture, null, { maxFileBytes: 1 });
  check('size limits are honest partial coverage', partialLayer.coverage.status === 'partial' && partialLayer.coverage.pendingPaths.length > 0);

  const full = await graphProjection.buildFullProjection(fixture);
  const written = graphProjection.writeCommittedProjection(fixture, full, { apply: true });
  check('full projection composes governance and configured source-symbol types', written.layers.includes('governance')
    && written.nodes.some((node) => node.nodeType === 'source-symbol' && node.id.includes('governedService'))
    && !written.nodes.some((node) => node.id.includes('outsideConfiguredRoot')));
  check('projection records Project Map signature and coverage', written.projectMapSignature === 'fixture-signature' && written.coverage.status === 'complete');

  for (const query of ['OP-0004', 'WF-0059', 'ADR-0158', '419']) {
    const queryResult = provider.queryProjectGraph({ root: fixture, query });
    check(`native graph query finds ${query}`, queryResult.status === 'available' && queryResult.matches.length > 0, JSON.stringify(queryResult.matches));
  }

  let fallbackCalls = 0;
  const ordinarySearch = () => { fallbackCalls += 1; return ['grep-anchor']; };
  for (const [status, graphProvider] of [
    ['partial', { name: 'external', query: () => ({ status: 'partial', anchors: ['workflow:WF-0059'], reason: 'coverage gap' }) }],
    ['stale', { name: 'external', query: () => ({ status: 'stale', reason: 'old index' }) }],
    ['unavailable', { name: 'external', query: () => { throw new Error('offline'); } }],
  ]) {
    const response = provider.queryProjectGraph({ root: fixture, query: 'WF-0059' }, { provider: graphProvider, fallback: ordinarySearch });
    check(`${status} provider triggers immediate non-denying fallback`, response.status === status && response.fallback.required && response.fallback.invoked && response.searchAllowed && response.denied === false);
  }
  check('fallback called exactly once per incomplete provider', fallbackCalls === 3, String(fallbackCalls));

  const externalAvailable = provider.queryProjectGraph(
    { root: fixture, query: 'remote' },
    { provider: { name: 'remote-graph', query: () => ({ status: 'available', anchors: ['remote:anchor'] }) }, fallback: ordinarySearch },
  );
  check('external provider can answer without fallback', externalAvailable.provider === 'remote-graph' && externalAvailable.matches[0] === 'remote:anchor' && !externalAvailable.fallback.required);

  const dispatchFallback = graphCli.dispatch(
    fixture,
    'query',
    { flags: {}, positionals: ['WF-0059'] },
    { provider: { name: 'partial', query: () => ({ status: 'partial', reason: 'bounded provider' }) }, fallback: ordinarySearch },
  );
  check('graph CLI dispatcher preserves fallback contract', dispatchFallback.status === 'partial' && dispatchFallback.searchAllowed && dispatchFallback.fallback.invoked);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} -- ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
