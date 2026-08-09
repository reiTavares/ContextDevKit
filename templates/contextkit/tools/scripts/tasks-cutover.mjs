/**
 * Explicit v3-to-v4 cutover compatibility entrypoint.
 *
 * Rollback always selects a verified v4 generation. The old v3 writer fence is
 * monotonic and cannot be disabled through this API.
 */
export {
  AUTHORITY_MARKER,
  V3_WRITER_FENCE,
  OldWriterFenced,
  assertV3WriterAllowed,
  cutoverToV4,
  freezeV3Writers,
  readAuthorityMarker,
  retireV3Sources,
  rollbackV4,
} from '../migrations/v3-to-v4/index.mjs';
