#!/usr/bin/env node
/** Stop entrypoint for the single-process governance runtime. */
import { pathToFileURL } from 'node:url';
import { dispatchHostGovernanceEvent, runGovernanceHook } from './governance-host-io.mjs';

const MOMENT = 'completion';
const EVENT_NAME = 'Stop';

/**
 * Delegates completion without sweeping lanes or moving workflow paths.
 * @param {Record<string, any>} rawPayload host payload
 * @param {Record<string, any>} [options] adapter options
 * @returns {Promise<Record<string, any>>} structured governance result
 */
export function dispatchCompletion(rawPayload, options = {}) {
  return dispatchHostGovernanceEvent({ moment: MOMENT, rawPayload, ...options });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGovernanceHook({ moment: MOMENT, eventName: EVENT_NAME })
    .catch(() => { /* fail-safe: governance runtime failures never break host work */ });
}
