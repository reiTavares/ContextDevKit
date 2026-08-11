/**
 * Provider-neutral Project Graph query contract.
 *
 * Graph data is an optimization, never search authority. Unavailable, stale,
 * partial or failed providers return a machine-readable fallback instruction
 * and may invoke an injected ordinary-search callback immediately.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathsFor } from '../config/paths.mjs';
import { readGraphifyArtifact } from '../integrations/project-tools.mjs';

export const GRAPH_QUERY_STATUSES = Object.freeze(['available', 'partial', 'stale', 'unavailable']);

/** @param {string} path @returns {object|null} */
function readJson(path) {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return null;
  }
}

/**
 * Creates the native committed-projection provider.
 * @param {string} root project root
 * @returns {{name:string,query(request:object):object}}
 */
export function createNativeGraphProvider(root) {
  return Object.freeze({
    name: 'native',
    query(request) {
      const projectMap = pathsFor(root).projectMap;
      const projection = readJson(join(projectMap, 'graph', 'graph.json'));
      if (!projection || !Array.isArray(projection.nodes) || !Array.isArray(projection.edges)) {
        return { status: 'unavailable', reason: 'native graph projection unavailable' };
      }

      const manifest = readJson(join(projectMap, 'manifest.json'));
      if (request?.stale === true || (projection.projectMapSignature && manifest?.signature && projection.projectMapSignature !== manifest.signature)) {
        return { status: 'stale', reason: 'native graph projection is older than the Project Map', anchors: [] };
      }

      const query = typeof request?.query === 'string' ? request.query : '';
      const normalizedQuery = query.toLowerCase();
      const anchors = projection.nodes
        .filter((node) => {
          const searchable = `${node?.id ?? ''} ${node?.label ?? ''} ${node?.sourceFile ?? ''}`.toLowerCase();
          return normalizedQuery.length > 0 && searchable.includes(normalizedQuery);
        })
        .map((node) => node.id)
        .sort()
        .slice(0, 50);
      const coverage = projection.coverage && typeof projection.coverage === 'object'
        ? projection.coverage
        : { status: 'partial', pendingPaths: ['coverage metadata unavailable'] };
      if (coverage.status === 'partial') {
        return { status: 'partial', reason: 'graph coverage is partial', anchors, coverage };
      }
      return { status: 'available', anchors, coverage };
    },
  });
}

/**
 * Normalizes a Graphify source path without allowing an absolute or escaping
 * anchor into the provider receipt.
 * @param {string} root project root
 * @param {unknown} sourcePath untrusted Graphify `source_file` value
 * @returns {string|null}
 */
function normalizeWorkspaceAnchor(root, sourcePath) {
  if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0) return null;
  const candidate = sourcePath.trim().replaceAll('\\', '/');
  if (isAbsolute(candidate) || /^[A-Za-z]:/.test(candidate) || candidate.startsWith('//')) return null;
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, ...candidate.split('/'));
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return relativePath.replaceAll('\\', '/');
}

/**
 * Creates a read-only Graphify provider over its documented NetworkX node-link
 * artifact. Graphify evidence is always partial because the external artifact
 * cannot prove complete ContextDevKit scan coverage.
 * @param {string} root project root
 * @param {object} [options] bounded artifact-reader overrides
 * @returns {{name:string,query(request:object):object}}
 */
export function createGraphifyGraphProvider(root, options = {}) {
  return Object.freeze({
    name: 'graphify',
    query(request) {
      const artifact = readGraphifyArtifact(root, options);
      if (artifact.status !== 'ready_read_only') {
        return {
          status: 'unavailable',
          reason: artifact.reason ?? 'graphify graph artifact unavailable',
          anchors: [],
        };
      }

      const normalizedQuery = typeof request?.query === 'string'
        ? request.query.trim().toLowerCase()
        : '';
      const rejectedAnchors = [];
      const anchors = artifact.graphDocument.nodes
        .filter((node) => {
          const searchable = `${node?.id ?? ''} ${node?.label ?? ''} ${node?.name ?? ''} ${node?.source_file ?? ''}`.toLowerCase();
          return normalizedQuery.length > 0 && searchable.includes(normalizedQuery);
        })
        .map((node) => {
          const anchor = normalizeWorkspaceAnchor(root, node?.source_file);
          if (!anchor && typeof node?.source_file === 'string') rejectedAnchors.push(node.source_file);
          return anchor;
        })
        .filter(Boolean)
        .sort()
        .slice(0, 50);
      return {
        status: 'partial',
        reason: 'Graphify artifact coverage is externally managed and unproved',
        anchors,
        coverage: {
          status: 'partial',
          pendingPaths: ['Graphify artifact does not prove complete workspace coverage'],
        },
        artifact: {
          path: artifact.path,
          nodeCount: artifact.nodeCount,
          edgeCount: artifact.edgeCount,
          rejectedAnchorCount: rejectedAnchors.length,
        },
      };
    },
  });
}

/**
 * Normalizes any native/external provider result into the stable graph contract.
 * @param {unknown} providerResult
 * @param {string} providerName
 * @returns {object}
 */
