/**
 * integration-test-mcp-010-receipt-write.mjs — MCP-010 AC-1 + AC-4a: writeMcpReceipt.
 *
 * Acceptance criteria covered:
 *   AC-1   writeMcpReceipt is script-only + ATOMIC (tmp+rename); result stored in
 *          canonical taxonomy directory
 *   AC-4a  DEGRADED PATH (CDK-022 absent): local store used; substrate field = 'skipped'
 *
 * Suites:
 *   Suite 4 — writeMcpReceipt: atomic write, file integrity (AC-1, AC-4a)
 *   Suite 5 — writeMcpReceipt: store directory auto-created when absent (AC-1)
 *
 * Run:  node tools/integration-test-mcp-010-receipt-write.mjs
 * Exits non-zero on any failure.
 */

import { existsSync, readFileSync } from 'node:fs';
import { reporter } from './it-helpers.mjs';
import {
  writeMcpReceipt,
  receiptStoreDir,
  makeTmpRoot,
  cleanup,
} from './integration-test-mcp-010-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

// ---------------------------------------------------------------------------
// Suite 4: writeMcpReceipt — atomic write, file integrity (AC-1 + AC-4a)
// ---------------------------------------------------------------------------
console.log('\n[Suite 4] writeMcpReceipt — atomic write, file integrity (AC-1 + AC-4a)\n');
{
  const root = makeTmpRoot();
  try {
    const { receiptPath, receipt } = await writeMcpReceipt(
      {
        task: 'atomic-task',
        run: 'run-atomic',
        servers: ['github'],
        tools: ['search_code'],
        host: 'claude-code',
        result: 'passed',
        evidence: { query_count: 2 },
      },
      root,
    );

    typeof receiptPath === 'string' && receiptPath.length > 0
      ? ok('writeMcpReceipt returns receiptPath string')
      : bad(`receiptPath invalid: ${receiptPath}`);

    existsSync(receiptPath)
      ? ok('receipt file exists on disk after atomic write')
      : bad(`receipt file missing at: ${receiptPath}`);

    // No tmp leftover after atomic rename
    !existsSync(`${receiptPath}.tmp-${process.pid}`)
      ? ok('no .tmp file left behind (atomic rename succeeded)')
      : bad('tmp file still present — atomic rename may have failed');

    const onDisk = JSON.parse(readFileSync(receiptPath, 'utf-8'));

    onDisk.id === receipt.id
      ? ok('on-disk id matches in-memory receipt id')
      : bad(`id mismatch: disk=${onDisk.id} mem=${receipt.id}`);

    onDisk.result === 'passed'
      ? ok('on-disk result = "passed"')
      : bad(`on-disk result: ${onDisk.result}`);

    // AC-4a: substrate seam field is 'skipped' when CDK-022 absent
    onDisk.substrate === 'skipped'
      ? ok('on-disk substrate = "skipped" (CDK-022 seam)')
      : bad(`on-disk substrate: ${onDisk.substrate}`);

    onDisk.kind === 'mcp'
      ? ok('on-disk kind = "mcp"')
      : bad(`on-disk kind: ${onDisk.kind}`);

    // AC-3 on disk: no prompt, no sourceBytes
    !('prompt' in onDisk)
      ? ok('on-disk receipt has no prompt field')
      : bad('on-disk receipt must NOT have prompt field');

    !('sourceBytes' in onDisk)
      ? ok('on-disk receipt has no sourceBytes field')
      : bad('on-disk receipt must NOT have sourceBytes field');

    // Receipt stored at the canonical path
    const expectedDir = receiptStoreDir(root);
    receiptPath.startsWith(expectedDir)
      ? ok('receipt stored in receiptStoreDir(root)')
      : bad(`receipt path ${receiptPath} not inside ${expectedDir}`);
  } finally {
    cleanup(root);
  }
}

// ---------------------------------------------------------------------------
// Suite 5: writeMcpReceipt — store directory auto-created when absent (AC-1)
// ---------------------------------------------------------------------------
console.log('\n[Suite 5] writeMcpReceipt — store dir created if absent (AC-1)\n');
{
  const root = makeTmpRoot();
  try {
    const storeDir = receiptStoreDir(root);

    !existsSync(storeDir)
      ? ok('store dir absent before write')
      : bad('store dir should not exist yet');

    await writeMcpReceipt(
      { task: 't', run: 'r', servers: [], tools: [], host: 'h', result: 'skipped' },
      root,
    );

    existsSync(storeDir)
      ? ok('store dir auto-created by writeMcpReceipt')
      : bad(`store dir still missing at ${storeDir}`);
  } finally {
    cleanup(root);
  }
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------
finish('MCP-010 writeMcpReceipt (AC-1 + AC-4a)');
