/**
 * Project-map RULES — architectural fitness functions over the dependency graph.
 *
 * The autonomy floor (ADR-0041) gates EDITING a secrets file; this adds the EDGE
 * view it lacks — "who now imports auth/secrets" and "frontend → backend". Rules
 * are PATH-PREFIX based (reliable; a heuristic role must never fail CI) and
 * OPT-IN: no `rules.json` ⇒ no enforcement (refuse-by-default for a feature, §8).
 * Once enrolled, the sensitive set is AUGMENTED from `matchSecret` so credential
 * dirs are auto-covered — the floor's denylist is reused, never reinvented.
 * [ADR-0046]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchSecret } from '../../runtime/hooks/path-classification.mjs';

/**
 * Loads `rules.json` from the project-map dir. Returns null when absent or
 * malformed (⇒ enforcement is off — opt-in). Never throws.
 * @returns {{forbidden:Array, sensitive:Array}|null}
 */
export function loadRules(dir) {
  let raw;
  try {
    raw = readFileSync(resolve(dir, 'rules.json'), 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      forbidden: Array.isArray(parsed.forbidden) ? parsed.forbidden : [],
      sensitive: Array.isArray(parsed.sensitive) ? parsed.sensitive : [],
    };
  } catch {
    return null;
  }
}

const underPrefix = (path, prefix) => path === prefix || path.startsWith(prefix.replace(/\/+$/, '') + '/');

/** Sensitive module paths = declared in rules + any module matchSecret recognizes. */
function sensitiveSet(modules, rules) {
  const map = new Map(); // path → allowedInto[]
  for (const entry of rules.sensitive) {
    if (entry && typeof entry.module === 'string') map.set(entry.module, Array.isArray(entry.allowedInto) ? entry.allowedInto : []);
  }
  for (const m of modules) {
    // matchSecret works on a path; probe the module dir. Auto-covered, but the
    // user can still declare allowedInto by listing the same path explicitly.
    if (!map.has(m.path) && matchSecret(`${m.path}/`)) map.set(m.path, []);
  }
  return map;
}

/**
 * Evaluate the dependency graph against the rules → a sorted violation list.
 * Pure (no I/O). Empty when `rules` is null (enforcement off).
 *
 * @param {Array<{path:string, deps?:string[]}>} modules
 * @param {{forbidden:Array, sensitive:Array}|null} rules
 * @returns {Array<{rule:string, from:string, to:string, reason:string}>}
 */
export function evaluateRules(modules, rules) {
  if (!rules) return [];
  const violations = [];
  const sensitive = sensitiveSet(modules, rules);
  for (const m of modules) {
    for (const dep of m.deps || []) {
      // Forbidden layering edges (path-prefix → path-prefix).
      for (const f of rules.forbidden) {
        if (!f || typeof f.from !== 'string' || typeof f.to !== 'string') continue;
        if (underPrefix(m.path, f.from) && underPrefix(dep, f.to)) {
          violations.push({ rule: 'forbidden-edge', from: m.path, to: dep, reason: f.reason || `${f.from} ⊀ ${f.to}` });
        }
      }
      // Imports INTO a sensitive module from a non-allowed importer.
      if (sensitive.has(dep) && m.path !== dep) {
        const allowed = sensitive.get(dep).some((prefix) => underPrefix(m.path, prefix));
        if (!allowed) violations.push({ rule: 'sensitive-import', from: m.path, to: dep, reason: `import into sensitive ${dep}` });
      }
    }
  }
  return violations.sort((a, b) => `${a.rule}${a.from}${a.to}`.localeCompare(`${b.rule}${b.from}${b.to}`));
}
