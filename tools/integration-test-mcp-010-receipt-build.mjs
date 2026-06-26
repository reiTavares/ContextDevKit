/**
 * integration-test-mcp-010-receipt-build.mjs — MCP-010 AC-1 + AC-3: buildReceipt.
 *
 * Acceptance criteria covered:
 *   AC-1  buildReceipt shape, canonical RESULTS taxonomy, missing-field rejection
 *   AC-3  Receipts contain METADATA ONLY — no prompt/source bytes; secret evidence
 *         keys are redacted to [REDACTED]; actual secret values absent from output
 *
 * Suites:
 *   Suite 1 — buildReceipt: valid payload, taxonomy, metadata-only (AC-1, AC-3)
 *   Suite 2 — buildReceipt: RESULTS taxonomy gate (AC-1)
 *   Suite 3 — buildReceipt: secret redaction in evidence (AC-3)
 *
 * Run:  node tools/integration-test-mcp-010-receipt-build.mjs
 * Exits non-zero on any failure.
 */

import { reporter } from './it-helpers.mjs';
import {
  buildReceipt,
  RESULTS,
  RECEIPT_VERSION,
  SUBSTRATE_STATUS,
} from './integration-test-mcp-010-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

// ---------------------------------------------------------------------------
// Suite 1: buildReceipt — valid payload, result taxonomy, metadata-only
// ---------------------------------------------------------------------------
console.log('\n[Suite 1] buildReceipt — valid payload, result taxonomy, metadata-only (AC-1 + AC-3)\n');
{
  const receipt = buildReceipt({
    task: 'task-abc',
    run: 'run-001',
    servers: ['filesystem'],
    tools: ['read_file', 'list_dir'],
    host: 'claude-code',
    result: 'passed',
    evidence: { duration_ms: 45, file_count: 3 },
  });

  typeof receipt.receiptVersion === 'string' && receipt.receiptVersion === RECEIPT_VERSION
    ? ok('receipt has expected receiptVersion')
    : bad(`receiptVersion mismatch: got ${receipt.receiptVersion}`);

  typeof receipt.id === 'string' && receipt.id.length > 8
    ? ok('receipt.id is a non-trivial string')
    : bad(`receipt.id too short or missing: ${receipt.id}`);

  receipt.kind === 'mcp'
    ? ok('receipt.kind === "mcp"')
    : bad(`receipt.kind: expected "mcp", got "${receipt.kind}"`);

  receipt.task === 'task-abc'
    ? ok('receipt.task preserved')
    : bad(`receipt.task: ${receipt.task}`);

  receipt.run === 'run-001'
    ? ok('receipt.run preserved')
    : bad(`receipt.run: ${receipt.run}`);

  receipt.host === 'claude-code'
    ? ok('receipt.host preserved')
    : bad(`receipt.host: ${receipt.host}`);

  Array.isArray(receipt.servers) && receipt.servers[0] === 'filesystem'
    ? ok('receipt.servers copied correctly')
    : bad(`receipt.servers: ${JSON.stringify(receipt.servers)}`);

  Array.isArray(receipt.tools) && receipt.tools.length === 2
    ? ok('receipt.tools copied correctly')
    : bad(`receipt.tools: ${JSON.stringify(receipt.tools)}`);

  receipt.result === 'passed'
    ? ok('receipt.result = "passed"')
    : bad(`receipt.result: ${receipt.result}`);

  receipt.evidence.duration_ms === 45
    ? ok('receipt.evidence.duration_ms preserved')
    : bad(`receipt.evidence.duration_ms: ${receipt.evidence.duration_ms}`);

  /^\d{4}-\d{2}-\d{2}T/.test(receipt.createdAt)
    ? ok('receipt.createdAt is ISO timestamp')
    : bad(`receipt.createdAt: ${receipt.createdAt}`);

  // AC-3 + AC-4a: substrate seam reports 'skipped'; CDK-022 absent
  SUBSTRATE_STATUS === 'skipped'
    ? ok('module-level SUBSTRATE_STATUS === "skipped" (CDK-022 absent)')
    : bad(`SUBSTRATE_STATUS: expected "skipped", got "${SUBSTRATE_STATUS}"`);

  receipt.substrate === 'skipped'
    ? ok('receipt.substrate === "skipped" when CDK-022 absent')
    : bad(`receipt.substrate: expected "skipped", got "${receipt.substrate}"`);

  // AC-3: no prompt content, no source bytes in receipt shape
  !('prompt' in receipt)
    ? ok('receipt does not contain prompt field (metadata-only)')
    : bad('receipt must NOT contain prompt field');

  !('sourceBytes' in receipt)
    ? ok('receipt does not contain sourceBytes field')
    : bad('receipt must NOT contain sourceBytes field');
}

