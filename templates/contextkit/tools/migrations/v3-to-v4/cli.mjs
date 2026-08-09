import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { inventoryV3 } from './inventory.mjs';
import { planV3ToV4 } from './plan.mjs';
import { stageV4Generation } from './stage.mjs';
import {
  cutoverToV4,
  freezeV3Writers,
  readAuthorityMarker,
  retireV3Sources,
  rollbackV4,
} from './cutover.mjs';
import { MigrationRefusedError, stableJson } from './common.mjs';

/** @param {string[]} argv @returns {Record<string, string|boolean>} */
function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new MigrationRefusedError(`unexpected argument: ${token}`, 'CLI_ARGUMENT');
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

/** @param {Record<string, string|boolean>} argumentsMap @param {string} name @returns {string} */
function requirePath(argumentsMap, name) {
  const value = argumentsMap[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MigrationRefusedError(`--${name} is required`, 'CLI_ARGUMENT');
  }
  return resolve(value);
}

/** @param {Record<string, string|boolean>} argumentsMap @returns {number} */
function expectedRevision(argumentsMap) {
  if (typeof argumentsMap['expected-revision'] !== 'string' || !/^\d+$/.test(argumentsMap['expected-revision'])) {
    throw new MigrationRefusedError('--expected-revision is required for mutating actions', 'CLI_ARGUMENT');
  }
  return Number(argumentsMap['expected-revision']);
}

/** @param {string} workspaceRoot @returns {{ plan: object, receipt: object }} */
function readStage(workspaceRoot) {
  const planPath = resolve(workspaceRoot, 'migration-plan.json');
  const receiptPath = resolve(workspaceRoot, 'stage-receipt.json');
  if (!existsSync(planPath) || !existsSync(receiptPath)) {
    throw new MigrationRefusedError('workspace has no complete staged migration', 'STAGE_MISSING');
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8').replace(/^\uFEFF/, ''));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8').replace(/^\uFEFF/, ''));
  return { plan, receipt };
}

/**
 * Explicit offline command. With no mutating action it only prints a dry-run
 * plan and writes nothing.
 *
 * @param {string[]} [argv]
 * @returns {Promise<object>}
 */
export async function runCli(argv = process.argv.slice(2)) {
  const argumentsMap = parseArguments(argv);
  const platformRoot = requirePath(argumentsMap, 'platform-root');
  const requestedActions = ['write', 'freeze', 'cutover', 'rollback', 'retire-v3']
    .filter((action) => argumentsMap[action] === true);
  if (requestedActions.length > 1) {
    throw new MigrationRefusedError(`mutating actions are mutually exclusive: ${requestedActions.join(', ')}`, 'CLI_ARGUMENT');
  }

  if (argumentsMap.write === true) {
    const inventory = inventoryV3(platformRoot);
    const plan = planV3ToV4(inventory, { migrationStamp: typeof argumentsMap.stamp === 'string' ? argumentsMap.stamp : null });
    const workspaceRoot = requirePath(argumentsMap, 'workspace-root');
    const receipt = stageV4Generation({ platformRoot, workspaceRoot, plan });
    return { action: 'stage', manifest: plan.manifest, receipt };
  }
  if (argumentsMap.freeze === true) {
    const inventory = inventoryV3(platformRoot);
    const plan = planV3ToV4(inventory, { migrationStamp: typeof argumentsMap.stamp === 'string' ? argumentsMap.stamp : null });
    return freezeV3Writers({
      platformRoot,
      sourceDigest: plan.manifest.sourceDigest,
      expectedRevision: expectedRevision(argumentsMap),
      stamp: typeof argumentsMap.stamp === 'string' ? argumentsMap.stamp : null,
    });
  }
  if (argumentsMap.cutover === true) {
    const workspaceRoot = requirePath(argumentsMap, 'workspace-root');
    const { plan, receipt } = readStage(workspaceRoot);
    return cutoverToV4({
      platformRoot,
      plan,
      stageReceipt: receipt,
      expectedRevision: expectedRevision(argumentsMap),
      stamp: typeof argumentsMap.stamp === 'string' ? argumentsMap.stamp : null,
    });
  }
  if (argumentsMap.rollback === true) {
    const { plan } = readStage(requirePath(argumentsMap, 'workspace-root'));
    return rollbackV4({
      platformRoot,
      plan,
      expectedRevision: expectedRevision(argumentsMap),
      stamp: typeof argumentsMap.stamp === 'string' ? argumentsMap.stamp : null,
    });
  }
  if (argumentsMap['retire-v3'] === true) {
    const workspaceRoot = requirePath(argumentsMap, 'workspace-root');
    const { plan } = readStage(workspaceRoot);
    return retireV3Sources({
      platformRoot,
      workspaceRoot,
      plan,
    });
  }
  const inventory = inventoryV3(platformRoot);
  const plan = planV3ToV4(inventory, { migrationStamp: typeof argumentsMap.stamp === 'string' ? argumentsMap.stamp : null });
  return { action: 'dry-run', writes: 0, authority: readAuthorityMarker(platformRoot), manifest: plan.manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli().then((receipt) => process.stdout.write(stableJson(receipt))).catch((error) => {
    const code = error instanceof MigrationRefusedError ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`[migrate-v3-to-v4:${code}] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
