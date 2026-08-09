import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  MigrationRefusedError,
  assertNoReparseHop,
  assertSameVolume,
  atomicWriteFile,
  resolveContainedPath,
  sha256,
  stableJson,
  toPortablePath,
} from './common.mjs';
import { inventoryV3 } from './inventory.mjs';
import { validateMigrationPlan, verifyStatusParity } from './plan.mjs';
import { writeTasksDocumentAtomic } from '../../scripts/tasks-store.mjs';
import { validatePack } from '../../scripts/workflow/validate.mjs';

/** @param {string} parent @param {string} child @returns {boolean} */
function contains(parent, child) {
  const traversal = relative(resolve(parent), resolve(child));
  return traversal === '' || (!traversal.startsWith(`..${sep}`) && traversal !== '..' && !isAbsolute(traversal));
}

/** @param {string} directory @returns {Record<string, string>} */
function hashDirectory(directory) {
  const hashes = {};
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new MigrationRefusedError(`reparse path in generation: ${candidate}`, 'REPARSE_POINT');
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) hashes[toPortablePath(relative(directory, candidate))] = sha256(readFileSync(candidate));
    }
  }
  return Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)));
}

/** @param {string} generationRoot @param {object} plan @returns {void} */
export function verifyGeneration(generationRoot, plan) {
  assertNoReparseHop(generationRoot, generationRoot, false);
  const actualHashes = hashDirectory(generationRoot);
  if (stableJson(actualHashes) !== stableJson(plan.manifest.targetFileHashes)) {
    throw new MigrationRefusedError('staged generation content/hash parity failed', 'STAGED_GENERATION_HASH');
  }
  const parsedFiles = {};
  for (const targetPath of Object.keys(plan.targetFiles)) {
    const absolutePath = resolveContainedPath(generationRoot, targetPath, { allowMissingLeaf: false });
    parsedFiles[targetPath] = readFileSync(absolutePath, 'utf8');
  }
  validateMigrationPlan({ ...plan, targetFiles: parsedFiles });
  for (const targetPath of Object.keys(plan.manifest.targetFileHashes)
    .filter((path) => path.endsWith('/workflow.json'))) {
    const packDirectory = dirname(resolveContainedPath(generationRoot, targetPath, { allowMissingLeaf: false }));
    const verdict = validatePack(packDirectory);
    if (!verdict.valid) {
      const detail = verdict.errors.map((entry) => `${entry.path || '(pack)'}: ${entry.message}`).join('; ');
      throw new MigrationRefusedError(`staged workflow pack is invalid: ${targetPath}: ${detail}`, 'WORKFLOW_PACK_SCHEMA');
    }
  }
}

/** @param {string} platformRoot @param {object} plan @returns {void} */
function verifyFrozenSource(platformRoot, plan) {
  const freshInventory = inventoryV3(platformRoot);
  if (freshInventory.sourceDigest !== plan.manifest.sourceDigest) {
    throw new MigrationRefusedError(
      `source CAS failed: expected ${plan.manifest.sourceDigest}, observed ${freshInventory.sourceDigest}`,
      'SOURCE_CAS_CONFLICT',
    );
  }
}

