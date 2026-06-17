/**
 * Glob primitives — pure path/pattern matching for the workflow ownership engine.
 *
 * Supports `*` (a single segment, any run within one segment), `**` (any number
 * of segments including zero), and a TRAILING `/` (prefix match: the dir itself
 * and everything beneath it). Forward-slash paths only.
 *
 * Design constraints: ZERO imports, no I/O, no clock/random. Deterministic.
 */

/**
 * Normalize a path/pattern: trim, strip a leading `./`, collapse `\` to `/`,
 * collapse duplicate slashes. Pure and idempotent.
 * @param {string} value raw path or glob
 * @returns {string} normalized forward-slash form
 */
export function normalize(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

/**
 * Split a normalized path into non-empty segments.
 * @param {string} value normalized path
 * @returns {string[]} segments
 */
export function segments(value) {
  return value.split('/').filter((seg) => seg.length > 0);
}

/**
 * Translate a single glob segment (may contain `*`) to a regex source.
 * `*` matches any run of non-`/` characters within one segment.
 * @param {string} seg one path segment from a glob
 * @returns {string} regex source for that segment
 */
function segmentToRegex(seg) {
  return seg
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
}

/**
 * Recursive segment matcher backing {@link matchesGlob}. `**` consumes zero or
 * more path segments; every other segment is matched via a per-segment regex.
 * @param {string[]} pathSegs path segments
 * @param {number} pathIndex current index into pathSegs
 * @param {string[]} patternSegs pattern segments
 * @param {number} patternIndex current index into patternSegs
 * @returns {boolean} true on a full match
 */
function globSegmentsMatch(pathSegs, pathIndex, patternSegs, patternIndex) {
  if (patternIndex >= patternSegs.length) return pathIndex >= pathSegs.length;

  const token = patternSegs[patternIndex];
  if (token === '**') {
    if (globSegmentsMatch(pathSegs, pathIndex, patternSegs, patternIndex + 1)) return true;
    if (pathIndex < pathSegs.length) {
      return globSegmentsMatch(pathSegs, pathIndex + 1, patternSegs, patternIndex);
    }
    return false;
  }

  if (pathIndex >= pathSegs.length) return false;
  const segRegex = new RegExp(`^${segmentToRegex(token)}$`);
  if (!segRegex.test(pathSegs[pathIndex])) return false;
  return globSegmentsMatch(pathSegs, pathIndex + 1, patternSegs, patternIndex + 1);
}

/**
 * Match a concrete path against a glob pattern.
 * @param {string} path concrete forward-slash path
 * @param {string} pattern glob pattern
 * @returns {boolean} true when the path is covered by the pattern
 */
export function matchesGlob(path, pattern) {
  const normalizedPath = normalize(path);
  const rawPattern = normalize(pattern);
  if (rawPattern.length === 0) return false;

  // Trailing slash → prefix match: the dir itself and anything beneath it.
  if (rawPattern.endsWith('/')) {
    const prefix = rawPattern.slice(0, -1);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return globSegmentsMatch(segments(normalizedPath), 0, segments(rawPattern), 0);
}

/**
 * The longest literal (wildcard-free) prefix of a glob, as a normalized path.
 * @param {string} pattern glob pattern
 * @returns {string} literal prefix (no trailing slash)
 */
export function literalPrefix(pattern) {
  const normalized = normalize(pattern).replace(/\/$/, '');
  const out = [];
  for (const seg of segments(normalized)) {
    if (seg.includes('*')) break;
    out.push(seg);
  }
  return out.join('/');
}

/**
 * Whether `pattern` is a broad envelope (`**` or a trailing-slash dir).
 * @param {string} pattern glob pattern
 * @returns {boolean}
 */
export function isEnvelope(pattern) {
  const normalized = normalize(pattern);
  return normalized.endsWith('/') || segments(normalized).includes('**');
}

/**
 * Whether one literal prefix contains the other (prefix containment).
 * @param {string} a first literal prefix
 * @param {string} b second literal prefix
 * @returns {boolean}
 */
export function prefixContains(a, b) {
  if (a === '' || b === '') return a === b || a === '' || b === '';
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Conservative test of whether two single globs can match a common path.
 *
 * Heuristic (favors false-positive — report overlap when unsure):
 *  1. identical patterns overlap;
 *  2. either pattern matches the other's literal prefix (concrete containment);
 *  3. an envelope (`**` / trailing-slash) whose literal prefix contains, or is
 *     contained by, the other's literal prefix overlaps.
 * @param {string} globA first glob
 * @param {string} globB second glob
 * @returns {boolean} true when the two could collide on some path
 */
export function globsCanOverlap(globA, globB) {
  const a = normalize(globA);
  const b = normalize(globB);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  if (matchesGlob(literalPrefix(a) || a, b)) return true;
  if (matchesGlob(literalPrefix(b) || b, a)) return true;
  if (isEnvelope(a) || isEnvelope(b)) {
    return prefixContains(literalPrefix(a), literalPrefix(b));
  }
  return false;
}
