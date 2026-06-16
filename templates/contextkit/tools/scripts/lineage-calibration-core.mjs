/**
 * lineage-calibration-core.mjs — Pure aggregation of prediction accuracy
 * across the lineage graph. CDK-072 / ADR-0072.
 *
 * No I/O — callers pass parsed predictionRecords + the built lineage graph.
 * A prediction "hits" when every covered path was actually changed
 * (predictedMiss is empty). A "miss" is when at least one covered path was
 * NOT changed (predictedMiss has entries).
 *
 * Records that cannot be mapped to a workflow slug are bucketed as
 * '(unlinked)'.
 *
 * Linkage strategy (priority order):
 *   1. record.cardId  → cardToWorkflow map via `ships` edges.
 *   2. record.sessionPrefix → find matching session node → find cards linked
 *      to that session via `workedIn` edges → map card to workflow.
 *   3. record.paths coverage fallback — card nodes that expose ref.paths.
 *   4. '(unlinked)' (honest §8).
 *
 * Zero runtime dependencies. Advisory, fail-open, unregistered.
 *
 * @typedef {{ cardId?: string|null, sessionPrefix?: string|null, paths?: string[], predictedMiss: string[], unforeseen: string[], reviewed: boolean }} PredictionRecord
 * @typedef {{ slug: string, predictions: number, hits: number, misses: number, unforeseen: number, accuracy: number|null }} WorkflowCalibration
 * @typedef {{ predictions: number, hits: number, misses: number, accuracy: number|null, confidence: 'derived' }} OverallCalibration
 * @typedef {{ perWorkflow: WorkflowCalibration[], overall: OverallCalibration }} CalibrationResult
 */

// ---------------------------------------------------------------------------
// Graph index builders
// ---------------------------------------------------------------------------

/**
 * Builds a map from card id → workflow slug using the lineage graph's
 * `ships` edges (wf:<slug> → card:<id>).
 *
 * @param {{ edges: Array<{ from: string, to: string, rel: string }> }} graph
 * @returns {Map<string, string>} cardId → workflowSlug
 */
function buildCardToWorkflowMap(graph) {
  const cardToWorkflow = new Map();
  for (const edge of (graph?.edges ?? [])) {
    if (edge.rel !== 'ships') continue;
    const wfSlug = edge.from.startsWith('wf:') ? edge.from.slice(3) : null;
    const cardId = edge.to.startsWith('card:') ? edge.to.slice(5) : null;
    if (wfSlug && cardId) cardToWorkflow.set(cardId, wfSlug);
  }
  return cardToWorkflow;
}

/**
 * Builds a map from session number/id → Set of card ids using `workedIn` edges
 * (card:<id> → session:<num>). The session node id format is 'session:<num>'.
 *
 * @param {{ edges: Array<{ from: string, to: string, rel: string }> }} graph
 * @returns {Map<string, Set<string>>} sessionNum → Set<cardId>
 */
function buildSessionToCardsMap(graph) {
  const sessionToCards = new Map();
  for (const edge of (graph?.edges ?? [])) {
    if (edge.rel !== 'workedIn') continue;
    const cardId  = edge.from.startsWith('card:') ? edge.from.slice(5) : null;
    const sessNum = edge.to.startsWith('session:') ? edge.to.slice(8) : null;
    if (!cardId || !sessNum) continue;
    if (!sessionToCards.has(sessNum)) sessionToCards.set(sessNum, new Set());
    sessionToCards.get(sessNum).add(cardId);
  }
  return sessionToCards;
}

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the workflow slug for a prediction record.
 *
 * Priority:
 *   1. record.cardId direct lookup.
 *   2. record.sessionPrefix — match session nodes by prefix, then card→workflow.
 *   3. Path-prefix matching against card nodes that expose ref.paths.
 *   4. '(unlinked)'.
 *
 * @param {PredictionRecord} record
 * @param {Map<string, string>} cardToWorkflow   cardId → wfSlug
 * @param {Map<string, Set<string>>} sessionToCards  sessNum → Set<cardId>
 * @param {{ nodes: Array<{ id: string, type: string, ref: any }>, edges: object[] }} graph
 * @returns {string}
 */
