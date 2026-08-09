import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  MigrationRefusedError,
  assertSameVolume,
  readJson,
  resolveContainedPath,
  sha256,
  stableJson,
  toPortablePath,
} from './common.mjs';
import { hashDirectory, verifyGeneration } from './stage.mjs';
import {
  TasksCasConflictError,
  TasksStoreLockedError,
  assertExpectedRevision,
  replaceFileAtomic,
  withTasksFileLock,
} from '../../scripts/tasks-cas.mjs';

export const AUTHORITY_MARKER = '.contextdevkit-authority.json';
export const V3_WRITER_FENCE = '.contextdevkit-v3-writer-fence.json';

export class OldWriterFenced extends MigrationRefusedError {
  /** @param {string} operation @param {string} target */
  constructor(operation, target) {
    super(`v3 writer fenced: ${operation} on ${target} is refused; authority is v4-only`, 'V3_WRITER_FENCED');
    this.name = 'OldWriterFenced';
    this.operation = operation;
    this.target = target;
  }
}

/** @param {string} markerPath @returns {object} */
function readMarker(markerPath) {
  if (!existsSync(markerPath)) return { revision: 0, authority: null };
  const marker = readJson(markerPath);
  if (!Number.isInteger(marker.revision) || marker.revision < 1) {
    throw new MigrationRefusedError(`invalid marker revision: ${markerPath}`, 'MARKER_SCHEMA');
  }
  return marker;
}

/** @param {object} marker @param {number} expectedRevision @returns {void} */
function assertMarkerRevision(marker, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new MigrationRefusedError('expectedRevision is required for marker CAS', 'EXPECTED_REVISION_REQUIRED');
  }
  try {
    assertExpectedRevision(marker.revision, expectedRevision);
  } catch (error) {
    if (!(error instanceof TasksCasConflictError)) throw error;
    throw new MigrationRefusedError(
      `marker CAS conflict: expected ${expectedRevision}, observed ${marker.revision}`,
      'MARKER_CAS_CONFLICT',
    );
  }
}

/**
 * Serialize marker compare-and-swap across processes with an exclusive sibling
 * lock directory. The lock is never treated as authority and is always removed.
 *
 * @template T
 * @param {string} markerPath
 * @param {() => T} action
 * @returns {T}
 */
function withMarkerLock(markerPath, action) {
  try {
    return withTasksFileLock(markerPath, action);
  } catch (error) {
    if (error instanceof TasksStoreLockedError) {
      throw new MigrationRefusedError(`marker writer is already active: ${markerPath}`, 'MARKER_CAS_CONFLICT');
    }
    throw error;
  }
}

/**
 * Freeze v3 writes before staging/cutover. This marker is monotonic and is never
 * removed by rollback because rollback remains on verified v4.
 *
 * @param {{ platformRoot: string, sourceDigest: string, expectedRevision: number, stamp?: string }} options
 * @returns {object}
 */
export function freezeV3Writers(options) {
  const platformRoot = resolve(options.platformRoot);
  const markerPath = resolveContainedPath(platformRoot, V3_WRITER_FENCE);
  return withMarkerLock(markerPath, () => {
    const current = readMarker(markerPath);
    assertMarkerRevision(current, options.expectedRevision);
    if (current.frozen === true && current.sourceDigest === options.sourceDigest) return { ...current, idempotent: true };
    const marker = {
      schemaVersion: 1,
      kind: 'contextdevkit-v3-writer-fence',
      revision: current.revision + 1,
      frozen: true,
      sourceDigest: options.sourceDigest,
      frozenAt: options.stamp || null,
    };
    replaceFileAtomic(markerPath, stableJson(marker));
    return { ...marker, idempotent: false };
  });
}

/** @param {string} platformRoot @param {string} operation @param {string} target @returns {void} */
export function assertV3WriterAllowed(platformRoot, operation, target) {
  const authorityPath = resolveContainedPath(platformRoot, AUTHORITY_MARKER);
  const fencePath = resolveContainedPath(platformRoot, V3_WRITER_FENCE);
  const authority = readMarker(authorityPath);
  const fence = readMarker(fencePath);
  if (authority.authority === 'v4' || fence.frozen === true) throw new OldWriterFenced(operation, target);
}

