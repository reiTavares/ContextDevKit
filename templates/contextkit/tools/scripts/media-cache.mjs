/**
 * Content-addressed cache for /media-gen (ticket 056, ADR-0024 follow-up).
 *
 * Key = `sha256(providerId + ':' + prompt + ':' + canonical(options))`; the
 * cached artifact lives at `<platform>/.cache/media/<sha>.<ext>` (`.png` for
 * images, `.mp4` for video). A re-run with the same (provider, prompt, options)
 * copies the cached file to `--out` instead of paying the API again — re-running
 * one prompt is free.
 *
 * Local + small by design: **no eviction** (caches are disposable — `rm -rf` the
 * dir to clear) and **no cross-machine sync** (rule 4 — file-first per repo). The
 * platform folder is single-sourced via `pathsFor().platform`, never hardcoded.
 * Defensive everywhere; zero deps.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const EXT_BY_KIND = { image: 'png', video: 'mp4' };

/** Stable representation: object keys sorted recursively, so option order never changes the key. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => { acc[key] = canonical(value[key]); return acc; }, {});
  }
  return value;
}

/** sha256 over (providerId, prompt, canonical(options)). */
export function cacheKey(providerId, prompt, options = {}) {
  return createHash('sha256').update(`${providerId}:${prompt}:${JSON.stringify(canonical(options))}`).digest('hex');
}

/** Absolute path of the cache slot for a (provider, kind, prompt, options) tuple. */
export function cachePathFor({ providerId, kind, prompt, options = {} }, root = process.cwd()) {
  const ext = EXT_BY_KIND[kind] || 'bin';
  return resolve(pathsFor(root).platform, '.cache', 'media', `${cacheKey(providerId, prompt, options)}.${ext}`);
}

/** True when the cache slot already holds an artifact. */
export function isCached(slot) {
  return existsSync(slot);
}

/**
 * Stores a freshly-generated file INTO the cache via tmp + rename (atomic, so a
 * concurrent reader never sees a half-written slot). Best-effort — never throws;
 * a cache-write failure must not fail the generation the user already paid for.
 *
 * @returns {boolean} true on success
 */
export function storeInCache(slot, sourcePath) {
  try {
    mkdirSync(dirname(slot), { recursive: true });
    const tmp = `${slot}.tmp`;
    copyFileSync(sourcePath, tmp);
    renameSync(tmp, slot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serves a cache hit: copies the cached slot to `outPath`. Best-effort.
 *
 * @returns {boolean} true on success
 */
export function serveFromCache(slot, outPath) {
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(slot, outPath);
    return true;
  } catch {
    return false;
  }
}
