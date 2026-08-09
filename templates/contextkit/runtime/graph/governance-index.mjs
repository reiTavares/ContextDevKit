/**
 * Deterministic governance-memory graph extraction.
 *
 * Every readable governed document becomes a node, then path/schema facts add
 * typed Business, Operation, Workflow, Task, Decision, Report and Preference
 * nodes. The filesystem is authoritative here; Git ignore state is irrelevant.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { resolveRoots } from '../../tools/scripts/project-map-roots.mjs';

const GOVERNANCE_EXTENSIONS = new Set(['.md', '.json', '.jsonl', '.yaml', '.yml']);
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DETERMINISTIC = 'DETERMINISTIC';

/** @param {string} path @returns {string} */
function portable(path) {
  return path.replaceAll('\\', '/');
}

/** @param {string} source @param {string} target @param {string} relation @returns {object} */
function governanceEdge(source, target, relation) {
  return { source, target, relation, resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: DETERMINISTIC };
}

/**
 * Walks one explicit governance root without consulting Git.
 * @param {string} projectRoot
 * @param {import('../../tools/scripts/project-map-roots.mjs').ProjectMapRoot} scanRoot
 * @param {(scanRoot:object,relPath:string,entryName:string)=>boolean} isExcluded
 * @param {Map<string,string>} files logical source path to absolute file path
 * @param {Set<string>} pendingPaths
 */
function walkGovernanceRoot(projectRoot, scanRoot, isExcluded, files, pendingPaths) {
  if (!scanRoot.available) {
    pendingPaths.add(scanRoot.path);
    return;
  }
  const absoluteRoot = scanRoot.absolutePath || resolve(projectRoot, scanRoot.path);
  if (scanRoot.entryType === 'file') {
    files.set(scanRoot.path, absoluteRoot);
    return;
  }
  const visit = (directory) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch {
      const unresolved = portable(relative(absoluteRoot, directory));
      pendingPaths.add(unresolved ? `${scanRoot.path}/${unresolved}` : scanRoot.path);
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const relativeToGovernanceRoot = portable(relative(absoluteRoot, absolute));
      const rel = relativeToGovernanceRoot ? `${scanRoot.path}/${relativeToGovernanceRoot}` : scanRoot.path;
      if (entry.isDirectory()) {
        if (!isExcluded(scanRoot, rel, entry.name)) visit(absolute);
      } else if (entry.isFile() && GOVERNANCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.set(rel, absolute);
      }
    }
  };
  visit(absoluteRoot);
}

/** @param {string} text @param {RegExp} pattern @returns {string[]} */
function idsIn(text, pattern) {
  const ids = new Set();
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) ids.add(match[0].toUpperCase());
  return [...ids].sort();
}

/** @param {string} entityType @param {string} identifier @returns {string} */
function entityNodeId(entityType, identifier) {
  if (entityType === 'decision') return `adr:${identifier.replace(/^ADR-/i, '')}`;
  return `${entityType}:${identifier}`;
}

/**
 * Extracts canonical task arrays from the v4 task store without accepting a
 * second Markdown/status authority.
 * @param {string} text
 * @returns {object[]}
 * @throws {SyntaxError} when a tasks.json document is invalid
 */
function parseTasks(text) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = JSON.parse(normalized);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.tasks)) return parsed.tasks;
  return [];
}

/**
 * Builds governance nodes/edges and an honest coverage record.
 * @param {string} root project root
 * @param {object|null} [config]
 * @param {{maxFileBytes?:number}} [options]
 * @returns {{nodes:object[],edges:object[],coverage:{status:'complete'|'partial',roots:object[],indexedPaths:string[],pendingPaths:string[]}}}
 */
