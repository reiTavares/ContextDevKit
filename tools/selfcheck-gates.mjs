/**
 * Self-check — gate wiring and concrete risk invariants (ADR-0158).
 *
 * Three structural controls born from the level-4 bypass incident (a gate
 * deferring to a hook that was registered nowhere):
 *
 * 1. Wiring drift, forward: every hook command composed into any level's
 *    settings must point at an existing file under runtime/hooks/.
 * 2. Wiring drift, reverse: every self-executing hook ENTRYPOINT in
 *    runtime/hooks/ must be referenced by at least one level's settings —
 *    an unregistered gate is exactly the incident's shape.
 * 3. Hooks do not read legacy autonomy grades or import their resolver.
 *
 * Plus the behavioral table for `matchSecret` (task 103) — the risk class
 * must hit credential material and must NOT hit lookalikes (keyboard.mjs).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs the gate-wiring and concrete-risk checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string, RT: string, mods: Record<string, any> }} ctx
 */
export async function runGateChecks({ ok, bad }, { KIT, RT, mods }) {
  console.log('Checking gate wiring & concrete risk acknowledgement (ADR-0158)...');
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

  // 2. Reverse: a self-executing entrypoint nobody registers is a silent gate.
  // ContextDevKit 4 has no deferred executable hook allowlist: every normal
  // entrypoint is reachable from a host composer or must be physically absent.
  const unregistered = present.filter((f) => {
    const src = readFileSync(resolve(hooksDir, f), 'utf-8');
    const isEntrypoint = /main\(\)\.catch\(/.test(src) && /process\.stdin/.test(src);
    return isEntrypoint && !referenced.has(f);
  });
  unregistered.length === 0
    ? ok('every self-executing hook entrypoint is registered (wiring drift, reverse)')
    : bad(`unregistered hook entrypoint(s) — the bypass-incident shape: ${unregistered.join(', ')}`);

  // 3. No hook retains the legacy grade authority or resolver import.
  const graded = present.filter((f) => {
    const src = readFileSync(resolve(hooksDir, f), 'utf-8');
    const rawKey = /config\s*\??\.\s*autonomy|\bautonomy\s*[.[]\s*(grade|level)/.test(src);
    const viaResolver = /resolveAutonomy|readAutonomyOverride|resolve-autonomy/.test(src);
    return rawKey || viaResolver;
  });
  graded.length === 0
    ? ok('hooks contain no legacy autonomy grade or resolver dependency')
    : bad(`hook(s) retain legacy autonomy authority: ${graded.join(', ')}`);

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

  // Concrete risk acknowledgement contract (ADR-0158).
  const riskModule = mods['governance/risk-acknowledgement.mjs'];
  if (typeof riskModule?.resolveRiskAcknowledgement !== 'function') {
    bad('resolveRiskAcknowledgement not exported');
    return;
  }
  const { resolveRiskAcknowledgement } = riskModule;
  const secret = resolveRiskAcknowledgement('edit', { path: 'config/.env.prod' });
  const forcePush = resolveRiskAcknowledgement('push', { force: true });
  const destructive = resolveRiskAcknowledgement('destructive-production');
  secret.kind === 'secret-rotation'
    && forcePush.kind === 'force-push'
    && destructive.kind === 'destructive-production'
    && [secret, forcePush, destructive].every((posture) => posture.required && !posture.binding && !posture.blocking)
    ? ok('real safety surfaces require acknowledgement metadata without project blocking')
    : bad('risk acknowledgement mapping is incomplete');
  const acknowledged = resolveRiskAcknowledgement('force-push', {
    acknowledgedBy: 'owner', acknowledgedAt: '2026-08-08T12:00:00.000Z', reason: 'Explicit owner instruction.',
  });
  acknowledged.acknowledged && acknowledged.continuation.allowed
    ? ok('explicit owner acknowledgement is auditable without replacing platform confirmation')
    : bad('owner acknowledgement metadata is incomplete');
  const legacyFiles = [
    'runtime/config/resolve-autonomy.mjs',
    'runtime/config/autonomy-eligibility.mjs',
    'tools/scripts/autonomy-readiness.mjs',
    'tools/scripts/autonomy-readiness-v2.mjs',
    'tools/scripts/autonomy.mjs',
  ];
  const retainedLegacy = legacyFiles.filter((file) => existsSync(resolve(KIT, 'templates/contextkit', file)));
  retainedLegacy.length === 0
    ? ok('legacy autonomy gate modules are physically absent')
    : bad(`legacy autonomy modules remain: ${retainedLegacy.join(', ')}`);
}