/** @param {object} receipt @param {object} plan @returns {void} */
function validateStageReceipt(receipt, plan) {
  if (receipt?.kind !== 'contextdevkit-v4-stage-receipt'
    || receipt.manifestHash !== plan.manifest.manifestHash
    || receipt.sourceDigest !== plan.manifest.sourceDigest
    || receipt.generationDigest !== plan.manifest.generationDigest
    || receipt.rollbackExercised !== true
    || receipt.schemaValidated !== true
    || receipt.parityValidated !== true) {
    throw new MigrationRefusedError('cutover requires a matching validated stage and rollback receipt', 'STAGE_RECEIPT');
  }
  verifyGeneration(receipt.candidateRoot, plan);
  verifyGeneration(receipt.rollbackRoot, plan);
}

/**
 * Atomically flip authority to one verified v4 generation. There is no v3 mode,
 * fallback, or dual authority in the marker schema.
 *
 * @param {{ platformRoot: string, plan: object, stageReceipt: object,
 *   expectedRevision: number, stamp?: string }} options
 * @returns {object}
 */
export function cutoverToV4(options) {
  const platformRoot = resolve(options.platformRoot);
  const plan = options.plan;
  validateStageReceipt(options.stageReceipt, plan);
  const fence = readMarker(resolveContainedPath(platformRoot, V3_WRITER_FENCE));
  if (fence.frozen !== true || fence.sourceDigest !== plan.manifest.sourceDigest) {
    throw new MigrationRefusedError('cutover requires the matching v3 writer freeze', 'V3_NOT_FROZEN');
  }
  const markerPath = resolveContainedPath(platformRoot, AUTHORITY_MARKER);
  assertSameVolume(markerPath, options.stageReceipt.candidateRoot);
  return withMarkerLock(markerPath, () => {
    const current = readMarker(markerPath);
    assertMarkerRevision(current, options.expectedRevision);
    const candidateRoot = toPortablePath(options.stageReceipt.candidateRoot);
    if (current.authority === 'v4'
      && current.manifestHash === plan.manifest.manifestHash
      && current.generationRoot === candidateRoot) {
      return { ...current, idempotent: true };
    }
    const marker = {
      schemaVersion: 1,
      kind: 'contextdevkit-authority',
      revision: current.revision + 1,
      authority: 'v4',
      generationRoot: candidateRoot,
      rollbackGenerationRoot: toPortablePath(options.stageReceipt.rollbackRoot),
      manifestHash: plan.manifest.manifestHash,
      generationDigest: plan.manifest.generationDigest,
      oldWriterFence: true,
      cutoverAt: options.stamp || null,
      rollbackOfRevision: null,
    };
    replaceFileAtomic(markerPath, stableJson(marker));
    return { ...marker, idempotent: false };
  });
}

/**
 * Restore authority to a verified v4 rollback generation. This function cannot
 * emit a v3 marker and never removes the old-writer fence.
 *
 * @param {{ platformRoot: string, plan: object, expectedRevision: number, stamp?: string }} options
 * @returns {object}
 */
export function rollbackV4(options) {
  const platformRoot = resolve(options.platformRoot);
  const markerPath = resolveContainedPath(platformRoot, AUTHORITY_MARKER, { allowMissingLeaf: false });
  return withMarkerLock(markerPath, () => {
    const current = readMarker(markerPath);
    assertMarkerRevision(current, options.expectedRevision);
    if (current.authority !== 'v4' || current.oldWriterFence !== true || !current.rollbackGenerationRoot) {
      throw new MigrationRefusedError('rollback is available only from fenced v4 authority', 'ROLLBACK_NOT_V4');
    }
    if (current.manifestHash !== options.plan.manifest.manifestHash) {
      throw new MigrationRefusedError('rollback manifest does not match active authority', 'ROLLBACK_MANIFEST');
    }
    verifyGeneration(current.rollbackGenerationRoot, options.plan);
    const marker = {
      ...current,
      revision: current.revision + 1,
      authority: 'v4',
      generationRoot: current.rollbackGenerationRoot,
      rollbackGenerationRoot: current.generationRoot,
      oldWriterFence: true,
      rollbackAt: options.stamp || null,
      rollbackOfRevision: current.revision,
    };
    replaceFileAtomic(markerPath, stableJson(marker));
    return marker;
  });
}

/**
 * Move only inventoried v3 authorities into an audit bundle after v4 cutover.
 * The bundle is not a rollback runtime. Every move is same-volume and hash-gated.
 *
 * @param {{ platformRoot: string, workspaceRoot: string, plan: object }} options
 * @returns {{ retired: string[], alreadyRetired: string[], bundleRoot: string }}
 */
