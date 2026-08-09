/**
 * Provider-neutral Project Graph query contract.
 *
 * Graph data is an optimization, never search authority. Unavailable, stale,
 * partial or failed providers return a machine-readable fallback instruction
 * and may invoke an injected ordinary-search callback immediately.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

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
