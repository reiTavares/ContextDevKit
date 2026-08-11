/**
 * Passive interoperability detection for project-local CompozyOS and Graphify
 * evidence. External markers are untrusted inputs: this module performs bounded
 * reads only and never executes a process, accesses the network, or mutates the
 * inspected workspace.
 */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_GRAPHIFY_GRAPH_MAX_BYTES = 128 * 1024 * 1024;
export const DEFAULT_PROJECT_TOOL_MARKER_MAX_BYTES = 1024 * 1024;

const COMPOZY_CONFIG_PATH = '.compozy/config.toml';
const GRAPHIFY_GRAPH_PATH = 'graphify-out/graph.json';
const GRAPHIFY_SKILL_PATHS = Object.freeze([
  '.agents/skills/graphify/SKILL.md',
  '.claude/skills/graphify/SKILL.md',
]);
const GRAPHIFY_INSTRUCTION_PATHS = Object.freeze(['AGENTS.md', 'CLAUDE.md']);
const GRAPHIFY_HOOK_PATHS = Object.freeze(['.codex/hooks.json', '.claude/settings.json']);

/**
 * Returns whether `candidatePath` resolves inside `canonicalRoot`.
 * @param {string} canonicalRoot real workspace root
 * @param {string} candidatePath real candidate path
 * @returns {boolean}
 */