export function retireV3Sources(options) {
  const platformRoot = resolve(options.platformRoot);
  const workspaceRoot = resolve(options.workspaceRoot);
  const authority = readMarker(resolveContainedPath(platformRoot, AUTHORITY_MARKER, { allowMissingLeaf: false }));
  if (authority.authority !== 'v4' || authority.manifestHash !== options.plan.manifest.manifestHash) {
    throw new MigrationRefusedError('legacy retirement requires matching active v4 authority', 'RETIRE_BEFORE_CUTOVER');
  }
  const bundleRoot = resolveContainedPath(workspaceRoot, `legacy-source-bundle/${options.plan.manifest.migrationId}`);
  mkdirSync(bundleRoot, { recursive: true });
  const retiredDirectories = [];
  const alreadyRetiredDirectories = [];
  for (const directory of options.plan.manifest.legacyDirectories || []) {
    const sourceDirectory = resolveContainedPath(platformRoot, directory.sourcePath);
    const bundleDirectory = resolveContainedPath(bundleRoot, directory.sourcePath);
    if (!existsSync(sourceDirectory)) {
      if (existsSync(bundleDirectory) && stableJson(hashDirectory(bundleDirectory)) === stableJson(directory.fileHashes)) {
        alreadyRetiredDirectories.push(`${directory.sourcePath}/`);
        continue;
      }
      throw new MigrationRefusedError(`legacy workflow directory missing: ${directory.sourcePath}`, 'RETIRE_SOURCE_MISSING');
    }
    if (stableJson(hashDirectory(sourceDirectory)) !== stableJson(directory.fileHashes)) {
      throw new MigrationRefusedError(`legacy workflow directory changed: ${directory.sourcePath}`, 'RETIRE_SOURCE_CAS');
    }
    mkdirSync(dirname(bundleDirectory), { recursive: true });
    assertSameVolume(sourceDirectory, bundleDirectory);
    renameSync(sourceDirectory, bundleDirectory);
    retiredDirectories.push(`${directory.sourcePath}/`);
  }
  const uniqueSources = new Map();
  for (const entry of options.plan.manifest.entries) {
    const pathOnly = entry.sourcePath?.split('#')[0];
    if (pathOnly && entry.sourceArtifactHash) uniqueSources.set(pathOnly, entry.sourceArtifactHash);
  }
  for (const artifact of options.plan.manifest.legacyArtifacts || []) {
    if (artifact.sourcePath && artifact.sourceArtifactHash) {
      uniqueSources.set(artifact.sourcePath, artifact.sourceArtifactHash);
    }
  }
  const retired = [];
  const alreadyRetired = [];
  for (const [portableSourcePath, expectedHash] of [...uniqueSources.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const parentDirectory = (options.plan.manifest.legacyDirectories || [])
      .find((directory) => portableSourcePath.startsWith(`${directory.sourcePath}/`));
    if (parentDirectory) {
      const wasRetired = retiredDirectories.includes(`${parentDirectory.sourcePath}/`);
      (wasRetired ? retired : alreadyRetired).push(portableSourcePath);
      continue;
    }
    const sourcePath = resolveContainedPath(platformRoot, portableSourcePath);
    const bundlePath = resolveContainedPath(bundleRoot, portableSourcePath);
    if (!existsSync(sourcePath)) {
      if (existsSync(bundlePath) && sha256(readFileSync(bundlePath)) === expectedHash) {
        alreadyRetired.push(portableSourcePath);
        continue;
      }
      throw new MigrationRefusedError(`legacy source missing before retirement: ${portableSourcePath}`, 'RETIRE_SOURCE_MISSING');
    }
    if (sha256(readFileSync(sourcePath)) !== expectedHash) {
      throw new MigrationRefusedError(`legacy source changed before retirement: ${portableSourcePath}`, 'RETIRE_SOURCE_CAS');
    }
    mkdirSync(dirname(bundlePath), { recursive: true });
    assertSameVolume(sourcePath, bundlePath);
    renameSync(sourcePath, bundlePath);
    retired.push(portableSourcePath);
  }
  return {
    retired: [...retiredDirectories, ...retired],
    alreadyRetired: [...alreadyRetiredDirectories, ...alreadyRetired],
    bundleRoot: toPortablePath(bundleRoot),
  };
}

export function readAuthorityMarker(platformRoot) {
  return readMarker(resolveContainedPath(resolve(platformRoot), AUTHORITY_MARKER));
}
