/**
 * evidence-taxonomy-core.mjs — Pure canonical evidence taxonomy for CDK-075.
 *
 * Unifies receipt OUTCOME kinds (from receipt-store.mjs RESULTS) and evidence
 * ARTIFACT types (from capability receiptType values in the registry) into one
 * canonical taxonomy. Provides a node→kind classifier and a coverage folder
 * over a lineage graph.
 *
 * Design decisions:
 *   - PURE module — zero I/O. Callers supply RESULTS and registry as arguments.
 *   - Derived, not hardcoded — every kind is read from the real enumeration sources.
 *   - §8 anti-theatre: unknownKinds surfaces drift; never silently buckets rogue
 *     results/types as known ones (false-negative degradation is forbidden).
 *   - Fail-fast for callers: bad inputs produce empty-but-valid taxonomies, not throws.
 *
 * Zero runtime deps — pure ESM, no node:* imports.
 * ADR-0072 / CDK-075. ≤ 308 lines.
 */

// ---------------------------------------------------------------------------
// Public types (JSDoc only — no TS)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: string, family: 'outcome' }} OutcomeEntry
 * @typedef {{ kind: string, family: 'artifact', capabilityIds: string[] }} ArtifactEntry
 * @typedef {{ outcomes: OutcomeEntry[], evidenceTypes: ArtifactEntry[] }} EvidenceTaxonomy
 * @typedef {{ kind: string, family: string, confidence: string, artifactKind?: string }} ClassifyResult
 * @typedef {{ receipts: number, byResult: Record<string,number>, byType: Record<string,number>, unknownKinds: string[] }} CoverageResult
 */

// ---------------------------------------------------------------------------
// buildTaxonomy
// ---------------------------------------------------------------------------

/**
 * Builds the canonical evidence taxonomy from the two live enumerations.
 *
 * outcomes — one entry per value in the RESULTS freeze array from receipt-store.mjs.
 * evidenceTypes — one entry per distinct receiptType across all capabilities in the
 * registry, carrying the capabilityIds that declare each type.
 *
 * Both collections are DERIVED: the caller passes the real sources. Nothing is hardcoded.
 *
 * @param {readonly string[]} results  the RESULTS array from receipt-store.mjs
 * @param {{ capabilities?: Array<{ id?: string, receiptType?: string }> }} registry
 *   capability registry object (loadRegistry() result or DEFAULT_REGISTRY)
 * @returns {EvidenceTaxonomy}
 */
export function buildTaxonomy(results, registry) {
  const safeResults = Array.isArray(results) ? results : [];
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];

  // Outcome family — one entry per RESULTS value, ordered as declared.
  const outcomes = safeResults.map((kind) => ({ kind: String(kind), family: 'outcome' }));

  // Artifact family — group capabilities by their receiptType.
  /** @type {Map<string, string[]>} receiptType → capabilityIds[] */
  const typeToCapIds = new Map();
  for (const cap of capabilities) {
    const receiptType = cap.receiptType;
    if (typeof receiptType !== 'string' || receiptType.length === 0) continue;
    const capId = typeof cap.id === 'string' ? cap.id : '';
    if (!typeToCapIds.has(receiptType)) typeToCapIds.set(receiptType, []);
    if (capId) typeToCapIds.get(receiptType).push(capId);
  }

  const evidenceTypes = [...typeToCapIds.entries()].map(([kind, capabilityIds]) => ({
    kind,
    family: 'artifact',
    capabilityIds,
  }));

  return { outcomes, evidenceTypes };
}

// ---------------------------------------------------------------------------
// classifyEvidence
// ---------------------------------------------------------------------------

/**
 * Classifies a single lineage-graph node against the canonical taxonomy.
 *
 * Receipt nodes (node.type === 'receipt') → outcome family:
 *   - kind = ref.result (e.g. 'passed', 'failed')
 *   - confidence = 'direct' when ref.result is found in taxonomy outcomes
 *   - confidence = 'unknown' when ref.result is not in taxonomy (rogue result)
 *   - artifactKind resolved from ref.capability → receiptType via capabilityIds
 *     lookup (present only when resolvable; absent otherwise)
 *
 * Non-receipt nodes → { kind: 'n/a', family: 'none', confidence: 'unknown' }.
 *
 * Never throws — defensive on all node shapes.
 *
 * @param {object} node  a node from buildLineage()'s nodes array
 * @param {EvidenceTaxonomy} taxonomy  from buildTaxonomy()
 * @returns {ClassifyResult}
 */
