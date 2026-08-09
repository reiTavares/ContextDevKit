#!/usr/bin/env node
/** Focused WF-0111 W09 authority-consumer contract tests. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';

const { ok, bad, finish } = reporter();
const KIT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const importSource = (relativePath) => import(pathToFileURL(resolve(KIT, relativePath)).href);

const authorityModule = await importSource('templates/contextkit/runtime/authority-reader.mjs');
const bootReaders = await importSource('templates/contextkit/runtime/hooks/boot-context-readers.mjs');
const dashboardModule = await importSource('templates/contextkit/tools/scripts/dashboard-data.mjs');
const dashboardHtmlModule = await importSource('templates/contextkit/tools/scripts/dashboard-html.mjs');
const toolsModule = await importSource('templates/contextkit/mcp-server/tools.read.mjs');
const resourcesModule = await importSource('templates/contextkit/mcp-server/resources.mjs');
const toolCatalogModule = await importSource('templates/contextkit/mcp-server/tool-catalog.mjs');

const root = mkdtempSync(resolve(tmpdir(), 'contextdevkit-v4-consumers-'));
const memoryRoot = resolve(root, 'contextkit', 'memory');
const goodWorkflow = resolve(memoryRoot, 'workflows', 'WF-0001-good');
const corruptWorkflow = resolve(memoryRoot, 'operations', 'OP-0001-test', 'workflows', 'WF-0002-corrupt');
const ownedBatch = resolve(memoryRoot, 'operations', 'OP-0001-test', 'batch');
mkdirSync(goodWorkflow, { recursive: true });
mkdirSync(corruptWorkflow, { recursive: true });
mkdirSync(ownedBatch, { recursive: true });
writeFileSync(resolve(goodWorkflow, 'workflow.json'), '{}\n');
writeFileSync(resolve(corruptWorkflow, 'workflow.json'), '{}\n');
writeFileSync(resolve(ownedBatch, 'tasks.json'), '{}\n');

const makePack = (workflowDir) => ({
  dir: workflowDir,
  definition: {
    id: workflowDir.includes('0002') ? 'WF-0002' : 'WF-0001',
    slug: workflowDir.includes('0002') ? 'corrupt' : 'good',
    title: 'Fixture',
  },
  state: { status: 'working', phase: 'implementation', revision: 2 },
  tasks: null,
  manifest: { schemaVersion: 1 },
  documents: { prd: '# PRD', spec: '# SPEC', decisions: '# Decisions', continuation: null },
  reports: [{ ref: 'reports/latest.md', content: '# Report' }],
});
const loadPack = (_projectRoot, workflowDir) => makePack(workflowDir);
const readTasks = (tasksPath) => {
  if (tasksPath.includes('corrupt')) {
    const error = new Error('invalid tasks document');
    error.name = 'TasksStoreCorruptError';
    throw error;
  }
  if (basename(dirname(tasksPath)) === 'batch') {
    return {
      schemaVersion: 2,
      scopeRef: 'OP-0001',
      revision: 1,
      tasks: [{ id: 'T-002', title: 'Verify batch', status: 'testing', priority: 'P2' }],
      events: [],
    };
  }
  return {
    schemaVersion: 2,
    scopeRef: 'WF-0001',
    revision: 2,
    tasks: [{ id: 'T-001', title: 'Implement', status: 'working', priority: 'P1' }],
    events: [],
  };
};

try {
  const snapshot = authorityModule.readAuthoritySnapshot(root, { loadPack, readTasks });
  snapshot.status === 'partial'
    ? ok('partial authority remains partial when one canonical workflow is corrupt')
    : bad(`expected partial authority, got ${snapshot.status}`);
  snapshot.counts.working === 1 && snapshot.counts.testing === 1 && snapshot.tasks.length === 2
    ? ok('task counts derive from readable canonical JSON only')
    : bad(`unexpected task projection: ${JSON.stringify(snapshot.counts)}`);
  snapshot.batches.some((batch) => batch.id === 'OP-0001')
    ? ok('operation-owned batch tasks are read from their canonical root JSON')
    : bad(`owned batch projection is missing: ${JSON.stringify(snapshot.batches)}`);
  snapshot.diagnostics.some((entry) => entry.kind === 'TasksStoreCorruptError')
    ? ok('corrupt task state is exposed with its typed diagnostic')
    : bad('corrupt task state diagnostic was lost');

  const coldRoot = mkdtempSync(resolve(tmpdir(), 'contextdevkit-v4-cold-'));
  try {
    const coldSnapshot = authorityModule.readAuthoritySnapshot(coldRoot, { loadPack, readTasks });
    coldSnapshot.status === 'unavailable' && coldSnapshot.tasks.length === 0
      ? ok('cold boot reports unavailable authority without a fabricated pass')
      : bad(`cold boot authority mismatch: ${JSON.stringify(coldSnapshot)}`);
  } finally {
    rmSync(coldRoot, { recursive: true, force: true });
  }

  const governed = authorityModule.readGovernedWorkflowContext(root, 'WF-0001', {
    loadPack: () => makePack(goodWorkflow),
  });
  const renderedContext = bootReaders.renderGovernedWorkflowContext(governed);
  ['workflow.json', 'workflow-state.json', 'pipeline/tasks.json', '# PRD', '# SPEC', '# Decisions']
    .every((expected) => renderedContext.includes(expected))
    ? ok('governed workflow context includes definition, state, tasks, PRD, SPEC, and decisions')
    : bad('governed workflow context omitted a required artifact');

  const nonGitRoot = mkdtempSync(resolve(tmpdir(), 'contextdevkit-v4-nongit-'));
  try {
    mkdirSync(resolve(nonGitRoot, 'contextkit', 'memory'), { recursive: true });
    writeFileSync(resolve(nonGitRoot, 'contextkit', 'config.json'), JSON.stringify({ level: 4 }));
    const dashboardData = dashboardModule.buildDashboardData(nonGitRoot);
    dashboardData.meta.branch === '' && dashboardData.authority.kind === 'v4-json'
      ? ok('dashboard builds in a non-Git Windows-safe fixture')
      : bad(`non-Git dashboard mismatch: ${JSON.stringify(dashboardData.meta)}`);
    dashboardData.governance?.policyHash && dashboardData.governance?.counts
      ? ok('dashboard renders the single resolved governance matrix projection')
      : bad(`dashboard governance matrix unavailable: ${JSON.stringify(dashboardData.governance)}`);

    const html = dashboardHtmlModule.renderDashboardHTML({
      ...dashboardData,
      tasks: {
        backlog: [], working: [{ id: '<T-1>', title: '<script>', status: 'working' }],
        blocked: [], testing: [], done: [], cancelled: [],
      },
      counts: { backlog: 0, working: 1, blocked: 0, testing: 0, done: 0, cancelled: 0 },
    });
    html.includes('data-status="cancelled"') && html.includes('&lt;script&gt;') && !html.includes('class="lane')
      ? ok('dashboard renders all v4 statuses, escapes content, and has no physical-status UI contract')
      : bad('dashboard HTML contract is stale or unsafe');
  } finally {
    rmSync(nonGitRoot, { recursive: true, force: true });
  }

  const mcpToolNames = toolCatalogModule.TOOL_LIST.map((tool) => tool.name);
  mcpToolNames.includes('get_tasks') && !mcpToolNames.includes('get_pipeline_cards')
    ? ok('MCP tool catalog exposes canonical tasks and removes the retired command')
    : bad(`MCP tool catalog mismatch: ${mcpToolNames.join(', ')}`);
  resourcesModule.RESOURCE_LIST.some((resource) => resource.uri === 'contextdevkit://tasks/working')
    && !resourcesModule.RESOURCE_LIST.some((resource) => resource.uri.includes('/pipeline/'))
    ? ok('MCP resources expose task status without a physical path contract')
    : bad('MCP resource catalog still exposes a retired path');
  typeof toolsModule.getTasks === 'function' && toolsModule.getPipelineCards === undefined
    ? ok('MCP handler module has one v4 task read surface')
    : bad('MCP handler module retains the retired task reader');
  const projectState = await toolsModule.getProjectState();
  projectState.governance?.policyHash && projectState.governance?.counts
    ? ok('MCP project state exposes the same resolved governance matrix contract')
    : bad(`MCP governance matrix unavailable: ${JSON.stringify(projectState)}`);

  const ownedSources = [
    'templates/contextkit/runtime/authority-reader.mjs',
    'templates/contextkit/runtime/statusline.mjs',
    'templates/contextkit/runtime/hooks/boot-signals.mjs',
    'templates/contextkit/runtime/hooks/boot-banner.mjs',
    'templates/contextkit/runtime/hooks/boot-context-readers.mjs',
    'templates/contextkit/tools/scripts/dashboard-data.mjs',
    'templates/contextkit/tools/scripts/dashboard-html.mjs',
    'templates/contextkit/mcp-server/resources.mjs',
    'templates/contextkit/mcp-server/tools.read.mjs',
    'templates/contextkit/mcp-server/tool-catalog.mjs',
  ].map((relativePath) => readFileSync(resolve(KIT, relativePath), 'utf-8')).join('\n');
  !/contextkit[\\/]pipeline[\\/](?:backlog|working|testing|conclusion)/.test(ownedSources)
    && !/pipeline-tasks\.mjs/.test(ownedSources)
    && !/resolveAutonomy|readAutonomyOverride/.test(ownedSources)
    && /resolveGovernanceMatrix/.test(ownedSources)
    && /readAuthoritySnapshot/.test(ownedSources)
    ? ok('static contract proves no physical-status read or autonomy fallback in W09 consumers')
    : bad('a W09 consumer still references a retired runtime authority');
  !/writeFileSync|renameSync|mkdirSync|git fetch/.test(readFileSync(resolve(KIT, 'templates/contextkit/runtime/hooks/boot-signals.mjs'), 'utf-8'))
    ? ok('boot signals are strictly read-only')
    : bad('boot signals retain a speculative write');
} finally {
  rmSync(root, { recursive: true, force: true });
}

finish('WF-0111 W09 authority consumers');
