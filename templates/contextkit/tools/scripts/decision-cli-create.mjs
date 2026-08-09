/**
 * decision-cli-create.mjs — NEW glue for the `decision create` verb.
 *
 * Renders a new ADR markdown from a template kind + caller-supplied fields and
 * writes it atomically to `decisions/{business|operations}/`. Dry-run by default
 * (constitution §8). Zero runtime dependencies — `node:*` + siblings only.
 *
 * Responsibility boundary: one function, one job — produce or plan the ADR file.
 * Validation (schema) and template rendering stay in their own modules.
 *
 * @module decision-cli-create
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { pathsFor, PLATFORM_DIR } from '../../runtime/config/paths.mjs';
import {
  DECISION_CONTEXT_TYPES,
  DECISION_ID_PATTERN,
  DECISION_KINDS,
  VALUE_INTENTS,
} from '../../runtime/work/decision-enums.mjs';
import { readFrontMatter } from '../../runtime/work/front-matter.mjs';
import { validateDecision } from '../../runtime/work/schema-decision.mjs';
import {
  DECISION_DOCUMENT_VERSION,
  renderDecisionFromTemplate,
  validateDecisionDocument,
} from './decision-template.mjs';
import { makeReceipt } from './work-io.mjs';

/** Maps contextType → decisions sub-dir. */
const CONTEXT_DIR = Object.freeze({
  business: 'business',
  operation: 'operations',
  platform: 'business', // platform-scoped ADRs file under business/ by convention
  legacy: 'legacy',
});

/**
 * Derives the output directory and canonical filename for a new ADR.
 *
 * @param {string} root - project root.
 * @param {string} adrId - e.g. `ADR-0125`.
 * @param {string} contextType - one of DECISION_CONTEXT_TYPES.
 * @param {string} slug - lower-kebab title slug.
 * @returns {string} absolute path for the new ADR markdown file.
 */
function resolveOutPath(root, adrId, contextType, slug) {
  const subDir = CONTEXT_DIR[contextType] ?? 'business';
  const decDir = resolve(pathsFor(root).decisions, subDir);
  const filename = `${adrId}-${slug}.md`;
  return resolve(decDir, filename);
}

/**
 * Slugifies a title into a lower-kebab filename segment.
 * Robust: never returns empty string.
 *
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  const slug = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/**
 * Validates the required inputs for the `create` verb. Fails fast at the boundary.
 *
 * @param {object} flags - parsed CLI flags.
 * @returns {{ id: string, kind: string, title: string, contextType: string, primaryContextId: string, valueIntent: string }}
 * @throws {Error} on missing or invalid inputs.
 */
export function validateCreateInputs(flags) {
  const adrId = String(flags.id || '');
  if (!DECISION_ID_PATTERN.test(adrId)) {
    throw new Error(`decision create: --id must match ADR-#### (got "${adrId}")`);
  }
  const kind = String(flags.kind || '');
  if (!DECISION_KINDS.includes(kind)) {
    throw new Error(
      `decision create: --kind must be one of ${DECISION_KINDS.join('|')} (got "${kind}")`,
    );
  }
  const title = String(flags.title || '').trim();
  if (!title) throw new Error('decision create: --title is required');

  const contextType = String(flags['context-type'] || flags.contextType || '');
  if (!DECISION_CONTEXT_TYPES.includes(contextType)) {
    throw new Error(
      `decision create: --context-type must be one of ${DECISION_CONTEXT_TYPES.join('|')} (got "${contextType}")`,
    );
  }
  if (contextType === 'legacy') {
    throw new Error('decision create: legacy context is read-only compatibility; create a schema-v2 owned ADR instead');
  }
  const primaryContextId = String(flags['primary-context'] || flags.primaryContext || '');
  if (!primaryContextId) {
    throw new Error('decision create: --primary-context (e.g. BIZ-0001) is required for non-legacy ADRs');
  }
  const requiredContextByKind = {
    BUSINESS_AUTHORIZATION: 'business',
    OPERATION_AUTHORIZATION: 'operation',
    ROUTINE_OPERATION_GOVERNANCE: 'platform',
    EMERGENCY_GOVERNANCE: 'platform',
  };
  const requiredContext = requiredContextByKind[kind];
  if (requiredContext && contextType !== requiredContext) {
    throw new Error(`decision create: ${kind} requires --context-type ${requiredContext}`);
  }
  const valueIntent = String(flags['value-intent'] || flags.valueIntent || 'IMPROVE');
  if (!VALUE_INTENTS.includes(valueIntent)) {
    throw new Error(`decision create: --value-intent must be one of ${VALUE_INTENTS.join('|')} (got "${valueIntent}")`);
  }
  return { adrId, kind, title, contextType, primaryContextId, valueIntent };
}

