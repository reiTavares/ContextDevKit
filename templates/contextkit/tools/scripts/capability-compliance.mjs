#!/usr/bin/env node
/**
 * Per-host capability compliance matrix builder (CDK-061, PKG-06).
 *
 * Builds a deterministic matrix: for each capability in the canonical registry,
 * mark whether each host {claude, codex, agy} can NATIVELY invoke it via its
 * host alias. Outputs a matrix + summary count. Advisory, additive, zero-dep.
 *
 * Exit 0 always (fail-open); never throws.
 *
 * @module capability-compliance
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads the capability registry. Never throws; falls back to embedded default.
 *
 * @param {string} [root] project root
 * @returns {Promise<object>} registry with version & capabilities array
 */
async function loadRegistry(root = process.cwd()) {
  try {
    // Dynamic import relative to import.meta.url to avoid hardcoding 'contextkit/'.
    const resolveCapUrl = pathToFileURL(
      resolve(__dirname, '../../runtime/capabilities/resolve-capabilities.mjs'),
    ).href;
    const { loadRegistry: load, DEFAULT_REGISTRY } = await import(resolveCapUrl);
    return load(root);
  } catch {
    // Fallback: return a minimal default on any error.
    return {
      version: 1,
      capabilities: [],
    };
  }
}

/**
 * Determines if a host can natively invoke a capability.
 * True iff the capability's aliases object has a non-empty value for that host.
 *
 * @param {object} capability entry from the registry
 * @param {string} hostName 'claude', 'codex', or 'agy'
 * @returns {boolean}
 */
function hostCanInvoke(capability, hostName) {
  const alias = capability?.aliases?.[hostName];
  return Boolean(alias && typeof alias === 'string' && alias.length > 0);
}

/**
 * Builds the compliance matrix: one row per capability, columns for each host.
 * Verdict: 'parity' if all hosts can invoke, 'GAP' if some can't (no skip reason).
 *
 * @param {object} registry capability registry
 * @returns {Array<{id: string, claude: boolean, codex: boolean, agy: boolean, verdict: 'parity'|'GAP'}>}
 */
export function buildComplianceMatrix(registry) {
  const caps = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  const matrix = caps.map((cap) => {
    const id = String(cap?.id ?? '');
    const claude = hostCanInvoke(cap, 'claude');
    const codex = hostCanInvoke(cap, 'codex');
    const agy = hostCanInvoke(cap, 'agy');

    // Verdict: all present = parity; any absent (no reason) = GAP.
    const allPresent = claude && codex && agy;
    const verdict = allPresent ? 'parity' : 'GAP';

    return { id, claude, codex, agy, verdict };
  });

  // Stable sort by capability id.
  return matrix.slice().sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Summarizes the matrix: total count, parity count, gap count.
 *
 * @param {Array<{id: string, verdict: 'parity'|'GAP'}>} matrix
 * @returns {{total: number, parity: number, gaps: number}}
 */
export function summarize(matrix) {
  const total = matrix.length;
  const parity = matrix.filter((row) => row.verdict === 'parity').length;
  const gaps = total - parity;
  return { total, parity, gaps };
}

/**
 * CLI entry point. Loads registry, builds matrix, prints human-readable output.
 */
async function main() {
  try {
    const registry = await loadRegistry();
    const matrix = buildComplianceMatrix(registry);
    const summary = summarize(matrix);

    // Header
    console.log('\nCapability Compliance Matrix\n');
    console.log('ID\t\t\t\tClaude\tCodex\tAgy\tVerdict');
    console.log('─'.repeat(70));

    // Rows
    for (const row of matrix) {
      const idPad = row.id.padEnd(28);
      const claudeStr = row.claude ? '✓' : '✗';
      const codexStr = row.codex ? '✓' : '✗';
      const agyStr = row.agy ? '✓' : '✗';
      const verdict = row.verdict;
      console.log(`${idPad}\t${claudeStr}\t${codexStr}\t${agyStr}\t${verdict}`);
    }

    // Summary
    console.log('─'.repeat(70));
    console.log(
      `\n${summary.total} capabilities · ${summary.parity} parity · ${summary.gaps} gaps\n`,
    );
  } catch (err) {
    // Fail-open: always exit 0, log the error for visibility.
    console.error(`\n⚠ capability-compliance error: ${err?.message ?? err}\n`);
  }

  process.exit(0);
}

// Run if invoked directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { loadRegistry };
