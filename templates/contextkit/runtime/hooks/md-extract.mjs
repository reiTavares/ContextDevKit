/**
 * Markdown extraction primitives — pure, zero-dep, defensive. [ADR-0027]
 *
 * Generic helpers shared by the session and ADR digest cores (the second
 * consumer that justified the split). No I/O, no path construction — callers
 * pass already-split lines or raw values. Each helper degrades to '' / [] rather
 * than throwing, so a malformed document never breaks a digest.
 */

/** Clips to `max` chars with a trailing ellipsis when over budget. */
export const clip = (text, max) =>
  String(text).length > max ? `${String(text).slice(0, max - 1).trimEnd()}…` : String(text);

/** Strips markdown noise: `[label](url)` → `label`, drops `*_\`` markers, collapses ws. */
export function stripMd(value) {
  return String(value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Body lines under a `## …<keyword>…` heading, until the next `##`/`---`/EOF. */
export function section(lines, keyword) {
  const kw = keyword.toLowerCase();
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.toLowerCase().includes(kw));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s+/.test(l) || l.trim() === '---');
  return rest.slice(0, end === -1 ? rest.length : end);
}

/** First prose paragraph of a section as one clean line (markdown stripped). */
export function firstParagraph(sectionLines, max = 180) {
  const buffer = [];
  for (const raw of sectionLines) {
    const line = raw.replace(/^>\s?/, '');
    if (!line.trim()) {
      if (buffer.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    buffer.push(line.replace(/^[-*]\s+/, '').trim());
    if (buffer.join(' ').length >= max) break;
  }
  return clip(stripMd(buffer.join(' ')), max);
}

/** Bullet items of a section (text after the marker, markdown stripped), each clipped. */
export function bullets(sectionLines, max = 110) {
  return sectionLines
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => clip(stripMd(l.replace(/^\s*[-*]\s+/, '')), max))
    .filter(Boolean);
}

/** Reads a `- **Label**: value` metadata bullet (backticks stripped); '' if absent. */
export function metaValue(lines, label) {
  const re = new RegExp(`^[-*]\\s*\\*\\*${label}\\*\\*:\\s*(.+)$`, 'i');
  for (const l of lines) {
    const m = re.exec(l.trim());
    if (m) return m[1].replace(/`/g, '').trim();
  }
  return '';
}
