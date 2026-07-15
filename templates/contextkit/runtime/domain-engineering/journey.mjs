/**
 * journey.mjs — the PreCompact domain-journey continuity core (ADR-0128 §14/§17,
 * WF-0065). Preserves the domain journey (active profile, pending packet/receipt,
 * planned-vs-completed squad evidence) across a context compaction so a long
 * session does not lose the implementation contract.
 *
 * PURE — the caller (`compaction-continuity.mjs`) does the I/O (loads the
 * envelope + reads spawn records) and passes the resolved inputs in; this module
 * only shapes + renders. Keeping it pure makes it unit-testable without invoking
 * the hook (which runs `main()` on import). Zero runtime dependencies.
 *
 * @module domain-engineering/journey
 */

/**
 * Builds the §14/§17 domain-journey continuity block from already-resolved
 * inputs. Returns null when no readiness state was recorded (a non-adopting
 * session) so the caller writes nothing. Metadata only — no file content (§9).
 *
 * @param {object} params
 * @param {object|null} params.readiness the ledger's `domainEngineering` block.
 * @param {object|null} [params.implementation] the task envelope's §15 block
 *   (carries the per-task `profile` + `requiredAgents`).
 * @param {object|null} [params.spawnEvidence] a `compareSpawn`/`summarizeSpawnEvidence`
 *   result for the task.
 * @returns {object|null} the journey block, or null.
 */
export function buildDomainJourney({ readiness, implementation, spawnEvidence } = {}) {
  if (!readiness || typeof readiness !== 'object') return null;
  const impl = implementation && typeof implementation === 'object' ? implementation : null;
  const evidence = spawnEvidence && typeof spawnEvidence === 'object' ? spawnEvidence : null;
  return {
    activeProfile: (impl && typeof impl.profile === 'string' ? impl.profile : null)
      ?? (typeof readiness.activeProfile === 'string' ? readiness.activeProfile : null),
    pendingImplementationPacket: readiness.pendingImplementationPacket === true,
    pendingReceipt: readiness.pendingReceipt === true,
    spawnSatisfied: evidence ? evidence.satisfied === true : true,
    plannedNotDispatched: evidence && Array.isArray(evidence.plannedNotDispatched) ? evidence.plannedNotDispatched : [],
    dispatchedNotCompleted: evidence && Array.isArray(evidence.dispatchedNotCompleted) ? evidence.dispatchedNotCompleted : [],
  };
}

/**
 * Renders the one-line domain-journey resume summary from a preserved continuity
 * record's `domainJourney` block. Returns '' when no journey was saved.
 *
 * @param {object|null} journey the record.domainJourney block (buildDomainJourney output).
 * @returns {string}
 */
export function renderDomainJourneyLine(journey) {
  if (!journey || typeof journey !== 'object') return '';
  const parts = [journey.activeProfile ? `profile ${journey.activeProfile}` : 'domain journey active'];
  if (journey.pendingImplementationPacket) parts.push('packet pending');
  if (journey.spawnSatisfied === false) {
    const gaps = [...(journey.plannedNotDispatched ?? []), ...(journey.dispatchedNotCompleted ?? [])];
    parts.push(`squad incomplete${gaps.length ? ` (${gaps.join(', ')})` : ''}`);
  }
  return `  Domain journey: ${parts.join('; ')}.`;
}
