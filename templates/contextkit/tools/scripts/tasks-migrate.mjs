/**
 * Explicit v3-to-v4 migration compatibility entrypoint.
 *
 * The implementation lives only under `tools/migrations/v3-to-v4/`; normal
 * runtime entrypoints must not import this module. There is intentionally no
 * v3 fallback, dual reader, dual writer, or rollback-to-v3 API.
 */
export {
  MigrationRefusedError,
  inventoryV3,
  normalizeLegacyStatus,
  planV3ToV4,
  reconcileWorkflowCorpus,
  resolveLegacyId,
  stageV4Generation,
  validateMigrationPlan,
  verifyGeneration,
  verifyStatusParity,
} from '../migrations/v3-to-v4/index.mjs';
