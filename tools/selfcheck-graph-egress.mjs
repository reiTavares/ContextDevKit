#!/usr/bin/env node
/**
 * Self-test for graph-egress.mjs (SR2, WF-0073/BIZ-0004) — standalone entrypoint
 * (exit 0/1). This is the ZERO-EGRESS ALLOWLIST PROOF, the load-bearing security
 * invariant of ADR-0138.
 *
 * Asserts:
 *   - a planted secret (.env, .pem, id_rsa) and a contextkit/memory/** file are
 *     NEVER in the allowed egress set, EVEN under a greedy `**` allowlist;
 *   - classification defaults to `unknown` (excluded) — opt-in, not opt-out;
 *   - egress off by default (no backend -> REFUSED);
 *   - local backend -> ALLOWED_LOCAL (no egress); cloud without bound consent ->
 *     REFUSED; a no-cloud flag + cloud request -> explicit REFUSED (contradiction);
 *   - consent is bound to sha256(egress-set) — a changed set invalidates it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph-egress.mjs');

export async function runGraphEgressChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(modPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-egress imported');

  // THE zero-egress allowlist proof: greedy `**` allowlist, secrets + memory planted.
  const planted = [
    'pkg/a.js', 'docs/readme.md',
    'contextkit/memory/decisions/ADR-0134.md',
    'contextkit/memory/sessions/2026-07-19-146.md',
    '.env', '.env.local', 'secrets.pem', 'id_rsa', '.ssh/id_rsa', '.npmrc',
    'config/credentials.json', '.git-private/mirror',
  ];
  const set = m.resolveEgressSet(planted, ['**']);
  const leaked = set.allowed.filter((p) =>
    p.includes('memory/') || p.includes('.env') || p.includes('id_rsa') || p.endsWith('.pem')
    || p.includes('credentials') || p.includes('.git-private') || p.includes('.npmrc'));
  record('ZERO-EGRESS: no secret / memory file in the allowed set under a greedy allowlist', leaked.length === 0,
    leaked.length === 0 ? 'allowed=' + JSON.stringify(set.allowed) : 'LEAKED: ' + JSON.stringify(leaked));

  const memDenied = set.denied.some((d) => d.path.includes('memory/') && d.reason.includes('hard-deny'));
  const secretDenied = set.denied.some((d) => d.path === '.env' && d.reason.includes('hard-deny'));
  record('memory + secrets hard-denied with a reason (never silently)', memDenied && secretDenied,
    'memDenied=' + memDenied + ' secretDenied=' + secretDenied);

  record('classify defaults to excluded (unknown), opt-in not opt-out',
    m.classifySensitivity('weird.xyz') === 'unknown' && m.classifySensitivity('contextkit/memory/x.md') === 'private-memory',
    m.classifySensitivity('weird.xyz'));

  record('egressHash is a stable 16-hex over the allowed set', typeof set.egressHash === 'string' && /^[0-9a-f]{16}$/.test(set.egressHash),
    set.egressHash);

  // Refuse-by-default authorization ladder.
  record('no backend -> REFUSED (egress off by default)', m.authorizeSemanticPass({}).decision === 'REFUSED', '');
  record('local backend -> ALLOWED_LOCAL (no egress)', m.authorizeSemanticPass({ backend: 'ollama' }).decision === 'ALLOWED_LOCAL', '');
  record('no-cloud + cloud request -> explicit REFUSED (contradiction, not silent downgrade)',
    m.authorizeSemanticPass({ backend: 'anthropic', noCloud: true }).decision === 'REFUSED', '');
  record('cloud without bound consent -> REFUSED', m.authorizeSemanticPass({ backend: 'anthropic', egressSet: set }).decision === 'REFUSED', '');

  const token = 'consent:' + set.egressHash;
  record('cloud + consent bound to the egress-set hash -> ALLOWED_CLOUD',
    m.authorizeSemanticPass({ backend: 'anthropic', egressSet: set, consentToken: token }).decision === 'ALLOWED_CLOUD', '');

  const other = m.resolveEgressSet(['pkg/other.js'], ['**']);
  record('consent-set swap invalidates consent (blocks "consent to X, send Y")',
    m.authorizeSemanticPass({ backend: 'anthropic', egressSet: other, consentToken: token }).decision === 'REFUSED', '');

  const source = readFileSync(modPath, 'utf-8');
  const bad = source.split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf('import ') === 0 && l.indexOf(' from ') !== -1)
    .map((l) => { const at = l.lastIndexOf('from '); const r = l.slice(at + 5).trim(); return r.slice(1, r.indexOf(r[0], 1)); })
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (node:* + relative siblings only)', bad.length === 0, bad.length === 0 ? 'clean' : bad.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-egress.mjs')) {
  const results = await runGraphEgressChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  process.exit(failCount > 0 ? 1 : 0);
}