/**
 * Select the content profile without allowing it to redefine context ownership.
 * @param {string} kind canonical decision kind
 * @param {string} contextType canonical context owner kind
 * @returns {'business'|'operation'|'routine-operation-governance'|'emergency-governance'}
 */
function templateKindFor(kind, contextType) {
  if (kind === 'ROUTINE_OPERATION_GOVERNANCE') return 'routine-operation-governance';
  if (kind === 'EMERGENCY_GOVERNANCE') return 'emergency-governance';
  return contextType === 'operation' ? 'operation' : 'business';
}

/**
 * Refuse a rendered ADR that violates either the schema or document standard.
 * @param {string} markdown rendered ADR
 * @returns {void}
 * @throws {Error} when the render is not a canonical new ADR
 */
function assertRenderedDecision(markdown) {
  const parsed = readFrontMatter(markdown);
  if (!parsed.ok || !parsed.hasFrontMatter || !parsed.data) {
    throw new Error('decision create: rendered ADR has invalid YAML front matter');
  }
  const schemaVerdict = validateDecision(parsed.data);
  const documentVerdict = validateDecisionDocument(markdown);
  const errors = [
    ...schemaVerdict.errors,
    ...(parsed.data.documentVersion === DECISION_DOCUMENT_VERSION
      ? []
      : [`documentVersion must be ${DECISION_DOCUMENT_VERSION}`]),
    ...documentVerdict.errors,
  ];
  if (errors.length > 0) {
    throw new Error(`decision create: rendered ADR is invalid: ${errors.join('; ')}`);
  }
}

/**
 * Handles the `create` verb: render an ADR from template and optionally write it.
 *
 * @param {object} args
 * @param {object} args.flags - parsed CLI flags.
 * @param {boolean} args.apply - write when true; dry-run when false.
 * @param {string} args.root - project root.
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on validation failures or unresolved template tokens.
 */
export function handleCreate({ flags, apply, root }) {
  const {
    adrId,
    kind,
    title,
    contextType,
    primaryContextId,
    valueIntent,
  } = validateCreateInputs(flags);
  const slug = slugify(title);
  const today = new Date().toISOString().slice(0, 10);

  const templateKind = templateKindFor(kind, contextType);

  const fields = {
    // Template uses {{ID}} — canonical token for the ADR id.
    ID: adrId,
    ADR_ID: adrId,          // kept for forward-compat / old template variants
    TITLE: title,
    STATUS: 'proposed',
    CONTEXT_TYPE: contextType,
    PRIMARY_CONTEXT_TYPE: contextType,
    DECISION_KIND: kind,
    DECISION_SCOPE: String(flags['decision-scope'] || flags.decisionScope || 'platform'),
    PRIMARY_CONTEXT_ID: primaryContextId,
    // approvalSource block — intentionally blank until accepted; placeholders
    // keep the template renderable at `create` time (no unresolved tokens).
    APPROVAL_ID: primaryContextId || adrId,
    APPROVAL_REVISION: '0',
    DECISION_HASH: 'pending-acceptance',
    APPROVED_AT: 'pending-acceptance',
    VALUE_INTENT_PRIMARY: valueIntent,
    PRODUCT_ID: String(flags['product-id'] || flags.productId || ''),
    PRODUCT_AREA: String(flags['product-area'] || flags.productArea || ''),
    PRODUCT_CAPABILITY: String(flags['product-capability'] || flags.productCapability || ''),
    DATE: today,
    CREATED_AT: today,
    ACCEPTED_AT: today,
    UPDATED_AT: today,
    PLATFORM_DIR,
  };

  const outPath = resolveOutPath(root, adrId, contextType, slug);
  const renderResult = renderDecisionFromTemplate({
    kind: templateKind,
    fields,
    root,
    outPath,
    apply: false, // We control the write ourselves so we can ensure dir exists.
  });

  if (!renderResult.ok) {
    throw new Error(
      `decision create: template has unresolved tokens: ${renderResult.missing.join(', ')}`,
    );
  }
  assertRenderedDecision(renderResult.text);

  let written = false;
  if (apply) {
    if (existsSync(outPath)) {
      // Idempotent: file already there — not an error, just report.
      return makeReceipt({
        command: 'create',
        applied: false,
        writes: [outPath],
        detail: { adrId, outPath, idempotentNoop: true, note: 'file already exists' },
      });
    }
    mkdirSync(resolve(pathsFor(root).decisions, CONTEXT_DIR[contextType] ?? 'business'), { recursive: true });
    // Use the template renderer's atomic write path.
    const applyResult = renderDecisionFromTemplate({ kind: templateKind, fields, root, outPath, apply: true });
    written = applyResult.applied;
  }

  return makeReceipt({
    command: 'create',
    applied: written,
    writes: [outPath],
    detail: {
      adrId,
      kind: templateKind,
      contextType,
      documentVersion: DECISION_DOCUMENT_VERSION,
      outPath,
      idempotentNoop: false,
    },
  });
}
