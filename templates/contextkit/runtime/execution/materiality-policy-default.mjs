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
    'api pública', 'api publica', 'contrato público', 'contrato publico',
    'interface exportada', 'api externa', 'superfície pública', 'superficie publica',
  ]),
  breakingTokens: Object.freeze([
    'breaking change', 'breaking-change', 'semver major', 'incompatible change',
    'backward incompatible', 'non-backward-compatible',
    'quebra de compatibilidade', 'mudança incompatível', 'mudanca incompativel',
  ]),
  crossCuttingArchTokens: Object.freeze([
    'cross-cutting', 'cross cutting', 'kit-wide', 'platform-wide',
    'across modules', 'across the repo', 'fleet', 'foundation',
    'architectural change', 'cross-module',
    'entre módulos', 'entre modulos', 'entre o repositório', 'entre o repositorio',
    'fundação', 'fundacao', 'mudança arquitetural', 'mudanca arquitetural',
  ]),
  dataMigrationTokens: Object.freeze([
    'data migration', 'schema migration', 'migrate data', 'database migration',
    'db migration', 'migrate the database', 'schema change', 'drop column',
    'alter table', 'data model change', 'migrate schema',
    'migração de dados', 'migracao de dados', 'migração de esquema', 'migracao de esquema',
    'migrar dados', 'migração do banco de dados', 'migracao do banco de dados',
    'migrar o banco de dados', 'migrar esquema',
  ]),
  authTokens: Object.freeze([
    'authentication', 'authorization', 'auth', 'oauth', 'jwt', 'permissions',
    'access control', 'rbac', 'roles and permissions', 'security policy',
    'credential', 'login', 'sso',
    'autenticação', 'autenticacao', 'autorização', 'autorizacao',
    'permissões', 'permissoes', 'credencial',
  ]),
  invariantTokens: Object.freeze([
    'invariant', 'constraint', 'integrity rule', 'business rule', 'domain rule',
    'protocol change', 'contract change', 'interface contract',
    'invariante', 'restrição', 'restricao', 'regra de negócio', 'regra de negocio',
    'regra de domínio', 'regra de dominio',
  ]),
  materialComplianceTokens: Object.freeze([
    'compliance', 'lgpd', 'gdpr', 'hipaa', 'pci', 'regulatory', 'fintech',
    'audit trail', 'data protection', 'legal requirement',
    'conformidade', 'regulatório', 'regulatorio', 'trilha de auditoria',
    'proteção de dados', 'protecao de dados', 'requisito legal',
  ]),
  newBoundaryTokens: Object.freeze([
    'new module', 'new service', 'new package', 'module boundary',
    'service boundary', 'new component', 'new subsystem', 'new plugin',
    'new layer',
    'novo módulo', 'novo modulo', 'novo serviço', 'novo servico',
    'novo componente', 'novo subsistema', 'nova camada',
  ]),
  persistenceTokens: Object.freeze([
    'new database', 'new storage', 'persistence layer', 'data store',
    'database engine', 'storage strategy', 'new orm', 'cache layer',
    'persistence strategy',
    'novo banco de dados', 'novo armazenamento', 'camada de persistência',
    'camada de persistencia',
  ]),
  vendorTokens: Object.freeze([
    'new dependency', 'third-party', 'vendor', 'external library',
    'new library', 'npm package', 'sdk integration', 'third party',
    'external service',
    'nova dependência', 'nova dependencia', 'biblioteca externa', 'terceiros',
  ]),
  rolloutTokens: Object.freeze([
    'feature flag', 'rollout', 'canary', 'phased release', 'gradual rollout',
    'rollback plan', 'deployment strategy', 'release strategy',
    'implantação', 'implantacao', 'lançamento gradual', 'lancamento gradual',
    'plano de rollback',
  ]),
  reversalTokens: Object.freeze([
    'irreversible', 'one-way', 'cannot revert', 'no rollback', 'permanent change',
    'data deletion', 'delete data', 'drop table', 'expensive reversal',
    'difficult to revert', 'hard to undo', 'rewrite', 'replace',
    'irreversível', 'irreversivel', 'reescrever', 'substituir',
    'mudança permanente', 'mudanca permanente', 'exclusão de dados', 'exclusao de dados',
  ]),
  multiTeamTokens: Object.freeze([
    'multiple teams', 'multi-team', 'across teams', 'cross-team', 'cross-product',
    'multiple products', 'team coordination', 'shared service', 'platform team',
    'inter-team',
    'várias equipes', 'varias equipes', 'entre equipes', 'entre produtos',
    'coordenação de equipe', 'coordenacao de equipe',
  ]),
  reusableStandardTokens: Object.freeze([
    'new standard', 'reusable pattern', 'shared pattern', 'common library',
    'design pattern', 'coding standard', 'best practice', 'template',
    'reusable component', 'shared library',
    'novo padrão', 'novo padrao', 'padrão reutilizável', 'padrao reutilizavel',
    'boa prática', 'boa pratica', 'biblioteca compartilhada',
  ]),
  perfTokens: Object.freeze([
    'performance', 'latency', 'throughput', 'scalability', 'performance trade-off',
    'performance impact', 'optimization', 'memory usage', 'cpu usage',
    'benchmark', 'perf regression',
    'desempenho', 'otimização', 'otimizacao', 'escalabilidade',
    'uso de memória', 'uso de memoria',
  ]),
  emergencyEnvelope: Object.freeze({
    restoreSafety:    Object.freeze(['revert', 'rollback', 'restore', 'roll back', 'reverter', 'restaurar']),
    productionHotfix: Object.freeze(['hotfix', 'production incident', 'prod down', 'outage', 'incidente em produção', 'incidente em producao', 'produção fora do ar', 'producao fora do ar', 'queda']),
    updaterSafety:    Object.freeze(['updater', '--update', 'defer update', 'atualizador', 'adiar atualização', 'adiar atualizacao']),
  }),
  lifecycleTokens: Object.freeze([
    'supersede', 'deprecate', 'transfer ownership', 'replace adr',
    'substituir adr', 'descontinuar', 'depreciar', 'transferir propriedade',
  ]),
});