function normalizeProviderResult(providerResult, providerName) {
  if (!providerResult || typeof providerResult !== 'object') {
    return { status: 'unavailable', reason: 'graph provider returned no usable result', provider: providerName, anchors: [] };
  }
  const status = GRAPH_QUERY_STATUSES.includes(providerResult.status)
    ? providerResult.status
    : (providerResult.available === true ? 'available' : 'unavailable');
  const anchors = Array.isArray(providerResult.anchors)
    ? providerResult.anchors.filter((anchor) => typeof anchor === 'string')
    : (Array.isArray(providerResult.matches) ? providerResult.matches.filter((anchor) => typeof anchor === 'string') : []);
  return {
    ...providerResult,
    status,
    provider: providerName,
    anchors: [...new Set(anchors)].sort().slice(0, 50),
  };
}

/**
 * Queries ordered structural providers and merges validated anchors while
 * preserving an auditable attempt receipt. A partial, stale, failed, or empty
 * answer never denies the next provider.
 * @param {{root?:string,query:string,stale?:boolean}} request
 * @param {{providers:Array<{name?:string,query(request:object):object}>}} options
 * @returns {object}
 */
export function queryProjectGraphChain(request, { providers } = { providers: [] }) {
  const selectedProviders = Array.isArray(providers) ? providers : [];
  const attempts = [];
  const matchedProviders = [];
  const mergedAnchors = [];
  const seenAnchors = new Set();

  for (const selectedProvider of selectedProviders) {
    const providerName = typeof selectedProvider?.name === 'string' ? selectedProvider.name : 'external';
    let normalized;
    try {
      normalized = normalizeProviderResult(selectedProvider?.query?.(request), providerName);
    } catch (error) {
      normalized = {
        status: 'unavailable',
        provider: providerName,
        anchors: [],
        reason: `graph provider failed: ${error?.message ?? String(error)}`,
      };
    }

    const outcome = normalized.anchors.length > 0
      ? 'match'
      : (normalized.status === 'available' ? 'no_match' : normalized.status);
    attempts.push({
      provider: providerName,
      status: normalized.status,
      outcome,
      anchors: normalized.anchors,
      reason: normalized.reason ?? null,
      coverage: normalized.coverage ?? null,
    });
    if (normalized.anchors.length > 0) matchedProviders.push(providerName);
    for (const anchor of normalized.anchors) {
      if (!seenAnchors.has(anchor) && mergedAnchors.length < 50) {
        seenAnchors.add(anchor);
        mergedAnchors.push(anchor);
      }
    }

    const completeMatch = normalized.status === 'available'
      && normalized.coverage?.status === 'complete'
      && mergedAnchors.length > 0;
    if (completeMatch) break;
  }

  const finalAttempt = attempts.at(-1) ?? null;
  const finalStatus = mergedAnchors.length > 0
    ? 'available'
    : (finalAttempt?.status ?? 'unavailable');
  const selectedProviderName = matchedProviders[0] ?? finalAttempt?.provider ?? 'none';
  const fallbackInvoked = attempts.length > 1;
  const fallbackReason = fallbackInvoked
    ? (attempts.find((attempt) => attempt.provider !== finalAttempt?.provider)?.reason ?? 'earlier provider did not produce a complete match')
    : null;
  return {
    status: finalStatus,
    provider: selectedProviderName,
    anchors: mergedAnchors,
    available: finalStatus === 'available',
    matches: mergedAnchors,
    outcome: mergedAnchors.length > 0 ? 'match' : 'no_match',
    denied: false,
    searchAllowed: true,
    mutation: false,
    attempts,
    provenance: {
      providerOrder: attempts.map((attempt) => attempt.provider),
      matchedProviders,
    },
    fallback: {
      required: fallbackInvoked,
      invoked: fallbackInvoked,
      reason: fallbackReason,
      result: finalAttempt,
      error: null,
    },
  };
}

/**
 * Queries a native or external graph and immediately releases ordinary search
 * when graph evidence is not complete/fresh. This function never throws and
 * never returns a search denial.
 * @param {{root?:string,query:string,stale?:boolean}} request
 * @param {{provider?:{name?:string,query(request:object):object},fallback?:(request:object,graphResult:object)=>unknown}} [options]
 * @returns {object}
 */
export function queryProjectGraph(request, { provider, fallback } = {}) {
  const root = typeof request?.root === 'string' ? request.root : process.cwd();
  const selectedProvider = provider ?? createNativeGraphProvider(root);
  const providerName = typeof selectedProvider?.name === 'string' ? selectedProvider.name : 'external';
  let normalized;
  try {
    normalized = normalizeProviderResult(selectedProvider?.query?.(request), providerName);
  } catch (error) {
    normalized = {
      status: 'unavailable',
      provider: providerName,
      anchors: [],
      reason: `graph provider failed: ${error?.message ?? String(error)}`,
    };
  }

  const fallbackRequired = normalized.status !== 'available';
  let fallbackInvoked = false;
  let fallbackResult = null;
  let fallbackError = null;
  if (fallbackRequired && typeof fallback === 'function') {
    fallbackInvoked = true;
    try { fallbackResult = fallback(request, normalized); } catch (error) {
      fallbackError = error?.message ?? String(error);
    }
  }

  return {
    ...normalized,
    available: normalized.status === 'available',
    matches: normalized.anchors,
    denied: false,
    searchAllowed: true,
    fallback: {
      required: fallbackRequired,
      invoked: fallbackInvoked,
      reason: fallbackRequired ? (normalized.reason ?? `graph status is ${normalized.status}`) : null,
      result: fallbackResult,
      error: fallbackError,
    },
  };
}
