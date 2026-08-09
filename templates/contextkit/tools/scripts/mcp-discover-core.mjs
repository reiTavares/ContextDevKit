/**
 * mcp-discover-core.mjs — Discovery engine for MCP-012.
 *
 * Owns: HTTP fetch, registry page normalisation, candidate data model.
 * Does NOT render output or run as a CLI — see mcp-discover.mjs for those.
 *
 * Contract:
 *   - Network failure → status "skipped", NEVER a crash (defensive I/O, §2).
 *   - Zero third-party dependencies — node:* only (immutable rule §1).
 *   - ALL discovered entries carry status="candidate". Registry presence is
 *     NEVER equivalent to trust (constitution §8, MCP-188).
 *
 * @module mcp-discover-core
 */

import { get as httpsGet } from 'node:https';
import { get as httpGet }  from 'node:http';
import { URL }             from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Official MCP package registry search endpoint (npm keyword search).
 * Shape: { objects: [{ package: { name, description, version, publisher,
 *   keywords, links } }] }
 */
export const DEFAULT_REGISTRY_URL =
  'https://registry.npmjs.org/-/v1/search?text=keywords:mcp+model-context-protocol&size=20';

/** Fetch timeout — keeps the hook path snappy. */
const FETCH_TIMEOUT_MS = 8000;

/** Status emitted for every discovery result — NEVER changes to "trusted". */
export const CANDIDATE_STATUS = 'candidate';

// ---------------------------------------------------------------------------
// Types (JSDoc — no runtime cost)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CandidateEntry
 * @property {string}   status        Always "candidate" — never "trusted".
 * @property {string}   server        Package name / server id.
 * @property {string}   publisher     Author / publisher name.
 * @property {string}   source        npm package reference.
 * @property {string}   version       Latest published version.
 * @property {string}   risk          Always "UNREVIEWED" until locally curated.
 * @property {string}   transport     Best-effort guess ("stdio" default).
 * @property {string[]} capabilities  Best-effort keywords from description.
 * @property {string}   supportedHosts "all (unverified)" until curation.
 * @property {string}   promotionPath  Explicit steps to promote to curated registry.
 */

// ---------------------------------------------------------------------------
// HTTP fetch helper (node:* only)
// ---------------------------------------------------------------------------

/**
 * Fetches a URL and resolves with the response body string.
 * Follows at most `maxRedirects` hops (default 1). Rejects on network error,
 * timeout, or when the redirect chain exceeds the limit.
 *
 * @param {string} url
 * @param {number} [timeoutMs]
 * @param {number} [maxRedirects]  Maximum redirect hops allowed (default 1).
 * @returns {Promise<string>}
 */
