/**
 * Self-check — ENCODING integrity (ticket 144).
 *
 * Tree-wide guard against UTF-8-read-as-cp1252 mojibake: a Windows
 * PowerShell 5.1 `Get-Content`/`Set-Content` round-trip (or any ANSI-default
 * editor) silently corrupts every non-ASCII char — an em-dash becomes the
 * "a-circumflex + euro + quote" triplet, section signs and cedillas gain a
 * spurious A-circumflex/A-tilde prefix. This corrupted 68 agent files in
 * session 52 and recurred twice since — the class is cheap to detect and
 * expensive to hand-repair, so it gets a permanent gate.
 *
 * Detection: proper UTF-8 text never contains U+00E2 U+20AC (the mis-decoded
 * lead bytes of dash/quote/ellipsis chars) or U+00C2/U+00C3 followed by a
 * char in the U+00A0-U+00BF block — those pairs only appear when UTF-8 bytes
 * were decoded as cp1252. The pattern uses ASCII-only escapes so this file
 * can never flag itself.
 */
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

/** Mojibake fingerprints — see header. ASCII-only escapes (self-immunity). */
const MOJIBAKE_PATTERN = /\u00e2\u20ac|[\u00c2\u00c3][\u00a0-\u00bf]/;

/** Text trees + extensions worth scanning (generated + hand-written sources). */
const SCAN_ROOTS = ['templates', 'docs', 'tools', 'install.mjs', 'README.md', 'instrucoes.md'];
const TEXT_EXTENSIONS = ['.md', '.mjs', '.json', '.tpl', '.yaml', '.yml', '.txt'];

async function listTextFiles(absPath) {
  const collected = [];
  let entries = [];
  try {
    entries = await readdir(absPath, { withFileTypes: true });
  } catch {
    // A file (not a dir) or missing — caller already filtered existence.
    return TEXT_EXTENSIONS.some((ext) => absPath.endsWith(ext)) ? [absPath] : [];
  }
  for (const entry of entries) {
    const child = resolve(absPath, entry.name);
    if (entry.isDirectory()) collected.push(...(await listTextFiles(child)));
    else if (TEXT_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) collected.push(child);
  }
  return collected;
}

/**
 * Runs the encoding-integrity scan. Reports ONE ok/bad line so the gate stays
 * token-light; failures list the offending files (capped) so the fix is
 * obvious: restore the file from git or re-type the corrupted characters.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx  repo root
 */
export async function runEncodingChecks({ ok, bad }, { KIT }) {
  console.log('Checking encoding integrity — no UTF-8/cp1252 mojibake (ticket 144)...');
  const corrupted = [];
  let scanned = 0;
  for (const rootRel of SCAN_ROOTS) {
    for (const filePath of await listTextFiles(resolve(KIT, rootRel))) {
      scanned++;
      const text = await readFile(filePath, 'utf-8').catch(() => '');
      if (MOJIBAKE_PATTERN.test(text)) corrupted.push(relative(KIT, filePath).replaceAll('\\', '/'));
    }
  }
  corrupted.length === 0
    ? ok(`no mojibake across ${scanned} text file(s) (ticket 144)`)
    : bad(
        `mojibake (UTF-8 mis-decoded as cp1252) in ${corrupted.length} file(s): ` +
          `${corrupted.slice(0, 5).join(', ')}${corrupted.length > 5 ? ` …+${corrupted.length - 5}` : ''} ` +
          '— restore from git or fix the characters; never round-trip files through PS5.1 Get/Set-Content',
      );
}
