/**
 * Scan rendered methodology templates for unresolved placeholders or dogfood
 * identifiers before they are allowed to ship.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_RE = /\{\{[^{}\r\n]+\}\}/g;
const DOGFOOD_RE = /\b(?:BIZ-\d{4}|ADR-01\d{2})\b/g;

/**
 * Recursively scan a rendered template tree.
 *
 * @param {string} templateTree file or directory to scan
 * @returns {{ok:boolean,violations:Array<{path:string,kind:string,matches:string[]}>}}
 */
export function leakScrub(templateTree) {
  const violations = [];
  const visit = (path) => {
    if (!existsSync(path)) {
      violations.push({ path, kind: 'missing', matches: [] });
      return;
    }
    const entry = statSync(path);
    if (entry.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    let content;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      violations.push({ path, kind: 'unreadable', matches: [] });
      return;
    }
    if (content.includes('\u0000')) return;
    const tokens = [...new Set(content.match(TOKEN_RE) || [])];
    const dogfood = [...new Set(content.match(DOGFOOD_RE) || [])];
    if (tokens.length) violations.push({ path, kind: 'unresolved-token', matches: tokens });
    if (dogfood.length) violations.push({ path, kind: 'dogfood-identifier', matches: dogfood });
  };
  visit(templateTree);
  return { ok: violations.length === 0, violations };
}

/**
 * Throwing boundary wrapper for the CI leak guard.
 *
 * @param {string} templateTree file or directory to scan
 * @returns {{ok:true,violations:[]}}
 * @throws {Error} when a token or dogfood identifier remains
 */
export function assertLeakFree(templateTree) {
  const verdict = leakScrub(templateTree);
  if (!verdict.ok) throw new Error('template leak scrub failed: ' + JSON.stringify(verdict.violations));
  return verdict;
}
