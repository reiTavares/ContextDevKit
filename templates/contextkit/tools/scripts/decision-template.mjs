/**
 * Deterministic ADR (Authoritative Decision Record) template renderer
 * (BIZ-0001 / WF-0037, B1-T3).
 *
 * Renders the v2 ADR templates under `decisions/_templates/` to a schema-valid
 * ADR markdown by substituting `{{TOKEN}}` placeholders with a field map. Pure,
 * deterministic (same inputs → byte-identical output), dry-run by default — an
 * explicit `apply` performs an atomic (tmp+rename) write (constitution §8).
 *
 * Templates carry NO invented domain content: front-matter tokens + canonical
 * section headings with italic guidance only. The renderer never invents values;
 * a missing token is a typed error, never a silent blank. Pure `node:*`, zero deps.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

/** The shipped template file names, keyed by short kind. */
export const DECISION_TEMPLATES = Object.freeze({
  business: 'adr-business.template.md',
  operation: 'adr-operation.template.md',
  'routine-operation-governance': 'adr-routine-operation-governance.template.md',
  'emergency-governance': 'adr-emergency-governance.template.md',
});

const TOKEN_RE = /\{\{(\w+)\}\}/g;

/** Absolute path to the `_templates` dir (single-sourced via paths.decisions). */
function templatesDir(root) {
  return resolve(pathsFor(root).decisions, '_templates');
}

/**
 * Substitutes `{{TOKEN}}` placeholders in `text` with values from `fields`.
 * Deterministic and total: returns the rendered text plus any tokens that had no
 * value (so the caller can refuse rather than emit a blank).
 *
 * @param {string} text - the template body.
 * @param {Record<string,string|number>} fields - token → value map.
 * @returns {{ text: string, missing: string[] }}
 */
export function renderTemplate(text, fields = {}) {
  const missing = [];
  const rendered = String(text).replace(TOKEN_RE, (whole, key) => {
    if (fields[key] === undefined || fields[key] === null) {
      missing.push(key);
      return whole;
    }
    return String(fields[key]);
  });
  return { text: rendered, missing: [...new Set(missing)] };
}

/**
 * Loads a shipped template by kind. BOM-safe; throws a typed error when the kind
 * is unknown or the file is absent (fail-fast at the boundary).
 *
 * @param {string} kind - one of `DECISION_TEMPLATES` keys.
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the raw template text.
 * @throws {Error} when the kind is unknown or the template file is missing.
 */
export function loadTemplate(kind, root = process.cwd()) {
  const name = DECISION_TEMPLATES[kind];
  if (!name) throw new Error(`decision-template: unknown kind "${kind}"`);
  const target = resolve(templatesDir(root), name);
  if (!existsSync(target)) throw new Error(`decision-template: template not found at ${target}`);
  return stripBom(readFileSync(target, 'utf-8'));
}

/**
 * Renders an ADR from a template kind + field map. Dry-run by default: returns
 * the rendered text and a plan, writing nothing. With `apply:true` + `outPath`,
 * writes atomically. Refuses (no write) when any token is unresolved.
 *
 * @param {object} args
 * @param {string} args.kind - template kind.
 * @param {Record<string,string|number>} args.fields - token values.
 * @param {string} [args.root] - project root (default cwd).
 * @param {string} [args.outPath] - absolute path to write when applying.
 * @param {boolean} [args.apply] - perform the atomic write (default false).
 * @returns {{ ok: boolean, applied: boolean, text: string, missing: string[], path: string|null }}
 */
export function renderDecisionFromTemplate({ kind, fields, root = process.cwd(), outPath = null, apply = false }) {
  const { text, missing } = renderTemplate(loadTemplate(kind, root), fields);
  if (missing.length > 0) {
    return { ok: false, applied: false, text, missing, path: null };
  }
  if (apply && outPath) {
    writeFileAtomicSync(outPath, text.endsWith('\n') ? text : `${text}\n`);
    return { ok: true, applied: true, text, missing: [], path: outPath };
  }
  return { ok: true, applied: false, text, missing: [], path: outPath };
}