function resolveWorkflowSlug(record, cardToWorkflow, sessionToCards, graph) {
  // Strategy 1: direct card id
  if (record.cardId) {
    const slug = cardToWorkflow.get(record.cardId);
    if (slug) return slug;
  }

  // Strategy 2: session prefix matching
  const sessionPrefix = record.sessionPrefix;
  if (sessionPrefix) {
    for (const [sessNum, cardIds] of sessionToCards) {
      // The prediction file records only the first 8 chars of session id.
      // Session node ids may be a short number (e.g. '01') or a full uuid.
      // Match when the session number STARTS WITH the prefix or prefix matches.
      if (sessNum === sessionPrefix || sessNum.startsWith(sessionPrefix)) {
        for (const cardId of cardIds) {
          const slug = cardToWorkflow.get(cardId);
          if (slug) return slug;
        }
      }
    }
  }

  // Strategy 3: path-prefix matching via card ref.paths
  const recordPaths = Array.isArray(record.paths) ? record.paths : [];
  if (recordPaths.length > 0) {
    for (const node of (graph?.nodes ?? [])) {
      if (node.type !== 'card') continue;
      const cardPaths = Array.isArray(node.ref?.paths) ? node.ref.paths : [];
      if (recordPaths.some((rp) => cardPaths.includes(rp))) {
        const cardId = node.id.startsWith('card:') ? node.id.slice(5) : null;
        if (cardId) {
          const slug = cardToWorkflow.get(cardId);
          if (slug) return slug;
        }
      }
    }
  }

  return '(unlinked)';
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Computes per-workflow and overall calibration accuracy from prediction records.
 *
 * A record is counted only when it has been reviewed (reviewed === true).
 * Unreviewed records are skipped — they cannot contribute a verdict.
 *
 * Accuracy = hits / (hits + misses) where:
 *   hit  = reviewed record with an empty predictedMiss array
 *   miss = reviewed record with ≥1 entry in predictedMiss
 *
 * When no records are reviewed, accuracy is null (not zero — §8: skipped ≠ pass).
 *
 * @param {PredictionRecord[]} predictionRecords
 * @param {{ nodes: object[], edges: object[] }} graph
 * @returns {CalibrationResult}
 */
export function aggregateCalibration(predictionRecords, graph) {
  const safeRecords = Array.isArray(predictionRecords) ? predictionRecords : [];
  const cardToWorkflow  = buildCardToWorkflowMap(graph);
  const sessionToCards  = buildSessionToCardsMap(graph);

  /** @type {Map<string, { predictions: number, hits: number, misses: number, unforeseen: number }>} */
  const bySlug = new Map();

  /**
   * Ensures the slug bucket exists and returns it.
   * @param {string} slug
   */
  function bucketFor(slug) {
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { predictions: 0, hits: 0, misses: 0, unforeseen: 0 });
    }
    return bySlug.get(slug);
  }

  for (const record of safeRecords) {
    if (!record || !record.reviewed) continue;

    const slug   = resolveWorkflowSlug(record, cardToWorkflow, sessionToCards, graph);
    const bucket = bucketFor(slug);
    bucket.predictions += 1;

    const missCount       = Array.isArray(record.predictedMiss) ? record.predictedMiss.length : 0;
    const unforeseenCount = Array.isArray(record.unforeseen)    ? record.unforeseen.length    : 0;
    if (missCount === 0) {
      bucket.hits += 1;
    } else {
      bucket.misses += 1;
    }
    bucket.unforeseen += unforeseenCount;
  }

  // Build perWorkflow array sorted alphabetically by slug
  const perWorkflow = [...bySlug.entries()]
    .sort(([slugA], [slugB]) => slugA.localeCompare(slugB))
    .map(([slug, counts]) => {
      const total = counts.hits + counts.misses;
      return {
        slug,
        predictions: counts.predictions,
        hits:        counts.hits,
        misses:      counts.misses,
        unforeseen:  counts.unforeseen,
        accuracy:    total > 0 ? counts.hits / total : null,
      };
    });

  // Overall aggregation across all workflow buckets
  let totalPredictions = 0;
  let totalHits = 0;
  let totalMisses = 0;
  for (const wfEntry of perWorkflow) {
    totalPredictions += wfEntry.predictions;
    totalHits        += wfEntry.hits;
    totalMisses      += wfEntry.misses;
  }
  const overallDenominator = totalHits + totalMisses;

  /** @type {OverallCalibration} */
  const overall = {
    predictions: totalPredictions,
    hits:        totalHits,
    misses:      totalMisses,
    accuracy:    overallDenominator > 0 ? totalHits / overallDenominator : null,
    confidence:  'derived',
  };

  return { perWorkflow, overall };
}
