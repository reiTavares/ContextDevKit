/**
 * WF-0059 Wave 6 — compatibility adapters (SPEC §D8, ADR-0124).
 *
 * ADR-0124 replaces the pre-reform conventions — a `workflow: <slug>`
 * frontmatter string and a bare numeric/UUID task id — with a structural
 * owner FK `owner:{kind,id,lane}` (`tasks-schema.mjs` OWNER_KINDS). This
 * module lets OLD references keep resolving through >=1 release, without the
 * engine ever guessing on the caller's behalf:
 *
 *   - `resolveWorkflowString(slug, resolveOwnerId)` — maps an old
 *     `workflow: <slug>` string to a `{ kind:'WF', id, lane:null }` FK, via an
 *     INJECTED resolver. An unknown slug REFUSES (throws) rather than
 *     returning a null the caller might silently fold into a new FK.
 *   - `resolveLegacyId(oldId, index)` — maps a legacy bare id to its new
 *     `{ owner, id }` location, via an INJECTED candidate index. Exactly one
 *     candidate resolves; zero or (the historical duplicate-`001` case) two
 *     or more candidates THROW — ambiguity is refused, never guessed.
 *   - `deprecationNotice(oldSurface, newPath)` — renders a message pointing a
 *     caller at the new owner-scoped path when an old surface is used. This
 *     one never throws: a deprecation notice is best-effort UX, not a gate.
 *
 * Pure, zero-dep, no disk I/O — every lookup (resolver / index) is injected
 * by the caller. The Wave 7 migration tooling owns loading the real
 * slug->id registry and the legacy-id candidate index from disk and passing
 * them in here.
 */
import { OWNER_KINDS } from './tasks-schema.mjs';

/** True for a non-empty string (mirrors tasks-validate.mjs). */
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Resolves an old `workflow: <slug>` frontmatter string to the new owner FK
 * `{ kind: 'WF', id, lane: null }` (SPEC §D8). The slug->id lookup itself is
 * injected via `resolveOwnerId` so this function stays pure and never reads
 * disk.
 *
 * An unresolvable slug REFUSES: it throws a descriptive error instead of
 * returning a plausible-looking `null` the caller could silently propagate
 * into a new task's owner FK. This mirrors `resolveLegacyId`'s
 * refuse-don't-guess contract below.
 *
 * @param {string} slug — the legacy `workflow:` frontmatter value
 * @param {(slug: string) => (string|null|undefined)} resolveOwnerId —
 *   injected slug -> workflow id lookup; returns a falsy value for an
 *   unknown slug
 * @returns {{ kind: 'WF', id: string, lane: null }}
 * @throws {Error} when `slug`/`resolveOwnerId` are malformed, or the slug is
 *   unknown (the resolver returns a falsy id)
 */
export function resolveWorkflowString(slug, resolveOwnerId) {
  if (!isNonEmptyString(slug)) {
    throw new Error('resolveWorkflowString: slug must be a non-empty string');
  }
  if (typeof resolveOwnerId !== 'function') {
    throw new Error('resolveWorkflowString: resolveOwnerId resolver function is required');
  }
  if (!OWNER_KINDS.includes('WF')) {
    // Schema invariant guard — keeps this module honest if OWNER_KINDS ever changes.
    throw new Error('resolveWorkflowString: schema invariant violated — "WF" is not a recognized owner kind');
  }
  const wfId = resolveOwnerId(slug);
  if (!isNonEmptyString(wfId)) {
    throw new Error(`resolveWorkflowString: unknown workflow slug "${slug}" — no WF id resolves (refusing rather than guessing)`);
  }
  return { kind: 'WF', id: wfId, lane: null };
}

/**
 * Looks up the candidate list for `oldId` in `index` — accepts either a
 * `Map` or a plain object (JSON-friendly), so callers can pass either.
 *
 * @param {Map<string, Array>|Object<string, Array>|null|undefined} index
 * @param {string} oldId
 * @returns {Array|undefined}
 */
function lookupCandidates(index, oldId) {
  if (index instanceof Map) return index.get(oldId);
  if (index && typeof index === 'object') return index[oldId];
  return undefined;
}

/**
 * Resolves a legacy bare task id (numeric or UUID, pre-reform) to its new
 * `{ owner, id }` location (SPEC §D8). The candidate lookup is injected via
 * `index` so this function stays pure and never reads disk.
 *
 * The reform's central refusal rule: an id that maps to more than one
 * candidate (the historical duplicate-`001` case, split across owners) is
 * AMBIGUOUS and THROWS — it never guesses the "most likely" owner. Zero
 * candidates also throws: an unknown id is not a silent no-op.
 *
 * @param {string} oldId — the legacy bare task id
 * @param {Map<string, Array<{owner: object, id: string}>>|Object<string, Array<{owner: object, id: string}>>} index —
 *   injected oldId -> candidate list (Map or plain object)
 * @returns {{ owner: object, id: string }} the single resolved candidate
 * @throws {Error} when `oldId` is malformed, unknown (0 candidates), or
 *   ambiguous (>=2 candidates)
 */
export function resolveLegacyId(oldId, index) {
  if (!isNonEmptyString(oldId)) {
    throw new Error('resolveLegacyId: oldId must be a non-empty string');
  }
  const candidates = lookupCandidates(index, oldId);
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    throw new Error(`resolveLegacyId: unknown legacy id "${oldId}" — no candidate resolves`);
  }
  if (list.length > 1) {
    throw new Error(`resolveLegacyId: ambiguous legacy id "${oldId}" — ${list.length} candidates resolve (refusing rather than guessing)`);
  }
  return list[0];
}

/**
 * Renders a deprecation message pointing an old surface/command at its new
 * owner-scoped replacement path (SPEC §D8). Never throws — a deprecation
 * notice is best-effort UX, not a validation gate — so garbage input
 * degrades to a placeholder label rather than blocking the caller's real
 * work.
 *
 * @param {string} oldSurface — the deprecated surface/command name
 * @param {string} newPath — the new owner-scoped path/command to use instead
 * @returns {string} a human-readable deprecation message naming both
 */
export function deprecationNotice(oldSurface, newPath) {
  const oldLabel = isNonEmptyString(oldSurface) ? oldSurface : '(unknown surface)';
  const newLabel = isNonEmptyString(newPath) ? newPath : '(unknown path)';
  return `Deprecated: "${oldLabel}" is deprecated — use "${newLabel}" instead.`;
}