/** @param {string} sourceRoot @param {string} targetRoot @returns {void} */
function copyVerifiedTree(sourceRoot, targetRoot) {
  cpSync(sourceRoot, targetRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  const sourceHashes = hashDirectory(sourceRoot);
  const targetHashes = hashDirectory(targetRoot);
  if (stableJson(sourceHashes) !== stableJson(targetHashes)) {
    throw new MigrationRefusedError('rollback copy failed verification', 'ROLLBACK_COPY_HASH');
  }
}

/**
 * Materialize candidate + verified v4 rollback generation outside active roots.
 * Re-running an identical stage is a verified no-op.
 *
 * @param {{ platformRoot: string, workspaceRoot: string, plan: object,
 *   hooks?: { beforeGenerationRename?: Function } }} options
 * @returns {object}
 */
export function stageV4Generation(options) {
  const platformRoot = resolve(options.platformRoot);
  const workspaceRoot = resolve(options.workspaceRoot);
  const plan = options.plan;
  validateMigrationPlan(plan);
  verifyStatusParity(plan);
  verifyFrozenSource(platformRoot, plan);
  if (contains(platformRoot, workspaceRoot)) {
    throw new MigrationRefusedError('migration workspace must be outside active platform roots', 'WORKSPACE_IN_ACTIVE_ROOT');
  }
  assertSameVolume(platformRoot, workspaceRoot);
  mkdirSync(workspaceRoot, { recursive: true });
  assertNoReparseHop(workspaceRoot, workspaceRoot, false);

  const migrationId = plan.manifest.migrationId;
  const generationParent = resolveContainedPath(workspaceRoot, 'generations');
  const rollbackParent = resolveContainedPath(workspaceRoot, 'rollback-generations');
  mkdirSync(generationParent, { recursive: true });
  mkdirSync(rollbackParent, { recursive: true });
  const candidateRoot = resolveContainedPath(generationParent, `v4-${migrationId}`);
  const rollbackRoot = resolveContainedPath(rollbackParent, `v4-${migrationId}`);

  const candidateAlreadyExists = existsSync(candidateRoot);
  if (candidateAlreadyExists) {
    verifyGeneration(candidateRoot, plan);
  } else {
    const temporaryRoot = resolve(generationParent, `.v4-${migrationId}.${process.pid}.tmp`);
    assertSameVolume(temporaryRoot, candidateRoot);
    if (existsSync(temporaryRoot)) rmSync(temporaryRoot, { recursive: true, force: true });
    mkdirSync(temporaryRoot, { recursive: false });
    try {
      for (const [targetPath, contents] of Object.entries(plan.targetFiles)) {
        const outputPath = resolveContainedPath(temporaryRoot, targetPath);
        mkdirSync(dirname(outputPath), { recursive: true });
        if (targetPath.endsWith('/tasks.json')) {
          writeTasksDocumentAtomic(outputPath, JSON.parse(contents.replace(/^\uFEFF/, '')));
        } else {
          writeFileSync(outputPath, contents, { encoding: 'utf8', mode: 0o600 });
        }
      }
      for (const copyOperation of plan.copyFiles || []) {
        const sourcePath = resolveContainedPath(platformRoot, copyOperation.sourcePath, { allowMissingLeaf: false });
        const contents = readFileSync(sourcePath);
        if (sha256(contents) !== copyOperation.sourceContentHash) {
          throw new MigrationRefusedError(`copy source changed: ${copyOperation.sourcePath}`, 'SOURCE_CAS_CONFLICT');
        }
        const outputPath = resolveContainedPath(temporaryRoot, copyOperation.targetPath);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, contents, { mode: 0o600 });
      }
      verifyGeneration(temporaryRoot, plan);
      options.hooks?.beforeGenerationRename?.(temporaryRoot, candidateRoot);
      renameSync(temporaryRoot, candidateRoot);
    } finally {
      if (existsSync(temporaryRoot)) rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  if (!existsSync(rollbackRoot)) copyVerifiedTree(candidateRoot, rollbackRoot);
  verifyGeneration(rollbackRoot, plan);

  const drillRoot = resolve(rollbackParent, `.drill-${migrationId}.${process.pid}.tmp`);
  try {
    copyVerifiedTree(rollbackRoot, drillRoot);
    verifyGeneration(drillRoot, plan);
  } finally {
    if (existsSync(drillRoot)) rmSync(drillRoot, { recursive: true, force: true });
  }

  const receipt = {
    schemaVersion: 1,
    kind: 'contextdevkit-v4-stage-receipt',
    migrationId,
    manifestHash: plan.manifest.manifestHash,
    sourceDigest: plan.manifest.sourceDigest,
    generationDigest: plan.manifest.generationDigest,
    candidateRoot: toPortablePath(candidateRoot),
    rollbackRoot: toPortablePath(rollbackRoot),
    rollbackExercised: true,
    schemaValidated: true,
    parityValidated: true,
    idempotent: candidateAlreadyExists,
  };
  atomicWriteFile(resolveContainedPath(workspaceRoot, 'migration-manifest.json'), stableJson(plan.manifest));
  atomicWriteFile(resolveContainedPath(workspaceRoot, 'migration-plan.json'), stableJson(plan));
  atomicWriteFile(resolveContainedPath(workspaceRoot, 'stage-receipt.json'), stableJson(receipt));
  return receipt;
}

export { hashDirectory };
