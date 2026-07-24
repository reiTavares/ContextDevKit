/**
 * Backfill `governance-contract.json` for work contexts that predate the WF-0088
 * emit hook (BIZ-0006 / ADR-0148 position 11).
 *
 * The emit hook writes a contract on every create/transition going forward, but
 * contexts created earlier carry none — so the advisory reader stays silent for
 * them. This one-shot, idempotent, fail-open backfill emits the contract for each
 * existing top-level Business context whose ceremony can be resolved. It is the
 * repeatable companion to the emit hook (mirrors docs-reindex / registry-rebuild).
 *
 * Dry-run by default (constitution §8); pass `--write` to apply. Never throws on a
 * single bad context — it reports `skipped` and moves on.
 *
 * Zero runtime dependencies — node:* + sibling emit adapter only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';
import { emitBusinessGovernanceContract } from './emit-business-contract.mjs';

/**
 * Backfill contracts for every Business context under the memory root.
 *
 * @param {string} root project root
 * @param {{ write?: boolean, now?: string }} [opts] apply flag + injectable clock
 * @returns {{ emitted: string[], skipped: Array<{id:string, reason:string}> }}
 */
export function backfillGovernanceContracts(root = process.cwd(), { write = false, now } = {}) {
  const paths = pathsFor(root);
  const emitted = [];
  const skipped = [];
  const businessRoot = paths.business;
  if (!businessRoot || !existsSync(businessRoot)) return { emitted, skipped };

  for (const entry of readdirSync(businessRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^BIZ-\d{4}/.test(entry.name)) continue;
    const contextDir = join(businessRoot, entry.name);
    const bizJsonPath = join(contextDir, 'business.json');
    if (!existsSync(bizJsonPath)) { skipped.push({ id: entry.name, reason: 'no business.json' }); continue; }
    let business;
    try {
      business = JSON.parse(stripBom(readFileSync(bizJsonPath, 'utf-8')));
    } catch {
      skipped.push({ id: entry.name, reason: 'unparseable business.json' });
      continue;
    }
    if (!write) {
      // Dry-run: report intent without touching disk (the adapter would write).
      skipped.push({ id: business.id || entry.name, reason: 'dry-run (pass --write)' });
      continue;
    }
    const result = emitBusinessGovernanceContract({
      business,
      contextDir,
      decisionsBusinessDir: paths.decisionsBusiness,
      ceremony: business?.intake?.ceremony,
      emittedBy: 'transition',
      now: now || new Date().toISOString(),
    });
    if (result.emitted) emitted.push(business.id || entry.name);
    else skipped.push({ id: business.id || entry.name, reason: result.reason });
  }
  return { emitted, skipped };
}

if (process.argv[1]?.endsWith('backfill-governance-contracts.mjs')) {
  const write = process.argv.includes('--write');
  const report = backfillGovernanceContracts(process.cwd(), { write });
  process.stdout.write(`governance-contract backfill (${write ? 'applied' : 'dry-run'})\n`);
  process.stdout.write(`  emitted: ${report.emitted.length}${report.emitted.length ? ` — ${report.emitted.join(', ')}` : ''}\n`);
  for (const s of report.skipped) process.stdout.write(`  skipped: ${s.id} (${s.reason})\n`);
}
