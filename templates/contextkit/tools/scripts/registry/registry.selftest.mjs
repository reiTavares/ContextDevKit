/** Focused v4 work-context registry and fleet-aware ID allocator selftest. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { buildWorkContextRegistry, writeWorkContextRegistry } from './work-context.mjs';
import { nextBusinessId, nextOperationId, nextWorkflowNumber } from './ids.mjs';
import { serializeRegistry } from './serialize.mjs';

let failures = 0;
function check(label, condition) {
  process.stdout.write(`  ${condition ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!condition) failures += 1;
}

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'contextdevkit-v4-registry-'));
try {
  const paths = pathsFor(fixtureRoot);
  const businessDirectory = resolve(paths.business, 'BIZ-0001-fixture');
  writeJson(resolve(businessDirectory, 'business.json'), {
    schemaVersion: 1,
    id: 'BIZ-0001',
    status: 'approved',
    title: 'Fixture Business',
  });
  mkdirSync(resolve(businessDirectory, 'workflows', 'WF-0037-governance'), { recursive: true });
  mkdirSync(resolve(paths.memory, 'workflows', 'WF-0036-neutral'), { recursive: true });

  const firstBytes = writeWorkContextRegistry(fixtureRoot);
  const registry = JSON.parse(firstBytes);
  check('registry indexes the canonical Business', registry.contexts.some((row) => row.id === 'BIZ-0001'));
  check('registry retains factual Business metadata', registry.contexts[0]?.status === 'approved' && registry.contexts[0]?.title === 'Fixture Business');
  check('registry rebuild is byte-idempotent', writeWorkContextRegistry(fixtureRoot) === firstBytes);
  check('pure registry serialization matches written bytes', serializeRegistry(buildWorkContextRegistry(fixtureRoot)) === firstBytes);
  check('workflow allocator scans neutral and owned v4 roots', nextWorkflowNumber(fixtureRoot) === '0038');
  check('Business allocator advances globally', nextBusinessId(fixtureRoot) === 'BIZ-0002');
  check('Operation allocator starts at one when empty', nextOperationId(fixtureRoot) === 'OP-0001');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nregistry v4 selftest: PASS\n' : `\nregistry v4 selftest: FAIL (${failures})\n`);
if (failures > 0) process.exitCode = 1;