export function fetchUrl(url, timeoutMs = FETCH_TIMEOUT_MS, maxRedirects = 1) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const getter = parsed.protocol === 'https:' ? httpsGet : httpGet;
    const timer  = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const req = getter(url, (res) => {
      // Bounded redirect: decrement the counter; reject if chain is exhausted.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        res.resume();
        if (maxRedirects <= 0) {
          reject(new Error(`Redirect chain exceeded maximum hops for ${url}`));
          return;
        }
        fetchUrl(res.headers.location, timeoutMs, maxRedirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { clearTimeout(timer); resolve(chunks.join('')); });
      res.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    req.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// ---------------------------------------------------------------------------
// Registry page fetch + normalisation
// ---------------------------------------------------------------------------

/**
 * Fetches one page from a registry search endpoint and returns parsed JSON.
 * Returns null on any network or parse failure — never throws (defensive I/O).
 *
 * Exported so tests can verify degradation without patching node internals.
 *
 * @param {string} [registryUrl] Override for testing.
 * @returns {Promise<object|null>}
 */
export async function fetchRegistryPage(registryUrl = DEFAULT_REGISTRY_URL) {
  try {
    const body = await fetchUrl(registryUrl);
    return JSON.parse(body);
  } catch {
    return null; // Network unavailable, timeout, or malformed JSON.
  }
}

// ---------------------------------------------------------------------------
// Candidate normalisation
// ---------------------------------------------------------------------------

/**
 * Best-effort transport guess from keywords and description.
 * Defaults to "stdio" (most common for npm MCP packages).
 *
 * @param {object} pkg npm package metadata.
 * @returns {string}
 */
function guessTransport(pkg) {
  const text = [...(pkg.keywords ?? []), pkg.description ?? ''].join(' ').toLowerCase();
  if (text.includes('http') || text.includes('sse') || text.includes('streamable')) {
    return 'streamable-http (unverified)';
  }
  return 'stdio (unverified)';
}

/**
 * Best-effort capability keywords from description and keyword list.
 *
 * @param {object} pkg npm package metadata.
 * @returns {string[]}
 */
function guessCapabilities(pkg) {
  const KNOWN = [
    'files', 'search', 'browser', 'web', 'git', 'github', 'database',
    'sql', 'memory', 'code', 'run', 'exec', 'read', 'write', 'fetch',
    'slack', 'notion', 'jira', 'email', 'calendar',
  ];
  const text = [...(pkg.keywords ?? []), pkg.description ?? ''].join(' ').toLowerCase();
  const found = KNOWN.filter((cap) => text.includes(cap));
  return found.length > 0 ? found : ['(unverified — inspect before enabling)'];
}

/**
 * Normalises a raw npm search result object into a CandidateEntry.
 * Status is always "candidate"; promotion path is always explicit.
 *
 * @param {object} obj One element from npm search `objects[]`.
 * @returns {CandidateEntry}
 */
export function normaliseCandidate(obj) {
  const pkg = obj?.package ?? {};
  return {
    status:         CANDIDATE_STATUS,
    server:         pkg.name                        ?? '(unknown)',
    publisher:      pkg.publisher?.username ?? pkg.author?.name ?? '(unknown)',
    source:         `npm:${pkg.name ?? '(unknown)'}`,
    version:        pkg.version                     ?? '(unknown)',
    risk:           'UNREVIEWED',
    transport:      guessTransport(pkg),
    capabilities:   guessCapabilities(pkg),
    supportedHosts: 'all (unverified — not tested against any host)',
    promotionPath:
      'Run: /mcp curate <server-id> to start provenance capture (MCP-187) ' +
      'and local trust policy review (MCP-188). ' +
      'Registry listing is NEVER sufficient for trust.',
  };
}

// ---------------------------------------------------------------------------
// Core discovery
// ---------------------------------------------------------------------------

/**
 * Discovers candidate MCP servers from the official registry.
 *
 * Always returns a DiscoveryResult — never throws:
 *   { status: "ok",      candidates: CandidateEntry[] }
 *   { status: "skipped", candidates: [],  reason: string }
 *
 * No local state is written; no server is auto-enabled.
 *
 * @param {object} [opts]
 * @param {string} [opts.query]        Filter string applied client-side.
 * @param {string} [opts.registryUrl]  Override the search endpoint (for testing).
 * @returns {Promise<{status:'ok'|'skipped', candidates: CandidateEntry[], reason?: string}>}
 */
export async function discoverCandidates({ query = '', registryUrl } = {}) {
  const url = registryUrl
    ? (query
        // Append query as a proper ?text= parameter; use & if the base already has '?'.
        ? `${registryUrl}${registryUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(query)}`
        : registryUrl)
    : (query
        ? `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}+keywords:mcp&size=20`
        : DEFAULT_REGISTRY_URL);

  const raw = await fetchRegistryPage(url);

  if (!raw) {
    return {
      status:     'skipped',
      candidates: [],
      reason:
        'Registry unreachable or returned malformed data. ' +
        'Check your network connection and try again.',
    };
  }

  const objects    = Array.isArray(raw.objects) ? raw.objects : [];
  const allCandidates = objects.map(normaliseCandidate);

  // Client-side filter (npm search is fuzzy — refine for precise substring).
  const candidates = query
    ? allCandidates.filter(
        (c) =>
          c.server.toLowerCase().includes(query.toLowerCase()) ||
          c.publisher.toLowerCase().includes(query.toLowerCase()),
      )
    : allCandidates;

  return { status: 'ok', candidates };
}
