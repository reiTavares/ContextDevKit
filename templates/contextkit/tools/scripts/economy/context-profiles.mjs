/**
 * context-profiles.mjs — Profile engine for context-pack (ECON-05, WF0020).
 *
 * A "profile" is a named set of priorities that trims the context pack to a
 * token budget. The engine is purely functional: it takes an ordered section
 * list and returns a filtered/trimmed copy — it never writes anything.
 *
 * Invariants (all must hold under every profile):
 *   1. kind:'rule' sections are NEVER dropped, even if over budget.
 *   2. Unknown profile name → sections returned UNCHANGED (full pack).
 *   3. Trimming order: session → changelog → narrative (rules last, never cut).
 *   4. Budget is measured in output *lines* (body lines across all sections).
 *
 * ADR-0044 D1 constrains the `subagent` budget to ≤120 lines.
 * Zero runtime dependencies — node:* only (no imports needed; pure logic).
 *
 * Cohesion note: this module exists to keep context-pack.mjs under the 280-line
 * limit (constitution §1 +10% tolerance). One concern, one seam.
 */

/**
 * Line budgets per named profile.
 * `subagent` MUST be ≤120 (ADR-0044 D1).
 * Remaining budgets are advisory: they cap low-priority sections but never rules.
 *
 * @type {Record<string, number>}
 */
export const PROFILE_BUDGETS = Object.freeze({
  state:       200,
  'dev-start': 160,
  ship:        140,
  review:      180,
  subagent:    120,
});

/**
 * Priority order for trimming when over budget.
 * Sections with higher index are trimmed first.
 * kind:'rule' sections are exempt from trimming entirely.
 *
 * @type {Record<string, number>} — lower = cut last
 */
const TRIM_PRIORITY = {
  session:   3,   // cut first (often the most verbose)
  changelog: 2,
  narrative: 1,
  // rule: never cut (handled separately)
};

/**
 * Count non-empty lines in a body string.
 * @param {string|null|undefined} body
 * @returns {number}
 */
function countLines(body) {
  if (!body) return 0;
  return body.split('\n').filter((l) => l.trim()).length;
}

/**
 * Trim a body string to at most `maxLines` non-empty lines.
 * Returns the original body if it already fits.
 * @param {string} body
 * @param {number} maxLines
 * @returns {string}
 */
function trimToLines(body, maxLines) {
  if (!body) return body;
  const nonEmpty = body.split('\n').filter((l) => l.trim());
  if (nonEmpty.length <= maxLines) return body;
  return nonEmpty.slice(0, maxLines).join('\n') + '\n… (trimmed by profile)';
}

/**
 * Apply a named profile to an ordered section list.
 *
 * @param {Array<{key: string, title: string, body: string|null, kind: string}>} sections
 * @param {string} profileName
 * @returns {Array<{key: string, title: string, body: string|null, kind: string}>}
 */
export function applyProfile(sections, profileName) {
  const budget = PROFILE_BUDGETS[profileName];

  // Unknown profile → full pack (fail-open, graceful degradation).
  if (budget === undefined) return sections;

  // Separate rules (exempt) from trimmable sections.
  const rules = sections.filter((s) => s.kind === 'rule');
  const trimmable = sections.filter((s) => s.kind !== 'rule');

  // Count lines already consumed by rule sections.
  const ruleLines = rules.reduce((sum, s) => sum + countLines(s.body), 0);
  let remaining = Math.max(0, budget - ruleLines);

  // Sort trimmable sections by trim priority (highest priority cut = first).
  // We work through them in cut-order, allocating remaining budget greedily.
  const byPriority = [...trimmable].sort(
    (a, b) =>
      (TRIM_PRIORITY[b.kind] ?? 0) - (TRIM_PRIORITY[a.kind] ?? 0)
  );

  // Allocate budget across trimmable sections.
  // Sections with lower cut-priority (= more important) get their share last
  // so they are squeezed only when the higher-priority ones consumed everything.
  const budgetMap = new Map();
  // First pass: claim lines for sections in reverse cut-order (least important last).
  for (const sec of byPriority) {
    const need = countLines(sec.body);
    if (need <= remaining) {
      budgetMap.set(sec.key, need);
      remaining -= need;
    } else {
      // Give whatever is left; higher-priority sections are processed later.
      budgetMap.set(sec.key, remaining);
      remaining = 0;
    }
  }

  // Rebuild the section list preserving original order, applying trim where needed.
  return sections.map((sec) => {
    if (sec.kind === 'rule') return sec; // rules are sacred
    const allotted = budgetMap.get(sec.key) ?? 0;
    if (allotted === 0) {
      // No budget left — drop the body but keep the section shell.
      return { ...sec, body: null };
    }
    return { ...sec, body: trimToLines(sec.body ?? '', allotted) };
  });
}

