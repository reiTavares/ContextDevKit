/**
 * Workflow index frontmatter parsing (extracted from workflow-pack.mjs at the
 * serialization seam, ADR-0119 — keeps the lifecycle module under its line budget).
 *
 * A workflow `index.md` opens with a `--- ... ---` block of flat `key: value`
 * lines followed by the markdown body. Pure `node:*`, zero runtime dependencies.
 */

/**
 * Splits a workflow index's leading frontmatter from its body.
 *
 * @param {string} text - the full `index.md` contents.
 * @returns {{frontmatter: Record<string,string>, body: string}|null} the parsed
 *   key/value map + the trailing body, or `null` when there is no frontmatter.
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter, body: match[2] ?? '' };
}
