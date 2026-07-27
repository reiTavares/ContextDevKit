/**
 * decision-frontmatter.mjs — YAML front-matter surgery for the `decision` verbs.
 *
 * `handleAccept` used to compute the fields to stamp and then hand them back as a
 * "patch receipt" for a human to apply by hand, on the grounds that front-matter
 * rewriting is non-trivial YAML. In practice that made `--apply` print
 * `wrote 1 file(s)` while the ADR stayed `proposed` — write INTENT reported as a
 * write. Two sessions in a row hand-stamped the same block. This module closes
 * that gap with targeted, deterministic surgery instead of a YAML dependency
 * (immutable rule 1: `node:*` only).
 *
 * Scope is deliberately narrow: replace or insert TOP-LEVEL scalar keys, and
 * replace or insert ONE level of nested mapping (`approvalSource:` + its indented
 * children). That is the whole shape an ADR front-matter patch touches. Anything
 * outside it — lists, deep nesting, anchors, multi-line scalars — is left
 * untouched, and an unparseable file is REFUSED rather than rewritten (default to
 * refuse, constitution §8).
 *
 * Line endings and BOM are preserved: this repo is edited on Windows, so a
 * normalising rewrite would show up as a whole-file diff.
 *
 * @module decision-frontmatter
 */

/** Keys are plain identifiers in ADR front-matter; anything else is refused. */
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Splits a document into its front-matter block and everything after it.
 * Returns null when the document has no leading `---` block (never throws).
 *
 * @param {string} text - full document contents (BOM already stripped).
 * @returns {{block: string, rest: string, eol: string}|null}
 */
export function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*|)$/.exec(text);
  if (!match) return null;
  const block = match[1];
  const eol = /\r\n/.test(match[0]) ? '\r\n' : '\n';
  return { block, rest: match[2] ?? '', eol };
}

/**
 * Renders a YAML scalar. `null` becomes the literal `null`; strings are emitted
 * bare (ADR front-matter values are ids, dates, enums — never quoted in the
 * shipped template), and anything needing quoting is refused by the caller.
 *
 * @param {unknown} value
 * @returns {string}
 */
function renderScalar(value) {
  if (value === null || value === undefined) return 'null';
  return String(value);
}

/**
 * Index of the line declaring a top-level `key:`, or -1.
 * Top-level means column 0 — an indented `  id:` inside a nested block never matches.
 *
 * @param {string[]} lines
 * @param {string} key
 * @returns {number}
 */
function topLevelIndex(lines, key) {
  return lines.findIndex((line) => line.startsWith(`${key}:`));
}

/**
 * Last index of the nested block that starts at `startIndex` — i.e. the final
 * indented child line. Returns `startIndex` when the key has no children.
 *
 * @param {string[]} lines
 * @param {number} startIndex
 * @returns {number}
 */
function nestedBlockEnd(lines, startIndex) {
  let end = startIndex;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^[ \t]/.test(lines[i])) end = i;
    else break;
  }
  return end;
}

/**
 * Sets a top-level scalar key, replacing the existing line when present and
 * appending at the end of the block otherwise.
 *
 * @param {string[]} lines - front-matter lines (mutated).
 * @param {string} key
 * @param {unknown} value
 * @returns {'replaced'|'inserted'}
 */
function setScalar(lines, key, value) {
  const rendered = `${key}: ${renderScalar(value)}`;
  const index = topLevelIndex(lines, key);
  if (index === -1) {
    lines.push(rendered);
    return 'inserted';
  }
  lines[index] = rendered;
  return 'replaced';
}

/**
 * Sets a top-level nested mapping (one level of indented `key: value` children),
 * replacing the whole existing block when present and appending otherwise.
 *
 * @param {string[]} lines - front-matter lines (mutated).
 * @param {string} key
 * @param {Record<string, unknown>} mapping
 * @returns {'replaced'|'inserted'}
 */