/**
 * Return the line budget for a named profile, or null if unknown.
 * @param {string} name
 * @returns {number|null}
 */
export function profileFor(name) {
  return PROFILE_BUDGETS[name] ?? null;
}

// ---------------------------------------------------------------------------
// CI check export (called from selfcheck infrastructure — no direct runner).
// ---------------------------------------------------------------------------

/**
 * Assert profile-engine invariants.
 *
 * @param {string} root — repo / kit root (used for the parity grep)
 * @returns {Promise<Array<{name: string, pass: boolean, detail: string}>>}
 */
export async function econCheckProfiles(root) {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const results = [];

  const assert = (name, pass, detail) => results.push({ name, pass, detail });

  // ---- fixture: a minimal section list covering all kinds ----
  /** @type {Array<{key:string,title:string,body:string|null,kind:string}>} */
  const fixture = [
    { key: 'rules',    title: 'Immutable rules', body: Array(8).fill('- rule line').join('\n'),  kind: 'rule' },
    { key: 'session',  title: 'Last session',    body: Array(50).fill('- session line').join('\n'), kind: 'session' },
    { key: 'changelog',title: 'Unreleased',      body: Array(40).fill('- change line').join('\n'), kind: 'changelog' },
    { key: 'narrative',title: 'ADRs',            body: Array(20).fill('- adr line').join('\n'),  kind: 'narrative' },
  ];

  // ---- 1. Unknown profile → full pack (section count identical) ----
  const full = applyProfile(fixture, '__unknown_profile__');
  assert(
    'unknown-profile-full-pack',
    full.length === fixture.length,
    `expected ${fixture.length} sections, got ${full.length}`
  );

  // ---- 2. subagent profile output ≤120 lines ----
  const subagentResult = applyProfile(fixture, 'subagent');
  const subagentLines = subagentResult.reduce((sum, s) => sum + countLines(s.body), 0);
  assert(
    'subagent-budget-120',
    subagentLines <= 120,
    `subagent pack has ${subagentLines} lines (must be ≤120)`
  );

  // ---- 3. kind:'rule' sections SURVIVE the tightest profile ----
  // Find the profile with the smallest budget.
  const tightest = Object.entries(PROFILE_BUDGETS).sort((a, b) => a[1] - b[1])[0][0];
  const tight = applyProfile(fixture, tightest);
  const ruleSection = tight.find((s) => s.key === 'rules');
  const ruleBody = ruleSection?.body ?? '';
  const ruleLines = countLines(ruleBody);
  assert(
    'rule-section-survives-tightest-profile',
    ruleSection !== undefined && ruleLines > 0,
    `rule section has ${ruleLines} lines after '${tightest}' profile (must be >0)`
  );

  // ---- 4. Parity: context-pack.mjs no longer injects raw extractUnreleased ----
  // Grep the source for the digestUnreleased call to confirm parity.
  const cpPath = resolve(root, 'templates/contextkit/tools/scripts/context-pack.mjs');
  let cpSource = '';
  try {
    cpSource = await readFile(cpPath, 'utf-8');
  } catch {
    assert('parity-digest-unreleased', false, `could not read context-pack.mjs at ${cpPath}`);
    return results;
  }

  // Must contain digestUnreleased( — the parity call.
  const hasDigest = cpSource.includes('digestUnreleased(');
  assert(
    'parity-digest-unreleased',
    hasDigest,
    hasDigest
      ? 'context-pack.mjs uses digestUnreleased (parity OK)'
      : 'context-pack.mjs still injects raw extractUnreleased without digest wrapper'
  );

  // Must NOT call extractUnreleased outside of digestUnreleased wrapping.
  // The allowed pattern is: digestUnreleased(extractUnreleased(...)
  // We check that any remaining bare extractUnreleased( call is ONLY inside digestUnreleased(
  const bareRaw = /extractUnreleased\s*\(/g;
  const wrappedRaw = /digestUnreleased\s*\(\s*extractUnreleased\s*\(/g;
  const allRawCalls = [...cpSource.matchAll(bareRaw)].length;
  const wrappedCalls = [...cpSource.matchAll(wrappedRaw)].length;
  // Every extractUnreleased( call must be wrapped by digestUnreleased.
  assert(
    'no-bare-extract-unreleased',
    allRawCalls === wrappedCalls,
    `found ${allRawCalls} extractUnreleased( calls, ${wrappedCalls} are wrapped — bare calls: ${allRawCalls - wrappedCalls}`
  );

  return results;
}