export function buildGovernanceLayer(root, config = null, { maxFileBytes = DEFAULT_MAX_FILE_BYTES } = {}) {
  const resolvedRoots = resolveRoots(config, root);
  const files = new Map();
  const pendingPaths = new Set();
  for (const scanRoot of resolvedRoots.governanceRoots) {
    walkGovernanceRoot(root, scanRoot, resolvedRoots.isExcluded, files, pendingPaths);
  }

  const nodesById = new Map();
  const edgesByKey = new Map();
  const indexedPaths = [];
  const upsertNode = (node) => {
    const previous = nodesById.get(node.id);
    const definitionScore = (candidate) => candidate?.label && candidate?.sourceFile?.includes(candidate.label) ? 1 : 0;
    if (!previous
      || definitionScore(node) > definitionScore(previous)
      || (definitionScore(node) === definitionScore(previous) && (node.sourceFile ?? '') < (previous.sourceFile ?? ''))) {
      nodesById.set(node.id, node);
    }
  };
  const addEdge = (edge) => edgesByKey.set(`${edge.source} ${edge.target} ${edge.relation}`, edge);
  const addEntity = (entityType, identifier, sourceFile) => {
    const id = entityNodeId(entityType, identifier);
    upsertNode({ id, kind: entityType, nodeType: entityType, label: identifier, sourceFile });
    addEdge(governanceEdge(id, `memory:${sourceFile}`, 'documented_by'));
    return id;
  };

  for (const [sourceFile, absolute] of [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    let size;
    try { size = statSync(absolute).size; } catch { pendingPaths.add(sourceFile); continue; }
    if (size > maxFileBytes) { pendingPaths.add(sourceFile); continue; }
    let text;
    try { text = readFileSync(absolute, 'utf-8'); } catch { pendingPaths.add(sourceFile); continue; }
    indexedPaths.push(sourceFile);
    const documentId = `memory:${sourceFile}`;
    upsertNode({ id: documentId, kind: 'governance-document', nodeType: 'governance-document', label: sourceFile, sourceFile });

    const businesses = idsIn(sourceFile, /BIZ-\d{4}/gi);
    const operations = idsIn(sourceFile, /OP-\d{4}/gi);
    const workflows = idsIn(sourceFile, /WF-\d{4}/gi);
    const decisions = idsIn(sourceFile, /ADR-\d{4}/gi);
    const businessNodes = businesses.map((id) => addEntity('business', id, sourceFile));
    const operationNodes = operations.map((id) => addEntity('operation', id, sourceFile));
    const workflowNodes = workflows.map((id) => addEntity('workflow', id, sourceFile));
    const decisionNodes = decisions.map((id) => addEntity('decision', id, sourceFile));

    for (const owner of [...businessNodes, ...operationNodes]) {
      for (const workflow of workflowNodes) addEdge(governanceEdge(owner, workflow, 'owns'));
    }
    for (const decision of decisionNodes) {
      for (const [entityType, pattern] of [
        ['business', /BIZ-\d{4}/gi],
        ['operation', /OP-\d{4}/gi],
        ['workflow', /WF-\d{4}/gi],
      ]) {
        for (const identifier of idsIn(text, pattern)) {
          const governedId = addEntity(entityType, identifier, sourceFile);
          addEdge(governanceEdge(governedId, decision, 'governed_by'));
        }
      }
    }

    if (/(^|\/)reports?(\/|$)/i.test(sourceFile)) {
      const reportId = `report:${sourceFile}`;
      upsertNode({ id: reportId, kind: 'report', nodeType: 'report', label: basename(sourceFile), sourceFile });
      addEdge(governanceEdge(reportId, documentId, 'documented_by'));
      for (const owner of [...businessNodes, ...operationNodes, ...workflowNodes]) addEdge(governanceEdge(owner, reportId, 'has_report'));
    }

    if (/preferenc|owner-profile/i.test(sourceFile)) {
      const preferenceId = `preference:${sourceFile}`;
      upsertNode({ id: preferenceId, kind: 'preference', nodeType: 'preference', label: basename(sourceFile), sourceFile });
      addEdge(governanceEdge(preferenceId, documentId, 'documented_by'));
    }

    if (basename(sourceFile).toLowerCase() === 'tasks.json') {
      let tasks;
      try { tasks = parseTasks(text); } catch { pendingPaths.add(sourceFile); continue; }
      for (const task of tasks) {
        const taskIdentifier = task?.id === undefined || task?.id === null ? null : String(task.id);
        if (!taskIdentifier) continue;
        const taskId = addEntity('task', taskIdentifier, sourceFile);
        for (const workflowId of workflowNodes) addEdge(governanceEdge(workflowId, taskId, 'tracks'));
      }
    }
  }

  const pending = [...pendingPaths].sort();
  return {
    nodes: [...nodesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edgesByKey.values()].sort((left, right) => `${left.source} ${left.target} ${left.relation}`.localeCompare(`${right.source} ${right.target} ${right.relation}`)),
    coverage: {
      status: pending.length > 0 ? 'partial' : 'complete',
      roots: resolvedRoots.governanceRoots.map(({ kind, path, entryType, available }) => ({ kind, path, entryType, available })),
      indexedPaths: indexedPaths.sort(),
      pendingPaths: pending,
    },
  };
}