function isInsideRoot(canonicalRoot, candidatePath) {
  const relativePath = relative(canonicalRoot, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

/**
 * Resolves a path defensively without allowing a missing marker to throw.
 * @param {string} path absolute path
 * @param {(path:string)=>string} realpathFn injectable realpath implementation
 * @returns {{ok:true,path:string}|{ok:false,reason:string}}
 */
function resolveRealPath(path, realpathFn) {
  try {
    return { ok: true, path: realpathFn(path) };
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'ENOENT' ? 'not_found' : 'realpath_failed',
    };
  }
}

/**
 * Inspects one expected regular file and proves it stays within the workspace.
 * @param {string} root workspace root
 * @param {string} relativePath fixed workspace-relative marker path
 * @param {{maxBytes:number,lstatFn?:(path:string)=>import('node:fs').Stats,realpathFn?:(path:string)=>string}} options
 * @returns {{status:'present'|'absent'|'unsafe'|'invalid',path:string,sizeBytes?:number,reason?:string}}
 */
function inspectRegularFile(root, relativePath, options) {
  const lstatFn = options.lstatFn ?? lstatSync;
  const realpathFn = options.realpathFn ?? realpathSync.native;
  const resolvedRoot = resolve(root);
  const absolutePath = resolve(resolvedRoot, ...relativePath.split('/'));
  const rootResolution = resolveRealPath(resolvedRoot, realpathFn);
  if (!rootResolution.ok) {
    return { status: 'unsafe', path: relativePath, reason: 'workspace_realpath_failed' };
  }

  let fileStats;
  try {
    fileStats = lstatFn(absolutePath);
  } catch (error) {
    return {
      status: error?.code === 'ENOENT' ? 'absent' : 'invalid',
      path: relativePath,
      reason: error?.code === 'ENOENT' ? 'not_found' : 'lstat_failed',
    };
  }

  if (fileStats.isSymbolicLink()) {
    return { status: 'unsafe', path: relativePath, reason: 'symbolic_link' };
  }
  if (!fileStats.isFile()) {
    return { status: 'invalid', path: relativePath, reason: 'not_regular_file' };
  }
  if (fileStats.size > options.maxBytes) {
    return { status: 'invalid', path: relativePath, sizeBytes: fileStats.size, reason: 'oversized' };
  }

  const fileResolution = resolveRealPath(absolutePath, realpathFn);
  if (!fileResolution.ok) {
    return { status: 'invalid', path: relativePath, reason: fileResolution.reason };
  }
  if (!isInsideRoot(rootResolution.path, fileResolution.path)) {
    return { status: 'unsafe', path: relativePath, reason: 'path_escape' };
  }
  return { status: 'present', path: relativePath, sizeBytes: fileStats.size };
}

/**
 * Reads a previously bounded marker. The caller owns the inspection result.
 * @param {string} root workspace root
 * @param {{status:string,path:string}} inspection regular-file inspection
 * @param {(path:string,encoding:BufferEncoding)=>string} readFileFn injectable reader
 * @returns {{ok:true,text:string}|{ok:false,reason:string}}
 */
function readInspectedText(root, inspection, readFileFn) {
  if (inspection.status !== 'present') return { ok: false, reason: inspection.reason ?? 'not_present' };
  try {
    const absolutePath = resolve(root, ...inspection.path.split('/'));
    const rawText = readFileFn(absolutePath, 'utf-8');
    return { ok: true, text: rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText };
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
}

/**
 * Loads and validates the documented Graphify NetworkX node-link artifact.
 * Parsed content is returned for the read-only provider but is never treated as
 * governance evidence.
 * @param {string} root workspace root
 * @param {{maxGraphBytes?:number,lstatFn?:Function,realpathFn?:Function,readFileFn?:Function}} [options]
 * @returns {{status:'not_detected'|'ready_read_only'|'unavailable',reason:string|null,path:string,sizeBytes?:number,nodeCount?:number,edgeCount?:number,edgeField?:'links'|'edges',graphDocument?:object}}
 */
export function readGraphifyArtifact(root, options = {}) {
  const inspection = inspectRegularFile(root, GRAPHIFY_GRAPH_PATH, {
    maxBytes: options.maxGraphBytes ?? DEFAULT_GRAPHIFY_GRAPH_MAX_BYTES,
    lstatFn: options.lstatFn,
    realpathFn: options.realpathFn,
  });
  if (inspection.status === 'absent') {
    return { status: 'not_detected', reason: null, path: GRAPHIFY_GRAPH_PATH };
  }
  if (inspection.status !== 'present') {
    const reasonByInspection = {
      oversized: 'graphify_graph_oversized',
      path_escape: 'graphify_graph_path_escape',
      symbolic_link: 'graphify_graph_symbolic_link',
    };
    return {
      status: 'unavailable',
      reason: reasonByInspection[inspection.reason] ?? `graphify_graph_${inspection.reason ?? 'invalid'}`,
      path: GRAPHIFY_GRAPH_PATH,
      ...(typeof inspection.sizeBytes === 'number' ? { sizeBytes: inspection.sizeBytes } : {}),
    };
  }

  const readFileFn = options.readFileFn ?? readFileSync;
  const artifactText = readInspectedText(root, inspection, readFileFn);
  if (!artifactText.ok) {
    return { status: 'unavailable', reason: 'graphify_graph_read_failed', path: GRAPHIFY_GRAPH_PATH };
  }

  let graphDocument;
  try {
    graphDocument = JSON.parse(artifactText.text);
  } catch {
    return { status: 'unavailable', reason: 'graphify_graph_invalid_json', path: GRAPHIFY_GRAPH_PATH };
  }
  if (!graphDocument || typeof graphDocument !== 'object' || Array.isArray(graphDocument)
    || !Array.isArray(graphDocument.nodes)) {
    return { status: 'unavailable', reason: 'graphify_graph_unsupported_schema', path: GRAPHIFY_GRAPH_PATH };
  }
  const edgeField = Array.isArray(graphDocument.links)
    ? 'links'
    : (Array.isArray(graphDocument.edges) ? 'edges' : null);
  if (!edgeField) {
    return { status: 'unavailable', reason: 'graphify_graph_unsupported_schema', path: GRAPHIFY_GRAPH_PATH };
  }
  return {
    status: 'ready_read_only',
    reason: null,
    path: GRAPHIFY_GRAPH_PATH,
    sizeBytes: inspection.sizeBytes,
    nodeCount: graphDocument.nodes.length,
    edgeCount: graphDocument[edgeField].length,
    edgeField,
    graphDocument,
  };
}

/**
 * Detects a bounded text marker without exposing its contents in the receipt.
 * @param {string} root workspace root
 * @param {string} relativePath marker path
 * @param {string} kind marker classification
 * @param {{maxMarkerBytes:number,lstatFn?:Function,realpathFn?:Function}} options
 * @returns {{present:boolean,marker?:{kind:string,path:string},inspection:object}}
 */
function detectMarker(root, relativePath, kind, options) {
  const inspection = inspectRegularFile(root, relativePath, {
    maxBytes: options.maxMarkerBytes,
    lstatFn: options.lstatFn,
    realpathFn: options.realpathFn,
  });
  return inspection.status === 'present'
    ? { present: true, marker: { kind, path: relativePath }, inspection }
    : { present: false, inspection };
}

/**
 * Finds Graphify-owned instruction or hook text that overlaps ContextDevKit
 * host surfaces. Findings are diagnostics only; no file is rewritten.
 * @param {string} root workspace root
 * @param {string[]} relativePaths candidate host paths
 * @param {string} code stable conflict code
 * @param {object} options detector options
 * @returns {Array<{code:string,path:string}>}
 */
function detectGraphifyOverlap(root, relativePaths, code, options) {
  const conflicts = [];
  const readFileFn = options.readFileFn ?? readFileSync;
  for (const relativePath of relativePaths) {
    const inspection = inspectRegularFile(root, relativePath, {
      maxBytes: options.maxMarkerBytes,
      lstatFn: options.lstatFn,
      realpathFn: options.realpathFn,
    });
    const markerText = readInspectedText(root, inspection, readFileFn);
    if (markerText.ok && /graphify/i.test(markerText.text)) conflicts.push({ code, path: relativePath });
  }
  return conflicts;
}

/**
 * Detects project-local CompozyOS and Graphify evidence without activation.
 * @param {string} root workspace root
 * @param {{maxGraphBytes?:number,maxMarkerBytes?:number,lstatFn?:Function,realpathFn?:Function,readFileFn?:Function}} [options]
 * @returns {{schemaVersion:number,mutation:false,compozy:object,graphify:object}}
 */
export function detectProjectTools(root, options = {}) {
  const detectorOptions = {
    ...options,
    maxGraphBytes: options.maxGraphBytes ?? DEFAULT_GRAPHIFY_GRAPH_MAX_BYTES,
    maxMarkerBytes: options.maxMarkerBytes ?? DEFAULT_PROJECT_TOOL_MARKER_MAX_BYTES,
  };
  const compozyMarker = detectMarker(root, COMPOZY_CONFIG_PATH, 'config', detectorOptions);
  const compozy = compozyMarker.present
    ? {
        status: 'detected_unverified',
        detected: true,
        reason: 'compozy_activation_requires_explicit_adapter',
        markers: [compozyMarker.marker],
      }
    : {
        status: compozyMarker.inspection.status === 'absent' ? 'not_detected' : 'unavailable',
        detected: compozyMarker.inspection.status !== 'absent',
        reason: compozyMarker.inspection.status === 'absent'
          ? null
          : `compozy_config_${compozyMarker.inspection.reason ?? 'invalid'}`,
        markers: [],
      };

  const graphifyArtifact = readGraphifyArtifact(root, detectorOptions);
  const graphifyMarkers = [];
  if (graphifyArtifact.status !== 'not_detected') {
    graphifyMarkers.push({ kind: 'artifact', path: GRAPHIFY_GRAPH_PATH });
  }
  for (const skillPath of GRAPHIFY_SKILL_PATHS) {
    const skillMarker = detectMarker(root, skillPath, 'skill', detectorOptions);
    if (skillMarker.present) graphifyMarkers.push(skillMarker.marker);
  }
  const graphifyConflicts = [
    ...detectGraphifyOverlap(root, GRAPHIFY_INSTRUCTION_PATHS, 'graphify_instruction_overlap', detectorOptions),
    ...detectGraphifyOverlap(root, GRAPHIFY_HOOK_PATHS, 'graphify_hook_overlap', detectorOptions),
  ];
  const graphifyDetected = graphifyMarkers.length > 0 || graphifyConflicts.length > 0;
  let graphifyStatus = graphifyArtifact.status;
  if (graphifyConflicts.length > 0) graphifyStatus = 'conflict';
  else if (graphifyStatus === 'not_detected' && graphifyDetected) graphifyStatus = 'detected_unverified';

  return {
    schemaVersion: 1,
    mutation: false,
    compozy,
    graphify: {
      status: graphifyStatus,
      detected: graphifyDetected,
      reason: graphifyConflicts.length > 0 ? 'graphify_host_surface_overlap' : graphifyArtifact.reason,
      markers: graphifyMarkers,
      conflicts: graphifyConflicts,
      artifact: {
        status: graphifyArtifact.status,
        path: graphifyArtifact.path,
        ...(typeof graphifyArtifact.sizeBytes === 'number' ? { sizeBytes: graphifyArtifact.sizeBytes } : {}),
        ...(typeof graphifyArtifact.nodeCount === 'number' ? { nodeCount: graphifyArtifact.nodeCount } : {}),
        ...(typeof graphifyArtifact.edgeCount === 'number' ? { edgeCount: graphifyArtifact.edgeCount } : {}),
        ...(graphifyArtifact.edgeField ? { edgeField: graphifyArtifact.edgeField } : {}),
      },
    },
  };
}
