/** Selects the external executor only after ContextDevKit authorizes a request. */
import { detectProjectTools } from '../integrations/project-tools.mjs';
import { executeWithCompozy } from '../integrations/compozy-executor.mjs';
import { validateGovernedExecutionEnvelope } from './governed-execution-envelope.mjs';

/**
 * Dispatch a governed envelope. Configured Compozy is mandatory and its failure
 * never falls through to the local executor.
 * @param {object} candidateEnvelope
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function executeGovernedEnvelope(candidateEnvelope, options = {}) {
  let envelope;
  try {
    envelope = validateGovernedExecutionEnvelope(candidateEnvelope, options);
  } catch (error) {
    return {
      schemaVersion: 1,
      executionState: 'governance_refused',
      selectedExecutor: null,
      governanceAuthority: 'contextdevkit',
      completionAuthority: 'contextdevkit',
      fallback: 'forbidden',
      reason: error.code ?? 'invalid_envelope',
      detail: error.message,
    };
  }

  const detection = (options.detectProjectTools ?? detectProjectTools)(envelope.workspaceRoot);
  if (detection.compozy.status === 'not_detected') {
    if (typeof options.localExecutor === 'function') return options.localExecutor(envelope);
    return {
      schemaVersion: 1,
      executionState: 'local_execution_required',
      selectedExecutor: 'current-host',
      governanceAuthority: 'contextdevkit',
      completionAuthority: 'contextdevkit',
      fallback: 'not_applicable',
      envelopeSha256: envelope.envelopeSha256,
    };
  }
  if (detection.compozy.status !== 'configured') {
    return {
      schemaVersion: 1,
      executionState: 'blocked',
      selectedExecutor: 'compozy',
      governanceAuthority: 'contextdevkit',
      completionAuthority: 'contextdevkit',
      fallback: 'forbidden',
      reason: detection.compozy.reason ?? 'compozy_configuration_unavailable',
      envelopeSha256: envelope.envelopeSha256,
    };
  }

  try {
    return await (options.compozyExecutor ?? executeWithCompozy)(envelope, options.compozyOptions ?? {});
  } catch (error) {
    return {
      schemaVersion: 1,
      executionState: 'blocked',
      selectedExecutor: 'compozy',
      governanceAuthority: 'contextdevkit',
      completionAuthority: 'contextdevkit',
      fallback: 'forbidden',
      reason: error.code ?? 'compozy_execution_failed',
      detail: error.message,
      envelopeSha256: envelope.envelopeSha256,
    };
  }
}