export function classifyEvidence(node, taxonomy) {
  const NA = { kind: 'n/a', family: 'none', confidence: 'unknown' };

  if (!node || typeof node !== 'object') return NA;
  if (node.type !== 'receipt') return NA;

  const ref = node.ref && typeof node.ref === 'object' ? node.ref : {};
  const resultKind = typeof ref.result === 'string' ? ref.result : '';

  const safeOutcomes = Array.isArray(taxonomy?.outcomes) ? taxonomy.outcomes : [];
  const safeArtifacts = Array.isArray(taxonomy?.evidenceTypes) ? taxonomy.evidenceTypes : [];

  const knownOutcome = safeOutcomes.find((o) => o.kind === resultKind);
  const confidence = knownOutcome ? 'direct' : 'unknown';

  /** @type {ClassifyResult} */
  const result = {
    kind: resultKind || 'n/a',
    family: 'outcome',
    confidence,
  };

  // Resolve artifact kind via ref.capability → capabilityIds lookup
  const capabilityId = typeof ref.capability === 'string' ? ref.capability : '';
  if (capabilityId) {
    const artifactEntry = safeArtifacts.find((a) => a.capabilityIds.includes(capabilityId));
    if (artifactEntry) result.artifactKind = artifactEntry.kind;
  }

  return result;
}

// ---------------------------------------------------------------------------
// taxonomyCoverage
// ---------------------------------------------------------------------------

/**
 * Folds a lineage graph's receipt nodes to compute taxonomy coverage.
 *
 * byResult — counts per ref.result value across all receipt nodes.
 * byType — counts per resolved artifact kind (via ref.capability → receiptType).
 * unknownKinds — any ref.result OR resolved artifact kind NOT present in the
 *   canonical taxonomy. §8 anti-theatre: rogue values surface here and are NEVER
 *   silently bucketed into a known kind.
 *
 * @param {{ nodes: object[] }} graph  lineage graph from buildLineage()
 * @param {EvidenceTaxonomy} taxonomy  from buildTaxonomy()
 * @returns {CoverageResult}
 */
export function taxonomyCoverage(graph, taxonomy) {
  const safeNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const safeOutcomes = Array.isArray(taxonomy?.outcomes) ? taxonomy.outcomes : [];
  const safeArtifacts = Array.isArray(taxonomy?.evidenceTypes) ? taxonomy.evidenceTypes : [];

  const knownResults = new Set(safeOutcomes.map((o) => o.kind));
  const knownTypes = new Set(safeArtifacts.map((a) => a.kind));

  /** @type {Record<string,number>} */
  const byResult = {};
  /** @type {Record<string,number>} */
  const byType = {};
  /** @type {Set<string>} */
  const unknownSet = new Set();

  let receiptCount = 0;

  for (const node of safeNodes) {
    if (!node || node.type !== 'receipt') continue;
    receiptCount += 1;

    const ref = node.ref && typeof node.ref === 'object' ? node.ref : {};

    // -- Outcome kind tracking
    const resultValue = typeof ref.result === 'string' ? ref.result : '';
    if (resultValue) {
      byResult[resultValue] = (byResult[resultValue] ?? 0) + 1;
      // §8: if not in known results → surface in unknownKinds
      if (!knownResults.has(resultValue)) unknownSet.add(resultValue);
    }

    // -- Artifact kind tracking via capability lookup
    const capabilityId = typeof ref.capability === 'string' ? ref.capability : '';
    if (capabilityId) {
      const artifactEntry = safeArtifacts.find((a) => a.capabilityIds.includes(capabilityId));
      if (artifactEntry) {
        byType[artifactEntry.kind] = (byType[artifactEntry.kind] ?? 0) + 1;
        // Sanity: the resolved type should be in knownTypes (it always is — derived)
        if (!knownTypes.has(artifactEntry.kind)) unknownSet.add(artifactEntry.kind);
      }
      // If capability resolves to no artifact entry the receiptType is unknown
      // but we cannot derive a kind to surface — we simply don't count it.
    }
  }

  return {
    receipts: receiptCount,
    byResult,
    byType,
    unknownKinds: [...unknownSet].sort(),
  };
}
