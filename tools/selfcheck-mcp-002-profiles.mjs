/**
 * MCP-002 self-check — Suite 3: resolve-profile.mjs
 *
 * Validates the PROPOSAL contract: all 5 base profiles resolve cleanly, write-mode
 * servers are flagged (not silently enabled), unknown ids throw, and bad arguments
 * are rejected. Wired into selfcheck.mjs via runMcp002ProfileChecks.
 *
 * @module selfcheck-mcp-002-profiles
 */
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** @param {{ ok: Function, bad: Function }} rep */
function assertThrows({ ok, bad }, label, fn, fragment) {
  try {
    fn();
    bad(`${label} — expected throw but did not throw`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (fragment && !msg.includes(fragment)) {
      bad(`${label} — wrong message: ${msg.slice(0, 100)}`);
    } else {
      ok(label);
    }
  }
}

/**
 * @param {{ ok: Function, bad: Function }} rep
 * @param {{ FAKE_ROOT: string, PROFILES_DIR: string, registry: import('./selfcheck-mcp-002.mjs').RegistryEntry[], resolveProfile: Function }} ctx
 */
export function runMcp002ProfileChecks({ ok, bad }, { FAKE_ROOT, PROFILES_DIR, registry, resolveProfile }) {
  console.log('  [MCP-002/3] resolve-profile.mjs');

  const knownIds = new Set(registry.map((e) => e.id));
  const PROFILES = ['web-app', 'backend-api', 'supabase', 'product-design', 'regulated'];

  // All 5 profiles resolve cleanly and conform to the PROPOSAL contract
  for (const profileId of PROFILES) {
    let proposal;
    try {
      proposal = resolveProfile(profileId, registry, FAKE_ROOT);
      ok(`mcp-002/profiles: resolveProfile('${profileId}') succeeds`);
    } catch (err) {
      bad(`mcp-002/profiles: resolveProfile('${profileId}') threw: ${err?.message?.slice(0, 80)}`);
      continue;
    }
    proposal.profileId === profileId
      ? ok(`mcp-002/profiles: '${profileId}' returns correct profileId`)
      : bad(`mcp-002/profiles: '${profileId}' profileId ${proposal.profileId}`);
    Array.isArray(proposal.servers)
      ? ok(`mcp-002/profiles: '${profileId}' servers is array`)
      : bad(`mcp-002/profiles: '${profileId}' servers not array`);
    typeof proposal.reason === 'string' && proposal.reason.length > 0
      ? ok(`mcp-002/profiles: '${profileId}' has reason string`)
      : bad(`mcp-002/profiles: '${profileId}' reason missing`);
    typeof proposal.requiresHumanApproval === 'boolean'
      ? ok(`mcp-002/profiles: '${profileId}' requiresHumanApproval is boolean`)
      : bad(`mcp-002/profiles: '${profileId}' requiresHumanApproval not boolean`);
    proposal.servers.every((s) => knownIds.has(s.id))
      ? ok(`mcp-002/profiles: all servers in '${profileId}' reference known ids`)
      : bad(`mcp-002/profiles: '${profileId}' has unknown server ids`);
  }

  // regulated — minimal: contextdevkit read-only, no human approval
  const reg = resolveProfile('regulated', registry, FAKE_ROOT);
  reg.servers.length === 1 ? ok('mcp-002/profiles: regulated has 1 server') : bad(`mcp-002/profiles: regulated server count ${reg.servers.length}`);
  reg.servers[0]?.id === 'contextdevkit' ? ok('mcp-002/profiles: regulated sole server is contextdevkit') : bad(`mcp-002/profiles: regulated server ${reg.servers[0]?.id}`);
  reg.servers[0]?.mode === 'read-only' ? ok('mcp-002/profiles: regulated mode read-only') : bad(`mcp-002/profiles: regulated mode ${reg.servers[0]?.mode}`);
  reg.requiresHumanApproval === false ? ok('mcp-002/profiles: regulated requiresHumanApproval=false') : bad(`mcp-002/profiles: regulated approval ${reg.requiresHumanApproval}`);

  // web-app — playwright (write) → flagged, not silently enabled
  const webapp = resolveProfile('web-app', registry, FAKE_ROOT);
  const pw = webapp.servers.find((s) => s.id === 'playwright');
  pw ? ok('mcp-002/profiles: web-app includes playwright') : bad('mcp-002/profiles: web-app missing playwright');
  pw?.humanApprovalRequired === true ? ok('mcp-002/profiles: playwright humanApprovalRequired=true') : bad(`mcp-002/profiles: playwright humanApprovalRequired=${pw?.humanApprovalRequired}`);
  webapp.requiresHumanApproval === true ? ok('mcp-002/profiles: web-app requiresHumanApproval=true') : bad(`mcp-002/profiles: web-app approval ${webapp.requiresHumanApproval}`);
  const cdkInWebApp = webapp.servers.find((s) => s.id === 'contextdevkit');
  cdkInWebApp?.humanApprovalRequired === false ? ok('mcp-002/profiles: contextdevkit in web-app NOT flagged') : bad(`mcp-002/profiles: contextdevkit humanApprovalRequired=${cdkInWebApp?.humanApprovalRequired}`);

  // backend-api and supabase — all read-only, no human approval
  resolveProfile('backend-api', registry, FAKE_ROOT).requiresHumanApproval === false
    ? ok('mcp-002/profiles: backend-api requiresHumanApproval=false')
    : bad('mcp-002/profiles: backend-api should not require human approval');
  resolveProfile('supabase', registry, FAKE_ROOT).requiresHumanApproval === false
    ? ok('mcp-002/profiles: supabase requiresHumanApproval=false')
    : bad('mcp-002/profiles: supabase should not require human approval');

  // Failure modes
  assertThrows({ ok, bad }, 'mcp-002/profiles: throws on unknown profile', () => resolveProfile('nonexistent', registry, FAKE_ROOT), 'not found');
  assertThrows({ ok, bad }, 'mcp-002/profiles: throws on empty profileId', () => resolveProfile('', registry, FAKE_ROOT), 'non-empty string');
  assertThrows({ ok, bad }, 'mcp-002/profiles: throws on empty registry', () => resolveProfile('web-app', [], FAKE_ROOT), 'non-empty RegistryEntry array');

  // Profile with unknown server id must throw
  const badPath = join(PROFILES_DIR, 'sc-bad-test.json');
  writeFileSync(badPath, JSON.stringify({ id: 'sc-bad-test', servers: [{ id: 'ghost-server' }] }), 'utf-8');
  assertThrows({ ok, bad }, 'mcp-002/profiles: throws on unknown server id in profile', () => resolveProfile('sc-bad-test', registry, FAKE_ROOT), 'unknown server id');
  rmSync(badPath);
}
