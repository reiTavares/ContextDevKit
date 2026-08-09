/**
 * Self-check — GATE WIRING & AUTONOMY FLOOR invariants (ADR-0041 F0, task 105).
 *
 * Three structural controls born from the level-4 bypass incident (a gate
 * deferring to a hook that was registered nowhere):
 *
 * 1. Wiring drift, forward: every hook command composed into any level's
 *    settings must point at an existing file under runtime/hooks/.
 * 2. Wiring drift, reverse: every self-executing hook ENTRYPOINT in
 *    runtime/hooks/ must be referenced by at least one level's settings —
 *    an unregistered gate is exactly the incident's shape.
 * 3. Hooks are grade-blind (ADR-0041/0042): no hook may READ the autonomy
 *    config key. Only commands and /ship checkpoints consult the resolver.
 *
 * Plus the behavioral table for `matchSecret` (task 103) — the floor class
 * must hit credential material and must NOT hit lookalikes (keyboard.mjs).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs the gate-wiring + autonomy-floor checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string, RT: string, mods: Record<string, any> }} ctx
 */
export async function runGateChecks({ ok, bad }, { KIT, RT, mods }) {
  console.log('Checking gate wiring & autonomy floor (ADR-0041 F0)...');
  const hooksDir = resolve(RT, 'hooks');
  const composeSettings = mods['config/settings-compose.mjs']?.composeSettings;
  if (!composeSettings) {
    bad('gate checks need composeSettings — settings-compose failed to load');
    return;
  }

  // Union of hook script names referenced by ANY level's composed settings.
  const referenced = new Set();
  for (let level = 1; level <= 7; level++) {
    for (const groups of Object.values(composeSettings(null, level).hooks || {})) {
      for (const group of [].concat(groups)) {
        for (const h of group.hooks || []) {
          const m = String(h.command || '').match(/runtime\/hooks\/([\w.-]+\.mjs)/);
          if (m) referenced.add(m[1]);
        }
      }
    }
  }

  // 1. Forward: a referenced hook that does not exist is a broken level.
  const present = readdirSync(hooksDir).filter((f) => f.endsWith('.mjs'));
  const ghosts = [...referenced].filter((f) => !present.includes(f));
  ghosts.length === 0
    ? ok(`all ${referenced.size} referenced hooks exist (wiring drift, forward)`)
    : bad(`settings reference missing hook file(s): ${ghosts.join(', ')}`);

  // 2. Reverse: a self-executing entrypoint nobody registers is a silent gate
  //    (the autonomy-gate.mjs incident). Library modules don't self-execute.
  //
  //    Intentionally-unregistered allowlist: hooks that self-execute but are
  //    shipped INERT (advisory-only, no side effects until wired) and will be
  //    registered in a follow-up settings-compose pass once the contract
  //    substrate is fully adopted. Must be kept short and each entry annotated.
  // PKG-04 hooks shipped unregistered pending the activation pass (settings-compose
  // wiring). Advisory-only, fail-open, no side effects until explicitly wired. ADR-0072.
  //   completion-gate.mjs       — CDK-040 completion evidence gate (Stop).
  //   subagent-gate.mjs         — CDK-041 subagent governance (Task PreToolUse + SubagentStop).
  //   compaction-continuity.mjs — CDK-042 contract continuity (PreCompact + SessionStart).
  // WF-0068 (ADR-0128 §25/§26) WIRED the two Domain Engineering enforcement hooks
  // (domain-code-gate.mjs PreToolUse + domain-conformance.mjs PostToolUse) into
  // settings-compose + the Codex/Antigravity composers at L≥4, so they are now
  // REGISTERED and no longer belong on this allowlist — the reverse wiring-drift
  // check proves they resolve. They remain DORMANT-by-config (default-OFF: each hook
  // exits early unless domainEngineering.enabled) + fail-open; the guarded/strict
  // fleet activation is the human-gated rolloutStage ceiling.
  const UNREGISTERED_ALLOWED = new Set([
    'completion-gate.mjs', 'subagent-gate.mjs', 'compaction-continuity.mjs',
  ]);
  const unregistered = present.filter((f) => {
    if (UNREGISTERED_ALLOWED.has(f)) return false;
    const src = readFileSync(resolve(hooksDir, f), 'utf-8');
    const isEntrypoint = /main\(\)\.catch\(/.test(src) && /process\.stdin/.test(src);
    return isEntrypoint && !referenced.has(f);
  });
  unregistered.length === 0
    ? ok('every self-executing hook entrypoint is registered or intentionally deferred (wiring drift, reverse)')
    : bad(`unregistered hook entrypoint(s) — the bypass-incident shape: ${unregistered.join(', ')}`);

  // 3. Grade-blind invariant: no ENFORCEMENT hook branches on the consent grade —
  //    neither via the raw config key NOR via the resolver (`resolveAutonomy(...).grade`
  //    / `readAutonomyOverride`). Display-only modules that legitimately read the dial
  //    for rendering are an EXPLICIT allowlist — the audited surface, not a blind spot.
  const GRADE_DISPLAY_ALLOWLIST = new Set(['autonomy-signals.mjs']);
  const graded = present.filter((f) => {
    if (GRADE_DISPLAY_ALLOWLIST.has(f)) return false;
    const src = readFileSync(resolve(hooksDir, f), 'utf-8');
    const rawKey = /config\s*\??\.\s*autonomy|\bautonomy\s*[.[]\s*(grade|level)/.test(src);
    const viaResolver = /resolveAutonomy|readAutonomyOverride/.test(src) && /\.\s*grade\b/.test(src);
    return rawKey || viaResolver;
  });
  graded.length === 0
    ? ok('hooks are autonomy-grade-blind — no enforcement hook reads the grade via key OR resolver (ADR-0042; display-only allowlisted)')
    : bad(`hook(s) read the autonomy grade — consent must never reach enforcement: ${graded.join(', ')}`);

  // matchSecret behavioral table (task 103): hits and required non-hits.
  const matchSecret = mods['hooks/path-classification.mjs']?.matchSecret;
  if (typeof matchSecret !== 'function') {
    bad('matchSecret not exported from path-classification (task 103)');
    return;
  }
  const table = [
    ['config/.env.production', '.env*'],
    ['certs/server.pem', '*.pem'],
    ['deploy/signing.key', '*.key'],
    ['app/secrets/token.json', 'secrets/'],
    ['.github/workflows/ci.yml', '.github/workflows/'],
    ['.npmrc', '.npmrc'],
    ['credentials.json', 'credentials*'],
    ['deploy/id_rsa', 'ssh-private-key'],
    ['home/.ssh/id_ed25519', 'ssh-private-key'],
    ['.git-credentials', '.git-credentials'],
    ['certs/server.crt', '*.crt'],
    ['pki/ca.cer', '*.cer'],
    ['keys/team.asc', '*.asc'],
    ['deploy/id_rsa.pub', null],
    ['src/hooks/keyboard.mjs', null],
    ['monkey.js', null],
    ['src/envelope.ts', null],
  ];
  const misses = table.filter(([p, want]) => matchSecret(p) !== want);
  misses.length === 0
    ? ok(`matchSecret behavioral table holds (${table.length} cells, incl. lookalike non-hits)`)
    : bad(`matchSecret mismatches: ${misses.map(([p]) => p).join(', ')}`);
  matchSecret('vault/.env.ci', []) === '.env*' && matchSecret('x/custom.token', ['custom.token']) === 'custom.token'
    ? ok('matchSecret built-ins hold with extras present (extend, never replace)')
    : bad('matchSecret extras replaced the built-ins — floor must be additive');

  // Resolver contract matrix (ADR-0158) — grades are migration metadata only.
  const resolver = mods['config/resolve-autonomy.mjs'];
  if (typeof resolver?.resolveAutonomy !== 'function') {
    bad('resolveAutonomy not exported (ADR-0042, task 106)');
    return;
  }
  const { resolveAutonomy } = resolver;
  const at = (grade) => ({ autonomy: { grade }, deliberations: { active: true } });
  const advisoryCells = [];
  for (let grade = 1; grade <= 4; grade++) {
    advisoryCells.push(resolveAutonomy('edit', at(grade)));
    advisoryCells.push(resolveAutonomy('swarm-dispatch', at(grade)));
    advisoryCells.push(resolveAutonomy('feature-deliberation', at(grade)));
  }
  advisoryCells.every((posture) => posture.mode === 'advisory' && posture.binding === false && posture.blocking === false)
    ? ok(`resolver is advisory at every legacy grade (${advisoryCells.length} cells)`)
    : bad('a legacy grade retained authorization authority');
  const expectedMetadata = [
    [resolveAutonomy('edit', {}).grade, null, 'missing grade stays absent'],
    [resolveAutonomy('edit', at('weird')).legacy.diagnostics.includes('legacy-grade-invalid'), true, 'invalid legacy grade is diagnosed'],
    [resolveAutonomy('edit', at(1), 3).grade, 3, 'session override beats config'],
    [resolveAutonomy('edit', at(1), 3, { flagGrade: 2 }).grade, 2, 'per-run flag beats session override'],
  ];
  const wrong = expectedMetadata.filter(([got, want]) => got !== want);
  wrong.length === 0
    ? ok(`resolver retains ${expectedMetadata.length} auditable legacy metadata cells`)
    : bad(`resolver metadata wrong: ${wrong.map(([, , name]) => name).join('; ')}`);
  const secret = resolveAutonomy('edit', {}, null, { path: 'config/.env.prod' });
  const forcePush = resolveAutonomy('push', {}, null, { force: true });
  const destructive = resolveAutonomy('destructive-production', {});
  secret.riskAcknowledgement.kind === 'secret-rotation'
    && forcePush.riskAcknowledgement.kind === 'force-push'
    && destructive.riskAcknowledgement.kind === 'destructive-production'
    && [secret, forcePush, destructive].every((posture) => posture.riskAcknowledgement.required && posture.mode === 'advisory')
    ? ok('real safety surfaces require acknowledgement metadata without project blocking')
    : bad('risk acknowledgement mapping is incomplete');
  const unknown = resolveAutonomy('deploy-to-prod', { autonomy: { grade: 4 }, deliberations: { active: false } });
  unknown.mode === 'advisory' && unknown.legacy.diagnostics.includes('unknown-area:deploy-to-prod')
    ? ok('unknown areas and legacy contradictions are observable and non-blocking')
    : bad('unknown area or contradiction became hidden authority');
}