function setMapping(lines, key, mapping) {
  const rendered = [`${key}:`, ...Object.entries(mapping).map(([k, v]) => `  ${k}: ${renderScalar(v)}`)];
  const index = topLevelIndex(lines, key);
  if (index === -1) {
    lines.push(...rendered);
    return 'inserted';
  }
  lines.splice(index, nestedBlockEnd(lines, index) - index + 1, ...rendered);
  return 'replaced';
}

/**
 * Reads one front-matter value: a top-level scalar (`'status'`) or a one-level
 * nested child (`'approvalSource.id'`). Returns null when absent, empty, or a
 * placeholder (`TBD` / `null`), so a caller can tell "no real value here" from
 * "a value I must preserve".
 *
 * @param {string} block - the raw front-matter block.
 * @param {string} path - `'key'` or `'key.child'`.
 * @returns {string|null}
 */
export function readField(block, path) {
  const lines = block.split(/\r?\n/);
  const [key, childKey] = path.split('.');
  const index = topLevelIndex(lines, key);
  if (index === -1) return null;
  let raw;
  if (childKey === undefined) {
    raw = lines[index].slice(key.length + 1).trim();
  } else {
    const child = lines
      .slice(index + 1, nestedBlockEnd(lines, index) + 1)
      .find((line) => line.trim().startsWith(`${childKey}:`));
    if (!child) return null;
    raw = child.trim().slice(childKey.length + 1).trim();
  }
  return raw === '' || raw === 'TBD' || raw === 'null' ? null : raw;
}

/**
 * True when the front-matter already carries exactly this patch — the signal the
 * caller uses to report an idempotent no-op instead of rewriting identical bytes.
 *
 * @param {string} block - the raw front-matter block.
 * @param {Record<string, unknown>} patch
 * @returns {boolean}
 */
export function alreadyStamped(block, patch) {
  const lines = block.split(/\r?\n/);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === 'object') {
      const index = topLevelIndex(lines, key);
      if (index === -1) return false;
      const children = lines.slice(index + 1, nestedBlockEnd(lines, index) + 1).map((line) => line.trim());
      for (const [childKey, childValue] of Object.entries(value)) {
        if (!children.includes(`${childKey}: ${renderScalar(childValue)}`)) return false;
      }
    } else if (topLevelIndex(lines, key) === -1 || lines[topLevelIndex(lines, key)] !== `${key}: ${renderScalar(value)}`) {
      return false;
    }
  }
  return true;
}

/**
 * Stamps a patch into a document's YAML front-matter and returns the new text.
 *
 * Scalar values replace (or append) a top-level key; a plain-object value
 * replaces (or appends) a one-level nested mapping. The body after the
 * front-matter is returned byte-identical, and the document's original line
 * ending is preserved.
 *
 * @param {string} text - full document contents.
 * @param {Record<string, unknown>} patch - fields to stamp.
 * @returns {{text: string, changes: Record<string,'replaced'|'inserted'>}}
 * @throws {Error} when the document has no front-matter, the patch is empty, a
 *   key is not a plain identifier, or a value is an array / nested deeper than
 *   one level (refused rather than guessed).
 */
export function stampFrontmatter(text, patch) {
  const parsed = splitFrontmatter(text);
  if (!parsed) {
    throw new Error('decision-frontmatter: refused — document has no leading `---` YAML front-matter block');
  }
  const entries = Object.entries(patch ?? {});
  if (entries.length === 0) {
    throw new Error('decision-frontmatter: refused — empty patch (nothing to stamp)');
  }

  const lines = parsed.block.split(/\r?\n/);
  const changes = {};
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`decision-frontmatter: refused — unsupported front-matter key "${key}"`);
    }
    if (Array.isArray(value)) {
      throw new Error(`decision-frontmatter: refused — list value for "${key}" is outside this module's scope`);
    }
    if (value !== null && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childValue !== null && typeof childValue === 'object') {
          throw new Error(`decision-frontmatter: refused — "${key}.${childKey}" nests deeper than one level`);
        }
      }
      changes[key] = setMapping(lines, key, value);
    } else {
      changes[key] = setScalar(lines, key, value);
    }
  }

  const { eol, rest } = parsed;
  return { text: `---${eol}${lines.join(eol)}${eol}---${rest}`, changes };
}
