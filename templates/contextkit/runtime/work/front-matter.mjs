/**
 * Hand-rolled, zero-dependency reader for ADR YAML front matter (schema v2,
 * BIZ-0001 / WF-0037 / B1-T1). NO YAML library — front matter is a flat-ish
 * block (scalars, nested objects one or two levels deep, and simple lists),
 * which a small line-oriented parser handles deterministically.
 *
 * Scope (deliberately minimal — matches the proven ADR-0102 shape):
 *   - `--- … ---` fenced block at the top of the file;
 *   - `key: value` scalars (string / int / `true|false` / `null`);
 *   - nested maps via indentation (e.g. `primaryContext:` then `  type: …`);
 *   - block sequences via `  - item` (scalars) and `  - key: …` (maps in lists).
 *
 * It is NOT a general YAML engine; it does not handle anchors, flow style, or
 * multi-line scalars. Those are not used by schema v2. Defensive: never throws —
 * malformed input returns `{ hasFrontMatter:false }` or partial data, and the
 * VALIDATOR (`schema-decision.mjs`) is the authority on correctness.
 *
 * Cohesion note: kept as one file (~190 lines) because the block reader, scalar
 * coercion, and the public entry are a single parsing concern; splitting would
 * be premature abstraction (constitution §1).
 */
import { stripBom } from './enums.mjs';

const FRONT_MATTER_FENCE = /^---\s*$/;

/**
 * Extracts the raw front-matter block (between the first two `---` fences) and
 * the body that follows. BOM-safe. Never throws.
 *
 * @param {unknown} raw - full file contents.
 * @returns {{ hasFrontMatter: boolean, block: string, body: string }}
 */
export function splitFrontMatter(raw) {
  const text = typeof raw === 'string' ? stripBom(raw) : '';
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !FRONT_MATTER_FENCE.test(lines[0])) {
    return { hasFrontMatter: false, block: '', body: text };
  }
  let closeAt = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONT_MATTER_FENCE.test(lines[index])) {
      closeAt = index;
      break;
    }
  }
  if (closeAt === -1) return { hasFrontMatter: false, block: '', body: text };
  return {
    hasFrontMatter: true,
    block: lines.slice(1, closeAt).join('\n'),
    body: lines.slice(closeAt + 1).join('\n'),
  };
}

/**
 * Coerces a scalar token to a JS value: `null`, booleans, plain integers, and
 * (de-quoted) strings. Unknown shapes fall through as the trimmed string.
 *
 * @param {string} token - the raw value text after `key:`.
 * @returns {unknown} the coerced value.
 */
function coerceScalar(token) {
  const value = token.trim();
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Counts leading spaces (indentation depth) of a line. */
function indentOf(line) {
  const match = /^( *)/.exec(line);
  return match ? match[1].length : 0;
}

/**
 * Parses a contiguous block of lines at a given indent into a plain object.
 * Recurses for nested maps and parses `- ` sequences into arrays. Internal.
 *
 * @param {string[]} lines - all block lines.
 * @param {number} start - first line index to consider.
 * @param {number} indent - the indent level this scope owns.
 * @returns {{ value: object, next: number }} parsed map + index after the scope.
 */
function parseMap(lines, start, indent) {
  const result = {};
  let cursor = start;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      cursor += 1;
      continue;
    }
    const depth = indentOf(line);
    if (depth < indent) break;
    if (depth > indent) {
      cursor += 1; // defensive: skip stray over-indent we did not expect
      continue;
    }
    const content = line.slice(indent);
    const colonAt = content.indexOf(':');
    if (colonAt === -1) {
      cursor += 1;
      continue;
    }
    const key = content.slice(0, colonAt).trim();
    const rest = content.slice(colonAt + 1).trim();
    if (rest === '') {
      const childIndent = nextChildIndent(lines, cursor + 1, indent);
      if (childIndent !== null && isSequence(lines, cursor + 1, childIndent)) {
        const seq = parseSequence(lines, cursor + 1, childIndent);
        result[key] = seq.value;
        cursor = seq.next;
      } else if (childIndent !== null) {
        const child = parseMap(lines, cursor + 1, childIndent);
        result[key] = child.value;
        cursor = child.next;
      } else {
        result[key] = null;
        cursor += 1;
      }
    } else {
      result[key] = coerceScalar(rest);
      cursor += 1;
    }
  }
  return { value: result, next: cursor };
}

/** Finds the indent of the first non-blank child line, or null if none deeper. */
function nextChildIndent(lines, start, parentIndent) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() === '') continue;
    const depth = indentOf(lines[index]);
    return depth > parentIndent ? depth : null;
  }
  return null;
}

/** True when the line at `start`/`indent` begins a `- ` block sequence. */
function isSequence(lines, start, indent) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() === '') continue;
    if (indentOf(lines[index]) !== indent) return false;
    return lines[index].slice(indent).startsWith('- ') || lines[index].slice(indent).trim() === '-';
  }
  return false;
}

/**
 * Parses a `- item` block sequence into an array. Scalar items coerce; `- key:`
 * items become single-entry maps merged with following indented keys.
 *
 * @param {string[]} lines - all block lines.
 * @param {number} start - first sequence line index.
 * @param {number} indent - the indent the `- ` markers sit at.
 * @returns {{ value: unknown[], next: number }}
 */
function parseSequence(lines, start, indent) {
  const items = [];
  let cursor = start;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() === '') {
      cursor += 1;
      continue;
    }
    if (indentOf(line) !== indent || !line.slice(indent).startsWith('-')) break;
    const after = line.slice(indent + 1).trim();
    const colonAt = after.indexOf(':');
    if (after !== '' && colonAt !== -1) {
      // `- key: value` → start a map item; merge deeper keys at indent+2.
      const entry = {};
      entry[after.slice(0, colonAt).trim()] = coerceScalar(after.slice(colonAt + 1));
      const child = parseMap(lines, cursor + 1, indent + 2);
      Object.assign(entry, child.value);
      items.push(entry);
      cursor = child.next;
    } else {
      items.push(coerceScalar(after));
      cursor += 1;
    }
  }
  return { value: items, next: cursor };
}

/**
 * Reads a file's YAML front matter into a plain object (schema v2 shape).
 * Defensive: returns `{ ok:false }` when no front matter is present (e.g. a
 * legacy plain-markdown ADR), never throwing.
 *
 * @param {unknown} raw - full file contents.
 * @returns {{ ok: boolean, hasFrontMatter: boolean, data: object, body: string }}
 */
export function readFrontMatter(raw) {
  const split = splitFrontMatter(raw);
  if (!split.hasFrontMatter) {
    return { ok: false, hasFrontMatter: false, data: {}, body: split.body };
  }
  try {
    const lines = split.block.split('\n');
    const { value } = parseMap(lines, 0, 0);
    return { ok: true, hasFrontMatter: true, data: value, body: split.body };
  } catch {
    return { ok: false, hasFrontMatter: false, data: {}, body: split.body };
  }
}
