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
  const UNREGISTERED_ALLOWED = new Set([
    'execution-gate.mjs', // CDK-032 v1: advisory PreToolUse gate; silent until contracts exist (ADR-0072).
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

  // Resolver contract matrix (ADR-0042, task 106) — floor pinned at EVERY grade.
  const resolver = mods['config/resolve-autonomy.mjs'];
  if (typeof resolver?.resolveAutonomy !== 'function') {
    bad('resolveAutonomy not exported (ADR-0042, task 106)');
    return;
  }
  const { resolveAutonomy } = resolver;
  // Grade 4 fails closed unless deliberations are explicitly active (ADR-0045) — a
  // valid merged config always carries it; the contradiction case sets it false below.
  const at = (grade) => ({ autonomy: { grade }, deliberations: { active: true } });
  const floorCells = [];
  for (let grade = 1; grade <= 4; grade++) {
    floorCells.push(['adr', resolveAutonomy('adr', at(grade)).mode]);
    floorCells.push(['grade-change', resolveAutonomy('grade-change', at(grade)).mode]);
    floorCells.push(['secret edit', resolveAutonomy('edit', at(grade), null, { path: 'config/.env.prod' }).mode]);
    floorCells.push(['gate self-edit', resolveAutonomy('edit', at(grade), null, { path: 'contextkit/runtime/hooks/x.mjs' }).mode]);
    floorCells.push(['autonomy-evidence self-edit', resolveAutonomy('edit', at(grade), null, { path: 'contextkit/memory/autonomy/readiness.json' }).mode]);
    floorCells.push(['force-push', resolveAutonomy('push', at(grade), null, { force: true }).mode]);
  }
  floorCells.every(([, mode]) => mode === 'manual')
    ? ok(`resolver floor holds at every grade (${floorCells.length} cells → manual, ADR-0042)`)
    : bad(`resolver floor broken: ${floorCells.filter(([, m]) => m !== 'manual').map(([n]) => n).join(', ')}`);
  const expectedModes = [
    [resolveAutonomy('edit', {}).mode, 'auto', 'default grade 3 → auto (ADR-0058)'],
    [resolveAutonomy('edit', {}).source, 'default', 'missing config → source default'],
    [resolveAutonomy('edit', at('weird')).grade, 1, 'unparseable grade resolves to 1'],
    [resolveAutonomy('edit', at(1), 3).grade, 3, 'session override beats config'],
    [resolveAutonomy('edit', at(1), 3, { flagGrade: 2 }).grade, 2, 'per-run flag beats session override'],
    [resolveAutonomy('ship-checkpoint', at(4)).mode, 'debate', 'grade-4 checkpoint → debate'],
    [resolveAutonomy('ship-checkpoint', at(3)).mode, 'debate', 'grade-3 checkpoint → debate'],
    // ADR-0070 — feature/decision deliberation gates mirror ship-checkpoint (debate at grade ≥ 3).
    [resolveAutonomy('feature-deliberation', at(3)).mode, 'debate', 'grade-3 feature-deliberation → debate'],
    [resolveAutonomy('feature-deliberation', at(2)).mode, 'manual', 'grade-2 feature-deliberation → manual'],
    [resolveAutonomy('decision-deliberation', at(3)).mode, 'debate', 'grade-3 decision-deliberation → debate'],
    [resolveAutonomy('decision-deliberation', at(1)).mode, 'manual', 'grade-1 decision-deliberation → manual'],
    [resolveAutonomy('push', at(4), null, { targetRef: 'feat/x', defaultBranch: 'main' }).mode, 'auto', 'grade-4 push to a branch → auto'],
    [resolveAutonomy('push', at(4), null, { targetRef: 'main', defaultBranch: 'main' }).mode, 'manual', 'grade-4 push to default branch → manual'],
    [resolveAutonomy('session-log', at(2)).mode, 'auto', 'grade-2 session-log → auto'],
    // ADR-0044 D3 — at grade 4 an exhausted budget downgrades to grade-2 behaviour (never blocks).
    [resolveAutonomy('edit', at(4), null, { budgetExhausted: true }).mode, 'suggest', 'grade-4 + budget-exhausted → suggest (D3 downgrade, not block)'],
    [resolveAutonomy('edit', at(4), null, { budgetExhausted: true }).reason, 'budget-exhausted', 'grade-4 budget downgrade carries reason'],
    [resolveAutonomy('push', at(4), null, { budgetExhausted: true, targetRef: 'feat/x', defaultBranch: 'main' }).mode, 'manual', 'grade-4 budget-exhausted push → manual (grade-2 behaviour)'],
    [resolveAutonomy('edit', at(3), null, { budgetExhausted: true }).mode, 'auto', 'budget-exhausted only bites at grade 4 (grade 3 unaffected)'],
    [resolveAutonomy('edit', at(4), null, { budgetExhausted: true, path: 'config/.env' }).mode, 'manual', 'floor still wins over the budget downgrade (secret path)'],
  ];
  const wrong = expectedModes.filter(([got, want]) => got !== want);
  wrong.length === 0
    ? ok(`resolver precedence + mode table hold (${expectedModes.length} cells, ADR-0042)`)
    : bad(`resolver cells wrong: ${wrong.map(([, , name]) => name).join('; ')}`);
  let threwOnContradiction = false;
  try {
    resolveAutonomy('edit', { autonomy: { grade: 4 }, deliberations: { active: false } });
  } catch {
    threwOnContradiction = true;
  }
  let threwOnUnknownArea = false;
  try {
    resolveAutonomy('deploy-to-prod', {});
  } catch {
    threwOnUnknownArea = true;
  }
  threwOnContradiction && threwOnUnknownArea
    ? ok('resolver throws on contradiction (grade 4 sans deliberations) and unknown area (closed enum)')
    : bad(`resolver failed to refuse: contradiction=${threwOnContradiction} unknownArea=${threwOnUnknownArea}`);
}
