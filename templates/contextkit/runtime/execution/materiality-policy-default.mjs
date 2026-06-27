/**
 * materiality-policy-default.mjs — embedded fallback policy for §28 decision
 * materiality scoring (BIZ-0001 / WF-0037 / ADR-0125).
 *
 * Byte-equivalent to `policy/decision-intelligence.json` so scoring never crashes
 * when the policy file is absent. Frozen to prevent mutation (immutable rule 2).
 * Extracted from materiality-score.mjs to respect the 280-line budget.
 *
 * @module materiality-policy-default
 */

/** @type {Readonly<object>} */
export const DEFAULT_DECISION_POLICY = Object.freeze({
  schemaVersion: 1,
  materialityWeights: Object.freeze({
    publicContractChange:  5,
    breakingChange:        5,
    crossCuttingArch:      5,
    dataMigration:         5,
    authChange:            5,
    invariantChange:       5,
    materialCompliance:    5,
    newBoundary:           4,
    newPersistence:        4,
    structuralVendor:      4,
    complexRollout:        4,
    expensiveReversal:     4,
    multiTeam:             3,
    reusableStandard:      3,
    importantPerf:         3,
    localReversible:       0,
    coveredByAcceptedAdr: -10,
  }),
  materialityBands: Object.freeze({ required: 8, recommended: 4, none: 0 }),
  routineCeilingDefault: 3,
  regulatedDomains: Object.freeze(['lgpd', 'fintech', 'healthcare']),
  materialKinds: Object.freeze([
    'ARCHITECTURE', 'POLICY', 'COMPLIANCE',
    'BUSINESS_AUTHORIZATION', 'OPERATION_AUTHORIZATION', 'LIFECYCLE',
  ]),
  // §28 boolean token detectors — detect from lowercased objective text
  publicContractTokens: Object.freeze([
    'public api', 'public contract', 'exported interface', 'external api',
    'breaking api', 'api version', 'public surface', 'client-facing',
  ]),
  breakingTokens: Object.freeze([
    'breaking change', 'breaking-change', 'semver major', 'incompatible change',
    'backward incompatible', 'non-backward-compatible',
  ]),
  crossCuttingArchTokens: Object.freeze([
    'cross-cutting', 'cross cutting', 'kit-wide', 'platform-wide',
    'across modules', 'across the repo', 'fleet', 'foundation',
    'architectural change', 'cross-module',
  ]),
  dataMigrationTokens: Object.freeze([
    'data migration', 'schema migration', 'migrate data', 'database migration',
    'db migration', 'migrate the database', 'schema change', 'drop column',
    'alter table', 'data model change', 'migrate schema',
  ]),
  authTokens: Object.freeze([
    'authentication', 'authorization', 'auth', 'oauth', 'jwt', 'permissions',
    'access control', 'rbac', 'roles and permissions', 'security policy',
    'credential', 'login', 'sso',
  ]),
  invariantTokens: Object.freeze([
    'invariant', 'constraint', 'integrity rule', 'business rule', 'domain rule',
    'protocol change', 'contract change', 'interface contract',
  ]),
  materialComplianceTokens: Object.freeze([
    'compliance', 'lgpd', 'gdpr', 'hipaa', 'pci', 'regulatory', 'fintech',
    'audit trail', 'data protection', 'legal requirement',
  ]),
  newBoundaryTokens: Object.freeze([
    'new module', 'new service', 'new package', 'module boundary',
    'service boundary', 'new component', 'new subsystem', 'new plugin',
    'new layer',
  ]),
  persistenceTokens: Object.freeze([
    'new database', 'new storage', 'persistence layer', 'data store',
    'database engine', 'storage strategy', 'new orm', 'cache layer',
    'persistence strategy',
  ]),
  vendorTokens: Object.freeze([
    'new dependency', 'third-party', 'vendor', 'external library',
    'new library', 'npm package', 'sdk integration', 'third party',
    'external service',
  ]),
  rolloutTokens: Object.freeze([
    'feature flag', 'rollout', 'canary', 'phased release', 'gradual rollout',
    'rollback plan', 'deployment strategy', 'release strategy',
  ]),
  reversalTokens: Object.freeze([
    'irreversible', 'one-way', 'cannot revert', 'no rollback', 'permanent change',
    'data deletion', 'delete data', 'drop table', 'expensive reversal',
    'difficult to revert', 'hard to undo', 'rewrite', 'replace',
  ]),
  multiTeamTokens: Object.freeze([
    'multiple teams', 'multi-team', 'across teams', 'cross-team', 'cross-product',
    'multiple products', 'team coordination', 'shared service', 'platform team',
    'inter-team',
  ]),
  reusableStandardTokens: Object.freeze([
    'new standard', 'reusable pattern', 'shared pattern', 'common library',
    'design pattern', 'coding standard', 'best practice', 'template',
    'reusable component', 'shared library',
  ]),
  perfTokens: Object.freeze([
    'performance', 'latency', 'throughput', 'scalability', 'performance trade-off',
    'performance impact', 'optimization', 'memory usage', 'cpu usage',
    'benchmark', 'perf regression',
  ]),
  emergencyEnvelope: Object.freeze({
    restoreSafety:    Object.freeze(['revert', 'rollback', 'restore', 'roll back']),
    productionHotfix: Object.freeze(['hotfix', 'production incident', 'prod down', 'outage']),
    updaterSafety:    Object.freeze(['updater', '--update', 'defer update']),
  }),
  lifecycleTokens: Object.freeze([
    'supersede', 'deprecate', 'transfer ownership', 'replace adr',
  ]),
});
