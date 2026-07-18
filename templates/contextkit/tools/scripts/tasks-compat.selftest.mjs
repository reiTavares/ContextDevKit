/**
 * In-process self-test for WF-0059 Wave 6 — the compatibility adapters
 * (`tasks-compat.mjs`).
 *
 * Tests the ACTUAL exported API with injected fakes (no disk I/O):
 *   resolveWorkflowString(slug, resolveOwnerId) -> { kind:'WF', id, lane:null }
 *   resolveLegacyId(oldId, index)               -> { owner, id }
 *   deprecationNotice(oldSurface, newPath)      -> string
 *
 * Sections:
 *   [a] resolveWorkflowString — happy path resolves to a WF owner FK
 *   [b] resolveWorkflowString — unknown slug refuses (throws), never guesses
 *   [c] resolveWorkflowString — malformed input throws
 *   [d] resolveLegacyId — single candidate resolves
 *   [e] resolveLegacyId — the historical duplicate-"001" case is AMBIGUOUS, throws
 *   [f] resolveLegacyId — zero candidates (unknown id) throws
 *   [g] resolveLegacyId — malformed oldId throws
 *   [h] resolveLegacyId — accepts a plain-object index, not just a Map
 *   [i] deprecationNotice — message names both the old surface and the new path
 *   [j] deprecationNotice — defensive on garbage input (null/undefined never throws)
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import { resolveWorkflowString, resolveLegacyId, deprecationNotice } from './tasks-compat.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/** Runs `fn()`, returning the thrown Error (or null if it didn't throw). */
function catchError(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

// ---------------------------------------------------------------------------
// [a] resolveWorkflowString — happy path
const slugRegistry = new Map([['demo-flow', '0059'], ['other-flow', '0042']]);
const resolveOwnerId = (slug) => slugRegistry.get(slug) ?? null;

const fk = resolveWorkflowString('demo-flow', resolveOwnerId);
assert('[a] resolves to a WF owner FK', fk && fk.kind === 'WF' && fk.id === '0059' && fk.lane === null, JSON.stringify(fk));

// ---------------------------------------------------------------------------
// [b] resolveWorkflowString — unknown slug refuses
const unknownSlugErr = catchError(() => resolveWorkflowString('no-such-flow', resolveOwnerId));
assert('[b] unknown slug throws', unknownSlugErr instanceof Error, String(unknownSlugErr));
assert('[b] unknown slug error names the slug', unknownSlugErr && unknownSlugErr.message.includes('no-such-flow'), unknownSlugErr?.message);

// ---------------------------------------------------------------------------
// [c] resolveWorkflowString — malformed input throws
assert('[c] empty slug throws', catchError(() => resolveWorkflowString('', resolveOwnerId)) instanceof Error);
assert('[c] null slug throws', catchError(() => resolveWorkflowString(null, resolveOwnerId)) instanceof Error);
assert('[c] missing resolver throws', catchError(() => resolveWorkflowString('demo-flow', undefined)) instanceof Error);
assert('[c] non-function resolver throws', catchError(() => resolveWorkflowString('demo-flow', {})) instanceof Error);

// ---------------------------------------------------------------------------
// [d] resolveLegacyId — single candidate resolves (Map index)
const legacyIndex = new Map([
  ['501', [{ owner: { kind: 'WF', id: '0059' }, id: 'T-501' }]],
  ['001', [
    { owner: { kind: 'WF', id: 'a' }, id: 'T-001a' },
    { owner: { kind: 'WF', id: 'b' }, id: 'T-001b' },
  ]],
]);

const resolved501 = resolveLegacyId('501', legacyIndex);
assert('[d] single candidate resolves', resolved501 && resolved501.id === 'T-501' && resolved501.owner.id === '0059', JSON.stringify(resolved501));

// ---------------------------------------------------------------------------
// [e] resolveLegacyId — ambiguous "001" (duplicate id, two owners) throws
const ambiguousErr = catchError(() => resolveLegacyId('001', legacyIndex));
assert('[e] ambiguous id throws', ambiguousErr instanceof Error, String(ambiguousErr));
assert('[e] ambiguous error names the id', ambiguousErr && ambiguousErr.message.includes('001'), ambiguousErr?.message);

// ---------------------------------------------------------------------------
// [f] resolveLegacyId — zero candidates (unknown id) throws
const unknownIdErr = catchError(() => resolveLegacyId('999-does-not-exist', legacyIndex));
assert('[f] unknown id throws', unknownIdErr instanceof Error, String(unknownIdErr));
assert('[f] unknown id error names the id', unknownIdErr && unknownIdErr.message.includes('999-does-not-exist'), unknownIdErr?.message);

// ---------------------------------------------------------------------------
// [g] resolveLegacyId — malformed oldId throws
assert('[g] empty oldId throws', catchError(() => resolveLegacyId('', legacyIndex)) instanceof Error);
assert('[g] null oldId throws', catchError(() => resolveLegacyId(null, legacyIndex)) instanceof Error);
assert('[g] undefined oldId throws', catchError(() => resolveLegacyId(undefined, legacyIndex)) instanceof Error);

// ---------------------------------------------------------------------------
// [h] resolveLegacyId — accepts a plain-object index too (JSON-friendly)
const plainObjectIndex = { 501: [{ owner: { kind: 'WF', id: '0059' }, id: 'T-501' }] };
const resolvedFromObject = resolveLegacyId('501', plainObjectIndex);
assert('[h] plain-object index resolves', resolvedFromObject && resolvedFromObject.id === 'T-501', JSON.stringify(resolvedFromObject));
assert('[h] missing index throws (defensive, not a silent resolve)', catchError(() => resolveLegacyId('501', undefined)) instanceof Error);

// ---------------------------------------------------------------------------
// [i] deprecationNotice — names both the old surface and the new path
const notice = deprecationNotice('workflow: <slug>', 'owner FK { kind, id, lane }');
assert('[i] notice contains old surface', notice.includes('workflow: <slug>'), notice);
assert('[i] notice contains new path', notice.includes('owner FK { kind, id, lane }'), notice);

// ---------------------------------------------------------------------------
// [j] deprecationNotice — defensive on garbage input, never throws unexpectedly
const noticeErr = catchError(() => deprecationNotice(null, undefined));
assert('[j] null/undefined input never throws', noticeErr === null, String(noticeErr));
const placeholderNotice = deprecationNotice(null, undefined);
assert('[j] falls back to a placeholder label', typeof placeholderNotice === 'string' && placeholderNotice.length > 0, placeholderNotice);
assert('[j] non-string input never throws', catchError(() => deprecationNotice(42, {})) === null);

process.stdout.write(`\nWF-0059 W6 compat selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
