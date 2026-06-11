/**
 * Boot signal — project-map health (ADR-0046). Split out of `boot-signals.mjs`
 * to keep that file under the line budget; re-exported there so consumers
 * (`session-start.mjs`) keep importing `projectMapStale` from one place.
 *
 * Surfaces, from the committed `manifest.json`, what the script already computed
 * (0 tokens here): architectural-rule VIOLATIONS, dependency CYCLES, and a
 * STALENESS nudge (a BOUNDED files+bytes recompute — structural, clone-safe,
 * churn-free). Self-contained: no `tools/` import. Silent without a map or on error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Source extensions the map counts — kept in sync with project-map-core's EXT_LANG. */
const MAP_SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.sql']);

/** Bounded files+bytes walk over a module dir (caps total stats to stay cheap). */
function filesAndBytesUnder(absDir, budget) {
  let files = 0;
  let bytes = 0;
  let entries = [];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const e of entries) {
    if (budget.n <= 0) break;
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = resolve(absDir, e.name);
    if (e.isDirectory()) {
      const r = filesAndBytesUnder(full, budget);
      files += r.files;
      bytes += r.bytes;
    } else {
      const dot = e.name.lastIndexOf('.');
      if (dot < 0 || !MAP_SOURCE_EXTS.has(e.name.slice(dot).toLowerCase())) continue;
      budget.n -= 1;
      files += 1;
      try {
        bytes += statSync(full).size;
      } catch {
        /* ignore */
      }
    }
  }
  return { files, bytes };
}

/** True when the committed map no longer matches the tree (bounded files+bytes walk). */
function mapIsStale(root, manifest) {
  const budget = { n: 400 };
  for (const mod of manifest.modules) {
    if (budget.n <= 0) break;
    const cur = filesAndBytesUnder(resolve(root, String(mod.path)), budget);
    if (budget.n <= 0) break; // truncated module → don't trust the count (rule 8)
    if (cur.files !== Number(mod.files) || cur.bytes !== Number(mod.bytes)) return true;
  }
  return false;
}

/**
 * project-map boot signal — violations + cycles (from `manifest.{violations,
 * insights}`) plus a staleness nudge. Returns a block or null. Named
 * `projectMapStale` for back-compat; now reports health too. [ADR-0046]
 */
export function projectMapStale(root) {
  try {
    const dir = pathsFor(root).projectMap;
    const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf-8'));
    if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) return null;
    const lines = [];
    const violations = Array.isArray(manifest.violations) ? manifest.violations : [];
    const cycles = Array.isArray(manifest.insights?.cycles) ? manifest.insights.cycles : [];
    if (violations.length) lines.push(`⛔ **${violations.length} architecture-rule violation(s)** — ${violations.slice(0, 2).map((v) => `\`${v.from}\`→\`${v.to}\``).join(', ')}. Run \`/project-map --check\`.`);
    if (cycles.length) lines.push(`🔄 **${cycles.length} dependency cycle(s)** in the module graph — see the project map's Architecture health.`);
    if (mapIsStale(root, manifest)) lines.push('🗺️  Project map is **stale** — source changed since it was generated. Run `/project-map` to refresh (`--check` to diff).');
    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}