// ---------------------------------------------------------------------------
// Suite 2: buildReceipt — RESULTS taxonomy gate (AC-1)
// ---------------------------------------------------------------------------
console.log('\n[Suite 2] buildReceipt — RESULTS taxonomy gate (AC-1)\n');
{
  const base = { task: 't', run: 'r', servers: [], tools: [], host: 'h' };

  for (const result of RESULTS) {
    try {
      buildReceipt({ ...base, result });
      ok(`result="${result}" accepted`);
    } catch (err) {
      bad(`result="${result}" rejected unexpectedly: ${err.message}`);
    }
  }

  // Invalid result must throw TypeError
  let threw = false;
  try {
    buildReceipt({ ...base, result: 'approved' });
  } catch (err) {
    threw = err instanceof TypeError;
  }
  threw
    ? ok('result="approved" throws TypeError (not in taxonomy)')
    : bad('result="approved" must throw TypeError');

  // Missing required fields throw TypeError
  const missingCases = [
    [{ ...base, task: '' }, 'empty task'],
    [{ ...base, run: '' }, 'empty run'],
    [{ ...base, host: '' }, 'empty host'],
    [{ ...base, servers: 'not-array' }, 'non-array servers'],
    [{ ...base, tools: null }, 'null tools'],
    [{ result: 'passed' }, 'missing all required fields'],
  ];
  for (const [payload, label] of missingCases) {
    let didThrow = false;
    try {
      buildReceipt({ result: 'passed', ...payload });
    } catch (err) {
      didThrow = err instanceof TypeError;
    }
    didThrow
      ? ok(`${label} throws TypeError`)
      : bad(`${label} must throw TypeError`);
  }
}

// ---------------------------------------------------------------------------
// Suite 3: buildReceipt — secret redaction in evidence (AC-3)
// ---------------------------------------------------------------------------
console.log('\n[Suite 3] buildReceipt — secret redaction in evidence (AC-3)\n');
{
  const receipt = buildReceipt({
    task: 'task-secrets',
    run: 'run-sec',
    servers: [],
    tools: [],
    host: 'claude-code',
    result: 'passed',
    evidence: {
      apiKey: 'sk-real-key-value',
      token: 'ghp_realtoken',
      password: 's3cr3t!',
      credential: 'basic-creds',
      secretName: 'my-secret',
      normalMetric: 42,
      label: 'not-secret',
    },
  });

  receipt.evidence.apiKey === '[REDACTED]'
    ? ok('apiKey redacted in evidence')
    : bad(`apiKey not redacted: ${receipt.evidence.apiKey}`);

  receipt.evidence.token === '[REDACTED]'
    ? ok('token redacted in evidence')
    : bad(`token not redacted: ${receipt.evidence.token}`);

  receipt.evidence.password === '[REDACTED]'
    ? ok('password redacted in evidence')
    : bad(`password not redacted: ${receipt.evidence.password}`);

  receipt.evidence.credential === '[REDACTED]'
    ? ok('credential redacted in evidence')
    : bad(`credential not redacted: ${receipt.evidence.credential}`);

  receipt.evidence.secretName === '[REDACTED]'
    ? ok('secretName redacted in evidence')
    : bad(`secretName not redacted: ${receipt.evidence.secretName}`);

  receipt.evidence.normalMetric === 42
    ? ok('normalMetric (non-secret) preserved')
    : bad(`normalMetric altered: ${receipt.evidence.normalMetric}`);

  receipt.evidence.label === 'not-secret'
    ? ok('label (non-secret) preserved')
    : bad(`label altered: ${receipt.evidence.label}`);

  const serialized = JSON.stringify(receipt);
  !serialized.includes('sk-real-key-value')
    ? ok('actual apiKey value absent from serialized receipt')
    : bad('apiKey value must not appear in serialized receipt');

  !serialized.includes('ghp_realtoken')
    ? ok('actual token value absent from serialized receipt')
    : bad('token value must not appear in serialized receipt');
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------
finish('MCP-010 buildReceipt (AC-1 + AC-3)');
